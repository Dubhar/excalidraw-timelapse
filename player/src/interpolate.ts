/**
 * Per-property interpolation between two Excalidraw element lists.
 *
 * Rules (see README):
 *  - matched by element.id
 *  - numbers (x, y, w, h, opacity, strokeWidth, roughness, fontSize) lerp
 *  - angle lerps along the shortest arc
 *  - colours lerp in RGBA (transparent keeps the other side's RGB)
 *  - points (line/arrow/freedraw) are normalised to equal length, then lerp
 *  - anything discrete snaps at t = 0.5 (dominant side wins)
 *  - if a change cannot be morphed (type, text, font, image, stroke/fill style,
 *    elbow-ness, sharp<->round) the element is CROSSFADED (old fades out, new in)
 *  - elements only in A fade out, only in B fade in
 */
import type { El } from "./types";

type Pt = [number, number];
const TAU = Math.PI * 2;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function lerpAngle(a: number, b: number, t: number) {
  let d = (((b - a) % TAU) + TAU) % TAU;
  if (d > Math.PI) d -= TAU;
  return a + d * t;
}
export const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/* ------------------------------------------------------------------ colour */
type RGBA = [number, number, number, number];
let ctx2d: CanvasRenderingContext2D | null | undefined;
const colorCache = new Map<string, RGBA>();

export function parseColor(input: string): RGBA {
  const hit = colorCache.get(input);
  if (hit) return hit;
  let out: RGBA = [0, 0, 0, 1];
  const s = String(input ?? "").trim().toLowerCase();
  if (s === "transparent") out = [0, 0, 0, 0];
  else {
    if (ctx2d === undefined) ctx2d = document.createElement("canvas").getContext("2d");
    if (ctx2d) {
      ctx2d.fillStyle = "#000000";
      ctx2d.fillStyle = s; // browser normalises any CSS colour
      const v = String(ctx2d.fillStyle);
      if (v[0] === "#") {
        const n = parseInt(v.slice(1, 7), 16);
        out = [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
      } else {
        const m = v.match(/rgba?\(([^)]+)\)/);
        if (m) {
          const p = m[1].split(",").map(Number);
          out = [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
        }
      }
    }
  }
  colorCache.set(input, out);
  return out;
}

export function lerpColor(a: string, b: string, t: number): string {
  if (a === b) return a;
  let [ar, ag, ab, aa] = parseColor(a);
  let [br, bg, bb, ba] = parseColor(b);
  if (aa === 0) [ar, ag, ab] = [br, bg, bb];
  if (ba === 0) [br, bg, bb] = [ar, ag, ab];
  const al = lerp(aa, ba, t);
  if (al <= 0) return "transparent";
  const h = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  const r = lerp(ar, br, t), g = lerp(ag, bg, t), bl = lerp(ab, bb, t);
  return al >= 0.999 ? `#${h(r)}${h(g)}${h(bl)}` : `rgba(${Math.round(r)},${Math.round(g)},${Math.round(bl)},${al.toFixed(3)})`;
}

/* ------------------------------------------------------------------ points */
const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Upsample by subdividing the longest segments; original vertices are preserved. */
export function subdividePolyline(p: Pt[], n: number): Pt[] {
  if (p.length >= n) return p;
  if (p.length === 0) return Array.from({ length: n }, () => [0, 0] as Pt);
  if (p.length === 1) return Array.from({ length: n }, () => p[0]);
  const lens = p.slice(1).map((q, i) => dist(p[i], q));
  const k = new Array(lens.length).fill(0);
  for (let extra = n - p.length; extra > 0; extra--) {
    let best = 0, bs = -1;
    for (let i = 0; i < lens.length; i++) {
      const s = lens[i] / (k[i] + 1);
      if (s > bs) { bs = s; best = i; }
    }
    k[best]++;
  }
  const out: Pt[] = [p[0]];
  for (let i = 0; i < lens.length; i++) {
    for (let j = 1; j <= k[i]; j++) {
      const t = j / (k[i] + 1);
      out.push([lerp(p[i][0], p[i + 1][0], t), lerp(p[i][1], p[i + 1][1], t)]);
    }
    out.push(p[i + 1]);
  }
  return out;
}

/** Resample to exactly n points evenly spaced along arc length (freehand strokes). */
export function resampleByLength(p: Pt[], n: number): Pt[] {
  if (p.length === 0) return Array.from({ length: n }, () => [0, 0] as Pt);
  if (p.length === 1 || n <= 1) return Array.from({ length: n }, () => p[0]);
  const cum = [0];
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + dist(p[i - 1], p[i]));
  const total = cum[cum.length - 1];
  if (total === 0) return Array.from({ length: n }, () => p[0]);
  const out: Pt[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const target = (total * i) / (n - 1);
    while (j < p.length - 2 && cum[j + 1] < target) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const t = Math.min(1, Math.max(0, (target - cum[j]) / seg));
    out.push([lerp(p[j][0], p[j + 1][0], t), lerp(p[j][1], p[j + 1][1], t)]);
  }
  return out;
}

export function matchPoints(a: Pt[], b: Pt[], freedraw: boolean): [Pt[], Pt[]] {
  if (a.length === b.length) return [a, b];
  const n = Math.max(a.length, b.length);
  return freedraw
    ? [resampleByLength(a, n), resampleByLength(b, n)]
    : [subdividePolyline(a, n), subdividePolyline(b, n)];
}

/* -------------------------------------------------------------- transition */
export interface Transition {
  /** t is already eased, 0..1. Endpoints return the exact original arrays. */
  at(t: number): El[];
  stats: { kept: number; changed: number; crossfaded: number; added: number; removed: number };
}

const IGNORED = new Set(["version", "versionNonce", "updated", "index", "seed_"]);
const sig = (e: El) => JSON.stringify(e, (k, v) => (IGNORED.has(k) ? undefined : v));
const hasPoints = (e: El) => Array.isArray(e.points);
const visibleFill = (e: El) => e.backgroundColor && e.backgroundColor !== "transparent";

export function needsCrossfade(a: El, b: El): boolean {
  if (a.type !== b.type) return true;
  if (a.type === "text" && (a.text !== b.text || a.fontFamily !== b.fontFamily)) return true;
  if (a.type === "image") {
    if (a.fileId !== b.fileId) return true;
    if (JSON.stringify(a.crop ?? null) !== JSON.stringify(b.crop ?? null)) return true;
    if (JSON.stringify(a.scale ?? null) !== JSON.stringify(b.scale ?? null)) return true;
  }
  if (!!a.elbowed !== !!b.elbowed) return true;
  if (a.strokeStyle !== b.strokeStyle) return true;
  if (a.fillStyle !== b.fillStyle && (visibleFill(a) || visibleFill(b))) return true;
  if ((a.roundness == null) !== (b.roundness == null)) return true;
  return false;
}

/** Merge ids: keep `base` order, slot ids only in `other` after their predecessor. */
function mergeOrder(base: string[], other: string[]): string[] {
  const out = [...base];
  const present = new Set(base);
  let last: string | null = null;
  for (const id of other) {
    if (!present.has(id)) {
      out.splice(last === null ? 0 : out.indexOf(last) + 1, 0, id);
      present.add(id);
    }
    last = id;
  }
  return out;
}

let tick = 0;
const bump = (e: El): El => {
  e.version = 1_000_000 + tick++;
  e.versionNonce = (Math.random() * 2 ** 31) | 0;
  return e;
};

export function buildTransition(A: El[], B: El[]): Transition {
  const mapA = new Map(A.map((e) => [e.id as string, e]));
  const mapB = new Map(B.map((e) => [e.id as string, e]));
  const stats = { kept: 0, changed: 0, crossfaded: 0, added: 0, removed: 0 };

  type Producer = (t: number) => El | El[];
  const producers = new Map<string, Producer>();

  for (const [id, a] of mapA) {
    const b = mapB.get(id);
    if (!b) {
      stats.removed++;
      producers.set(id, (t) => bump({ ...a, opacity: (a.opacity ?? 100) * (1 - t) }));
      continue;
    }
    if (sig(a) === sig(b)) {
      stats.kept++;
      producers.set(id, () => b); // stable identity => Excalidraw keeps its shape cache
      continue;
    }
    const pts = hasPoints(a) && hasPoints(b)
      ? matchPoints(a.points, b.points, a.type === "freedraw" && b.type === "freedraw")
      : null;
    const pressuresOk = pts && a.type === "freedraw" && b.type === "freedraw" &&
      !a.simulatePressure && !b.simulatePressure &&
      a.points.length === b.points.length &&
      a.pressures?.length === a.points.length && b.pressures?.length === b.points.length;

    const geometry = (t: number): El => {
      const g: El = {
        x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t),
        width: lerp(a.width, b.width, t), height: lerp(a.height, b.height, t),
        angle: lerpAngle(a.angle ?? 0, b.angle ?? 0, t),
      };
      if (a.type === "text" && b.type === "text") g.fontSize = lerp(a.fontSize, b.fontSize, t);
      if (pts) {
        g.points = pts[0].map((p, i) => [lerp(p[0], pts[1][i][0], t), lerp(p[1], pts[1][i][1], t)]);
        if (a.type === "freedraw" && b.type === "freedraw") {
          if (pressuresOk) g.pressures = a.pressures.map((p: number, i: number) => lerp(p, b.pressures[i], t));
          else { g.pressures = []; g.simulatePressure = true; }
        }
      }
      return g;
    };

    if (needsCrossfade(a, b)) {
      stats.crossfaded++;
      producers.set(id, (t) => [
        bump({ ...a, ...geometry(t), id: `${id}#from`, opacity: (a.opacity ?? 100) * (1 - t) }),
        bump({ ...b, ...geometry(t), id: `${id}#to`, opacity: (b.opacity ?? 100) * t }),
      ]);
      continue;
    }

    stats.changed++;
    producers.set(id, (t) => {
      const dom = t < 0.5 ? a : b;
      const s: El = {
        strokeColor: lerpColor(a.strokeColor, b.strokeColor, t),
        backgroundColor: lerpColor(a.backgroundColor, b.backgroundColor, t),
        strokeWidth: lerp(a.strokeWidth, b.strokeWidth, t),
        roughness: lerp(a.roughness, b.roughness, t),
        opacity: lerp(a.opacity ?? 100, b.opacity ?? 100, t),
      };
      const ra = a.roundness, rb = b.roundness;
      if (ra && rb && ra.type === rb.type && ra.value != null && rb.value != null)
        s.roundness = { type: ra.type, value: lerp(ra.value, rb.value, t) };
      return bump({ ...dom, ...s, ...geometry(t) });
    });
  }
  for (const [id, b] of mapB) {
    if (mapA.has(id)) continue;
    stats.added++;
    producers.set(id, (t) => bump({ ...b, opacity: (b.opacity ?? 100) * t }));
  }

  const idsA = A.map((e) => e.id as string), idsB = B.map((e) => e.id as string);
  const orderFromA = mergeOrder(idsA, idsB);
  const orderFromB = mergeOrder(idsB, idsA);

  return {
    stats,
    at(t) {
      if (t <= 0) return A;
      if (t >= 1) return B;
      const out: El[] = [];
      for (const id of t < 0.5 ? orderFromA : orderFromB) {
        const r = producers.get(id)!(t);
        Array.isArray(r) ? out.push(...r) : out.push(r);
      }
      return out;
    },
  };
}
