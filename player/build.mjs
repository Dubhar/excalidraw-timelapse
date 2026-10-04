// Bundles the player into ../vendor/. Excalidraw and every other dependency are bundled UNMODIFIED:
// there are no source patches, no stubbed modules, no regex edits of node_modules.
// Outputs:
//   player.js / player.css      React + Excalidraw + our player (ES module, inlined into the HTML by pack.py)
//   fonts.json                  every woff2 shipped by Excalidraw, base64, keyed "<Family>/<file>.woff2"
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const root = import.meta.dirname;
const outDir = path.join(root, "..", "vendor");
const fontsDir = path.join(root, "node_modules/@excalidraw/excalidraw/dist/prod/fonts");
fs.mkdirSync(outDir, { recursive: true });

const result = await esbuild.build({
  entryPoints: [path.join(root, "src/main.tsx")],
  outfile: path.join(outDir, "player.js"),
  bundle: true, minify: true, format: "esm", target: "es2020", jsx: "automatic",
  conditions: ["production"], legalComments: "none", metafile: true, logLevel: "info",
  // standard bundler configuration documented by React / Excalidraw, not edits to their code:
  define: { "process.env.NODE_ENV": '"production"', "process.env.IS_PREACT": '"false"' },
  loader: { ".woff2": "dataurl", ".png": "dataurl", ".svg": "dataurl" },
});

/* ---- fonts: straight copy of what the package ships ---- */
const fonts = {};
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".woff2")) fonts[path.relative(fontsDir, p).split(path.sep).join("/")] = fs.readFileSync(p).toString("base64");
  }
})(fontsDir);
fs.writeFileSync(path.join(outDir, "fonts.json"), JSON.stringify(fonts));

const size = (f) => (fs.statSync(path.join(outDir, f)).size / 1e6).toFixed(1);
console.log(`player.js ${size("player.js")} MB, player.css ${size("player.css")} MB, fonts.json ${size("fonts.json")} MB (${Object.keys(fonts).length} font files)`);
