import path from "node:path";
import fs from "node:fs";
import { walkFiles, measureBuffer } from "./util.mjs";

// Categorize an asset by filename so we can attribute weight to vendors of
// interest (quasar vs reka-ui, echarts, monaco, etc.).
function categorize(name) {
  const n = name.toLowerCase();
  if (n.includes("quasar")) return "quasar";
  if (n.includes("reka")) return "reka-ui";
  if (n.includes("monaco") || n.includes("editor.api")) return "monaco";
  if (n.includes("echarts")) return "echarts";
  if (n.includes("moment")) return "moment";
  if (n.includes("lodash")) return "lodash";
  if (n.includes("gridstack")) return "gridstack";
  if (n.includes("leaflet")) return "leaflet";
  if (n.includes("vendor")) return "vendor";
  return "app";
}

// Measure total + per-type + per-category weight of a built dist/.
export async function measureBundle(distDir) {
  const assetsDir = path.join(distDir, "assets");
  const dir = fs.existsSync(assetsDir) ? assetsDir : distDir;
  const files = walkFiles(dir, [".js", ".css"]);

  const totals = {
    js: { raw: 0, gzip: 0, brotli: 0, count: 0 },
    css: { raw: 0, gzip: 0, brotli: 0, count: 0 },
    all: { raw: 0, gzip: 0, brotli: 0, count: 0 },
  };
  const byCategory = {};
  const largest = [];

  for (const file of files) {
    const buf = fs.readFileSync(file);
    const sizes = await measureBuffer(buf);
    const ext = path.extname(file) === ".css" ? "css" : "js";
    const name = path.basename(file);
    const cat = categorize(name);

    for (const bucket of [totals[ext], totals.all]) {
      bucket.raw += sizes.raw;
      bucket.gzip += sizes.gzip;
      bucket.brotli += sizes.brotli;
      bucket.count += 1;
    }
    byCategory[cat] ||= { raw: 0, gzip: 0, brotli: 0, count: 0 };
    byCategory[cat].raw += sizes.raw;
    byCategory[cat].gzip += sizes.gzip;
    byCategory[cat].brotli += sizes.brotli;
    byCategory[cat].count += 1;

    largest.push({ name, ...sizes });
  }

  largest.sort((a, b) => b.gzip - a.gzip);

  // Also count the initial entry payload referenced by index.html (the app
  // shell the browser must download before anything renders).
  const initial = await measureInitial(distDir);

  return { totals, byCategory, largest: largest.slice(0, 15), initial };
}

// Sum the assets referenced directly by <script>/<link> in index.html — a
// proxy for "initial download" independent of route-level code splitting.
async function measureInitial(distDir) {
  const indexPath = path.join(distDir, "index.html");
  if (!fs.existsSync(indexPath)) return null;
  const html = fs.readFileSync(indexPath, "utf8");
  const refs = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1]);
  const agg = { raw: 0, gzip: 0, brotli: 0, count: 0, files: [] };
  for (const ref of refs) {
    const rel = ref.replace(/^\.?\//, "").replace(/^web\//, "");
    const file = path.join(distDir, rel);
    if (!fs.existsSync(file)) continue;
    const sizes = await measureBuffer(fs.readFileSync(file));
    agg.raw += sizes.raw;
    agg.gzip += sizes.gzip;
    agg.brotli += sizes.brotli;
    agg.count += 1;
    agg.files.push({ name: path.basename(file), ...sizes });
  }
  return agg;
}
