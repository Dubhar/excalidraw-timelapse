#!/usr/bin/env python3
"""Pack a sequence of .excalidraw snapshots into one air-gapped, interactive HTML file.

    python pack.py                          # snapshots/manifest.json -> diagram.html
    python pack.py order.json -o out.html   # any manifest; file paths are relative to it

The order of the snapshots comes ONLY from the manifest (nothing is sorted or guessed):
    {"frames": ["a.excalidraw", {"file": "b.excalidraw", "label": "Added cache"}]}

Python only validates, orders and packages. All rendering happens in the browser
via the real Excalidraw code bundled in vendor/player.js (built from player/).
Requires Python >= 3.10 (developed for 3.14). No third-party packages.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENDOR = ROOT / "vendor"
PLAYER_SRC = ROOT / "player"

# Element types Excalidraw 0.18 can render.
KNOWN_TYPES = {
    "rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text",
    "image", "frame", "magicframe", "embeddable", "iframe",
}
PLACEHOLDER_TYPES = {"embeddable", "iframe"}  # rendered as an empty box: no network embeds
CDN_HOSTS = ("esm.sh", "unpkg.com", "cdn.jsdelivr.net", "cdnjs.cloudflare.com",
             "fonts.googleapis.com", "fonts.gstatic.com", "googleapis.com", "jsdelivr.net")



class PackError(Exception):
    pass


@dataclass
class Snapshot:
    path: Path
    label: str
    elements: list = field(default_factory=list)
    background: str = "#ffffff"
    files: dict = field(default_factory=dict)


# ------------------------------------------------------------------ ordering
def read_manifest(manifest: Path) -> list[Snapshot]:
    if not manifest.is_file():
        raise PackError(
            f"manifest not found: {manifest}\n"
            'Create it next to your snapshots, listing them in presentation order:\n'
            '  {"frames": ["2026-09-24.excalidraw", {"file": "2026-09-25.excalidraw", "label": "Added cache"}]}')
    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise PackError(f"manifest {manifest}: cannot read/parse: {e}")
    entries = data.get("frames") if isinstance(data, dict) else None
    if not isinstance(entries, list) or not entries:
        raise PackError(f'manifest {manifest}: expected {{"frames": [ ... ]}} with at least one entry')
    snaps, seen, errors = [], set(), []
    for i, e in enumerate(entries):
        if isinstance(e, str):
            fname, label = e, None
        elif isinstance(e, dict):
            fname, label = e.get("file"), e.get("label")
        else:
            fname = label = None
        if not isinstance(fname, str) or (label is not None and not isinstance(label, str)):
            errors.append(f"entry {i}: must be a filename string or {{\"file\": ..., \"label\": ...}}")
            continue
        p = manifest.parent / fname
        if not p.is_file():
            errors.append(f"entry {i}: file not found: {p}")
            continue
        if p.resolve() in seen:
            errors.append(f"entry {i}: {fname} is listed more than once")
            continue
        seen.add(p.resolve())
        stem = p.name[: -len(".excalidraw")] if p.name.endswith(".excalidraw") else p.stem
        snaps.append(Snapshot(p, label or stem))
    if errors:
        raise PackError("\n  ".join([f"manifest {manifest} has problems:"] + errors))
    return snaps


# ---------------------------------------------------------------- validation
def load_snapshot(s: Snapshot, errors: list[str], warnings: list[str]) -> None:
    tag = s.path.name
    try:
        doc = json.loads(s.path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as e:
        errors.append(f"{tag}: not valid JSON ({e})")
        return
    if not isinstance(doc, dict) or doc.get("type") != "excalidraw":
        errors.append(f'{tag}: not an Excalidraw file (top-level "type" must be "excalidraw")')
        return
    raw = doc.get("elements")
    if not isinstance(raw, list):
        errors.append(f'{tag}: "elements" must be a list')
        return
    files = doc.get("files") or {}
    if not isinstance(files, dict):
        errors.append(f'{tag}: "files" must be an object')
        files = {}

    ids: set[str] = set()
    kept, deleted, dropped_types = [], 0, set()
    placeholders = 0
    for i, el in enumerate(raw):
        if not isinstance(el, dict) or not isinstance(el.get("id"), str) or not isinstance(el.get("type"), str):
            errors.append(f"{tag}: element #{i} lacks a string id/type")
            continue
        if el["id"] in ids:
            errors.append(f"{tag}: duplicate element id {el['id']!r}")
            continue
        ids.add(el["id"])
        if el.get("isDeleted"):
            deleted += 1
            continue
        t = el["type"]
        if t == "selection" or t not in KNOWN_TYPES:
            if t != "selection":
                dropped_types.add(t)
            continue
        if not all(isinstance(el.get(k), (int, float)) and not isinstance(el.get(k), bool) for k in ("x", "y")):
            errors.append(f"{tag}: element {el['id']!r} has non-numeric x/y")
            continue
        if t in PLACEHOLDER_TYPES:
            placeholders += 1
        if t == "image":
            fid = el.get("fileId")
            f = files.get(fid) if fid else None
            if fid is None:
                pass  # empty image slot: Excalidraw renders a placeholder
            elif not isinstance(f, dict) or not str(f.get("dataURL", "")).startswith("data:"):
                errors.append(f"{tag}: image {el['id']!r} references fileId {fid!r} which is missing from \"files\" (or has no embedded dataURL)")
                continue
            else:
                s.files[fid] = f
        kept.append(el)

    if dropped_types:
        warnings.append(f"{tag}: unsupported element type(s) {sorted(dropped_types)} were omitted")
    if placeholders:
        warnings.append(f"{tag}: {placeholders} embeddable/iframe element(s) will render as empty placeholders (no network embeds)")
    s.elements = kept
    bg = (doc.get("appState") or {}).get("viewBackgroundColor")
    s.background = bg if isinstance(bg, str) and bg else "#ffffff"


# ------------------------------------------------------------------ packaging
def canon(el: dict) -> str:
    return json.dumps(el, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def build_payload(snaps: list[Snapshot], args) -> tuple[dict, dict]:
    pool: dict[str, dict] = {}
    frames = []
    for s in snaps:
        keys = []
        for el in s.elements:
            c = canon(el)
            k = hashlib.sha1(c.encode("utf-8")).hexdigest()[:12]
            if k in pool and canon(pool[k]) != c:  # astronomically unlikely, but never silent
                raise PackError(f"hash collision on {k}")
            pool[k] = el
            keys.append(k)
        frames.append({"label": s.label, "file": s.path.name, "elements": keys, "background": s.background})

    files: dict[str, dict] = {}
    for s in snaps:
        for fid, f in s.files.items():
            if fid in files and files[fid].get("dataURL") != f.get("dataURL"):
                raise PackError(f"embedded file {fid!r} has different contents in different snapshots ({s.path.name})")
            files[fid] = f
    payload = {"version": 1, "title": args.title, "transitionMs": args.transition_ms,
               "pool": pool, "frames": frames, "files": files, "warnings": []}
    stats = {"unique_elements": len(pool), "total_refs": sum(len(f["elements"]) for f in frames), "files": len(files)}
    return payload, stats


def transition_report(snaps: list[Snapshot]) -> list[str]:
    lines = []
    for a, b in zip(snaps, snaps[1:]):
        ia = {e["id"]: e for e in a.elements}
        ib = {e["id"]: e for e in b.elements}
        common = ia.keys() & ib.keys()
        changed = sum(1 for i in common if canon(ia[i]) != canon(ib[i]))
        lines.append(f"    {a.label} -> {b.label}: {len(common) - changed} unchanged, {changed} modified, "
                     f"{len(ib.keys() - ia.keys())} added, {len(ia.keys() - ib.keys())} removed")
        if ia and ib and not common:
            lines.append("      !! no element ids in common: these files do not look like Save-As descendants; "
                         "this transition will be a plain crossfade")
    return lines


def ensure_player(rebuild: bool) -> None:
    needed = ["player.js", "player.css", "fonts.json"]
    if rebuild or not all((VENDOR / n).is_file() for n in needed):
        npm = shutil.which("npm")
        if not npm:
            raise PackError("vendor/ is incomplete and npm was not found to build it.\n"
                            "Build once on a machine with Node 20+:  cd player && npm install && npm run build")
        print("  … building player bundle (npm)")
        for cmd in ([npm, "install", "--no-audit", "--no-fund"], [npm, "run", "build"]):
            if subprocess.run(cmd, cwd=PLAYER_SRC).returncode:
                raise PackError(f"`{' '.join(cmd[1:])}` failed in player/")
    else:
        js = VENDOR / "player.js"
        newest_src = max((p.stat().st_mtime for p in (PLAYER_SRC / "src").rglob("*") if p.is_file()), default=0)
        if newest_src > js.stat().st_mtime:
            print("  ! player/src is newer than vendor/player.js: run with --rebuild-player to pick up changes")


def safe_script(text: str) -> str:
    """Keep inline <script> content from terminating early.

    Only the exact sequences the HTML parser treats specially are touched; `<\\/script` and `<\\!--` mean
    the same thing as the originals inside JS strings, regex literals, templates and comments.
    (Escaping every `</` would corrupt regex literals such as /</g.)
    """
    return re.sub(r"<!--", r"<\\!--", re.sub(r"</(script)", r"<\\/\1", text, flags=re.I))


def safe_style(text: str) -> str:
    return re.sub(r"</(style)", r"<\\/\1", text, flags=re.I)


def json_for_html(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


CSP = ("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; "
       "font-src data:; connect-src data: blob:; worker-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'")

TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="{csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>{css}</style>
</head>
<body>
<div id="root"></div>
<script id="timelapse-fonts" type="application/json">{fonts}</script>
<script id="timelapse-data" type="application/json">{data}</script>
<script type="module">{js}</script>
</body>
</html>
"""


def verify_offline(html_text: str, css: str, js: str, fonts: dict) -> list[str]:
    """Static checks. Runtime enforcement = the CSP meta tag; empirical proof = tools/verify.mjs."""
    problems = []
    shell = TEMPLATE.format(csp=CSP, title="", css="", fonts="", data="", js="")
    if re.search(r"<(link|img|iframe|embed|object|source|video|audio)\b|\s(src|href)=", shell, re.I):
        problems.append("HTML shell contains resource-loading tags/attributes")
    for m in re.finditer(r"url\(\s*(['\"]?)(?!data:)([^)'\"]+)\1\s*\)|@import", css):
        problems.append(f"CSS references an external resource: {m.group(0)[:60]}")
    if "timelapse-fonts" not in js:
        problems.append("player bundle lacks the offline font shim")
    if not any(k.startswith("Excalifont/") for k in fonts):
        problems.append("embedded font map has no Excalifont (the default hand-drawn font)")
    if 'http-equiv="Content-Security-Policy"' not in html_text:
        problems.append("CSP meta tag missing")
    return problems


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("manifest", nargs="?", default="snapshots/manifest.json", type=Path,
                    help="manifest listing the snapshots in order (default: snapshots/manifest.json)")
    ap.add_argument("-o", "--output", default="diagram.html", type=Path)
    ap.add_argument("--title", default="Excalidraw timelapse")
    ap.add_argument("--transition-ms", type=int, default=1200, help="morph duration (default 1200)")
    ap.add_argument("--rebuild-player", action="store_true", help="rebuild vendor/ from player/ (needs Node)")
    ap.add_argument("--strict", action="store_true", help="treat warnings as errors")
    args = ap.parse_args(argv)

    ok = lambda m: print(f"✓ {m}")
    try:
        snaps = read_manifest(args.manifest)
        ok(f"{len(snaps)} snapshots found, in manifest order ({args.manifest.name})")

        errors: list[str] = []
        warnings: list[str] = []
        listed = {s.path.resolve() for s in snaps}
        for p in sorted(args.manifest.parent.glob("*.excalidraw")):
            if p.resolve() not in listed:
                warnings.append(f"{p.name} is in the folder but NOT in the manifest, so it is not included")
        for s in snaps:
            load_snapshot(s, errors, warnings)
        if errors:
            print("✗ validation failed:")
            for e in errors:
                print(f"    {e}")
            return 1
        ok("all files valid Excalidraw JSON")
        ok("all snapshots parsed")
        ok("no duplicate element IDs within snapshots")
        ok("all embedded files resolved")

        for line in transition_report(snaps):
            print(line)

        ensure_player(args.rebuild_player)
        payload, stats = build_payload(snaps, args)
        payload["warnings"] = warnings
        js = (VENDOR / "player.js").read_text(encoding="utf-8")
        css = (VENDOR / "player.css").read_text(encoding="utf-8")
        fonts_text = (VENDOR / "fonts.json").read_text(encoding="utf-8")
        html = TEMPLATE.format(csp=CSP, title=json.dumps(args.title)[1:-1].replace("<", "&lt;"),
                               css=safe_style(css), fonts=fonts_text,
                               data=json_for_html(payload), js=safe_script(js))

        problems = verify_offline(html, css, js, json.loads(fonts_text))
        if problems:
            print("✗ offline verification failed:")
            for p in problems:
                print(f"    {p}")
            return 1
        ok(f"all runtime assets bundled (JS, CSS, {len(json.loads(fonts_text))} font files)")
        ok("no external resources in HTML/CSS; CSP default-src 'none' blocks any network request")

        for w in warnings:
            print(f"  ! {w}")
        if warnings and args.strict:
            print("✗ --strict: warnings treated as errors")
            return 1

        args.output.write_text(html, encoding="utf-8")
        ok(f"wrote {args.output} ({args.output.stat().st_size / 1e6:.1f} MB; "
           f"{stats['unique_elements']} unique elements across {stats['total_refs']} references, {stats['files']} embedded images)")
        return 0
    except PackError as e:
        print(f"✗ {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
