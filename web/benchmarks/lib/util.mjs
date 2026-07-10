import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";

const gzip = promisify(zlib.gzip);
const brotli = promisify(zlib.brotliCompress);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function median(nums) {
  const arr = nums.filter((n) => typeof n === "number" && !Number.isNaN(n)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

export function formatBytes(bytes) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

// Compute raw + gzip + brotli size of a buffer.
export async function measureBuffer(buf) {
  const [g, b] = await Promise.all([gzip(buf), brotli(buf)]);
  return { raw: buf.length, gzip: g.length, brotli: b.length };
}

// Recursively list files under dir matching an extension set.
export function walkFiles(dir, exts) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, exts));
    else if (!exts || exts.includes(path.extname(entry.name))) out.push(full);
  }
  return out;
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// Percentage delta (current vs baseline), negative = improvement for
// "lower is better" metrics.
export function pctDelta(baseline, current) {
  if (baseline == null || current == null || baseline === 0) return null;
  return ((current - baseline) / baseline) * 100;
}

export function log(...args) {
  // eslint-disable-next-line no-console
  console.log("[bench]", ...args);
}
