#!/usr/bin/env node
// CI guard: index.html must not preload heavy chunks and the entry must stay under budget; run after vite build.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { checkBundleBudget } from "../src/utils/bundleBudget.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = process.argv[2] ?? join(__dirname, "..", "dist");
const BUDGET_BYTES = 1_400_000;

const html = readFileSync(join(distDir, "index.html"), "utf8");
const gzipSizeOf = (asset) =>
  gzipSync(readFileSync(join(distDir, asset))).length;

const { assets, forbidden, gzipBytes, overBudget } = checkBundleBudget(html, gzipSizeOf, BUDGET_BYTES);

console.log(`Entry assets: ${assets.length}, ${(gzipBytes / 1024).toFixed(0)} KB gzip (budget ${(BUDGET_BYTES / 1024).toFixed(0)} KB)`);
for (const asset of assets) console.log(`  ${asset}`);

if (forbidden.length > 0) {
  console.error(`\nHeavy chunks preloaded by index.html:\n  ${forbidden.join("\n  ")}`);
}
if (overBudget) {
  console.error(`\nEntry payload ${gzipBytes} B gzip exceeds the ${BUDGET_BYTES} B budget.`);
}
process.exit(forbidden.length > 0 || overBudget ? 1 : 0);
