// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { MAX_FIT_SCALE, PAD_SHARE, fitScale } from "./hexViewport";
import type { MapEntity, MapGroup } from "./kubernetesQueries";

export interface LayoutParams {
  entity: MapEntity;
  group: MapGroup;
  groups: string[][];
  width: number;
  height: number;
  bottomInset: number;
  minFramePx?: number;
  minBandPx?: number;
  // Packs at this many px per unit, one canvas width wide, instead of fitting the height.
  fixedScale?: number;
  // The header band's screen height; without it the band is LABEL_BAND units.
  bandPx?: number;
  minTitlePx?: number;
}

export interface HexBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// Layout units with y pointing up, as on the chart's value axis.
export interface HexFrame {
  left: number;
  right: number;
  top: number;
  bottom: number;
  headerBottom: number;
}

export interface HexLayout {
  x: Float64Array;
  y: Float64Array;
  frames: HexFrame[];
  bounds: HexBounds;
}

interface Sizing {
  minWidth: number;
  maxWidth: number;
  band: number;
}

interface Block {
  n: number;
  cols: number;
  width: number;
  height: number;
  left: number;
  top: number;
}

export const HEX_HALF_WIDTH = Math.sqrt(3) / 2;

export const HEX_HALF_HEIGHT = 1;

const LABEL_BAND = 2;

const HEX_WIDTH = 2 * HEX_HALF_WIDTH;

const ROW_STEP = 1.5;

const PAD = 0.5;

const GAP = 1;

// Leaves a one-hex group's frame room for a readable label.
const MIN_FRAME_WIDTH = 8;

// Bounds the shelf search to 200 packings however many groups there are.
const MAX_SHELF_CANDIDATES = 200;

// Past this many run sums, listing them all costs more than sampling them.
const MAX_LISTED_RUN_SUMS = 2000;

const MAX_SETTLE_ROUNDS = 12;

const SETTLED_PX = 0.25;

// Run sums equal a cursor position exactly, but float addition order differs.
const EPSILON = 1e-9;

// Run sums closer than this are one candidate, as in the listed path's rounding.
const SAME_SUM = 1e-6;

let last: { params: LayoutParams; layout: HexLayout } | null = null;

export function hexLayout(params: LayoutParams): HexLayout {
  if (last && sameParams(last.params, params)) return last.layout;
  const layout = computeLayout(params);
  last = { params, layout };
  return layout;
}

// Only a shelf width equal to a contiguous run of blocks can change a greedy packing.
export function shelfCandidates(widths: readonly number[]): number[] {
  const n = widths.length;
  if ((n * (n + 1)) / 2 > MAX_LISTED_RUN_SUMS) return sampledRunSums(widths);
  const widest = Math.max(0, ...widths);
  const sums = new Map<number, number>();
  for (let i = 0; i < widths.length; i++) {
    let sum = -GAP;
    for (let j = i; j < widths.length; j++) {
      sum += widths[j] + GAP;
      if (sum >= widest - EPSILON) sums.set(Math.round(sum * 1e6), sum);
    }
  }
  const sorted = [...sums.values()].sort((a, b) => a - b);
  if (sorted.length <= MAX_SHELF_CANDIDATES) return sorted;
  const step = (sorted.length - 1) / (MAX_SHELF_CANDIDATES - 1);
  return Array.from({ length: MAX_SHELF_CANDIDATES }, (_, k) => sorted[Math.round(k * step)]);
}

// Up to 200 distinct run sums in O(200 · B): all of them if there are no more, else one per target.
function sampledRunSums(widths: readonly number[]): number[] {
  const n = widths.length;
  const prefix = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) prefix[k + 1] = prefix[k] + widths[k] + GAP;
  const atLeast = (target: number) => {
    let best = Infinity;
    for (let i = 0, j = 1; i < n; i++) {
      j = Math.max(j, i + 1);
      while (j <= n && prefix[j] - prefix[i] - GAP < target) j++;
      if (j > n) break;
      best = Math.min(best, prefix[j] - prefix[i] - GAP);
    }
    return best;
  };
  const widest = widths.reduce((max, w) => Math.max(max, w), 0);
  const total = prefix[n] - GAP;
  const step = (total - widest) / (MAX_SHELF_CANDIDATES - 1);
  const sampled: number[] = [];
  for (let k = 0; k < MAX_SHELF_CANDIDATES; k++) {
    const v = atLeast(widest + k * step - EPSILON);
    if (!sampled.length || v - sampled[sampled.length - 1] >= SAME_SUM) sampled.push(v);
  }
  if (sampled.length === MAX_SHELF_CANDIDATES) return sampled;
  // Duplicates mean the targets may have skipped values, so list them all if there are few.
  const distinct: number[] = [];
  for (let v = atLeast(widest - EPSILON); v < Infinity; v = atLeast(v + SAME_SUM)) {
    distinct.push(v);
    if (distinct.length > MAX_SHELF_CANDIDATES) return sampled;
  }
  return distinct;
}

// Strips a shared ".domain" suffix, e.g. EKS's ".ec2.internal"; never a prefix.
export function shortGroupNames(names: readonly string[]): string[] {
  if (names.length < 2) return [...names];
  const first = names[0];
  for (let i = first.indexOf("."); i > 0; i = first.indexOf(".", i + 1)) {
    const suffix = first.slice(i);
    if (names.every((n) => n.length > suffix.length && n.endsWith(suffix))) {
      return names.map((n) => n.slice(0, n.length - suffix.length));
    }
  }
  return [...names];
}

// Truncates each title to its width; where two would then read alike, keeps the part that differs.
export function distinctTitles(
  titles: readonly string[],
  widths: readonly number[],
  measure: (s: string) => number,
): string[] {
  const out = titles.map((t, i) => middleTruncate(t, widths[i], measure));
  const byText = new Map<string, number[]>();
  out.forEach((t, i) => byText.set(t, [...(byText.get(t) ?? []), i]));
  for (const same of byText.values()) {
    if (same.length < 2) continue;
    for (const i of same) {
      const peers = same.filter((j) => j !== i && titles[j] !== titles[i]).map((j) => titles[j]);
      if (peers.length) out[i] = aroundDifference(titles[i], peers, widths[i], measure);
    }
  }
  return out;
}

// Keeps the head and the tail, where names differ, around an ellipsis.
export function middleTruncate(text: string, maxPx: number, measure: (s: string) => number) {
  if (measure(text) <= maxPx) return text;
  const cut = (kept: number) =>
    `${text.slice(0, Math.ceil(kept / 2))}…${text.slice(text.length - Math.floor(kept / 2))}`;
  let [lo, hi] = [0, text.length - 1];
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(cut(mid)) <= maxPx) lo = mid;
    else hi = mid - 1;
  }
  return measure(cut(lo)) <= maxPx ? cut(lo) : "";
}

function sameParams(a: LayoutParams, b: LayoutParams) {
  if (a.entity !== b.entity || a.group !== b.group) return false;
  if (a.width !== b.width || a.height !== b.height || a.bottomInset !== b.bottomInset) return false;
  if ((a.minFramePx ?? 0) !== (b.minFramePx ?? 0)) return false;
  if ((a.minBandPx ?? 0) !== (b.minBandPx ?? 0)) return false;
  if ((a.fixedScale ?? 0) !== (b.fixedScale ?? 0)) return false;
  if ((a.bandPx ?? 0) !== (b.bandPx ?? 0)) return false;
  if ((a.minTitlePx ?? 0) !== (b.minTitlePx ?? 0)) return false;
  if (a.groups.length !== b.groups.length) return false;
  for (let g = 0; g < a.groups.length; g++) {
    const [ka, kb] = [a.groups[g], b.groups[g]];
    if (ka.length !== kb.length) return false;
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return false;
  }
  return true;
}

function isFramed(params: LayoutParams) {
  return params.group !== "none";
}

function blocksOf(params: LayoutParams, sizing: Sizing): Block[] {
  const framed = isFramed(params);
  const pad = framed ? PAD : 0;
  const band = framed ? sizing.band : 0;
  return params.groups.map((keys) => {
    const n = keys.length;
    const fitCols = Math.floor((sizing.maxWidth - 2 * pad - HEX_HALF_WIDTH) / HEX_WIDTH);
    const square = Math.ceil(Math.sqrt((n * ROW_STEP) / HEX_WIDTH));
    const cols = Math.max(1, Math.min(n, square, fitCols));
    const rows = Math.ceil(n / cols);
    const contentWidth = cols * HEX_WIDTH + (rows > 1 ? HEX_HALF_WIDTH : 0);
    const contentHeight = (rows - 1) * ROW_STEP + 2 * HEX_HALF_HEIGHT;
    const width = Math.max(contentWidth + 2 * pad, framed ? sizing.minWidth : 0);
    return { n, cols, width, height: contentHeight + 2 * pad + band, left: 0, top: 0 };
  });
}

function pack(blocks: Block[], shelfWidth: number) {
  let cursorX = 0;
  let cursorY = 0;
  let shelfHeight = 0;
  let spanX = 0;
  for (const block of blocks) {
    if (cursorX > 0 && cursorX + block.width > shelfWidth + EPSILON) {
      cursorY += shelfHeight + GAP;
      cursorX = 0;
      shelfHeight = 0;
    }
    block.left = cursorX;
    block.top = cursorY;
    spanX = Math.max(spanX, cursorX + block.width);
    cursorX += block.width + GAP;
    shelfHeight = Math.max(shelfHeight, block.height);
  }
  return { spanX, spanY: cursorY + shelfHeight };
}

function bestShelf(blocks: Block[], params: LayoutParams, candidates: readonly number[]) {
  let best = { width: 0, scale: -Infinity };
  for (const width of candidates) {
    const { spanX, spanY } = pack(blocks, width);
    const scale = fitScale(spanX, spanY, params.width, params.height, params.bottomInset);
    if (scale > best.scale) best = { width, scale };
  }
  return best.width;
}

// Pixel sizes depend on the fit scale, which depends on the sizes, so iterate until they hold.
function settled(params: LayoutParams): { blocks: Block[]; sizing: Sizing } {
  const sizing: Sizing = { minWidth: MIN_FRAME_WIDTH, maxWidth: Infinity, band: LABEL_BAND };
  let minFramePx = params.minFramePx ?? 0;
  let noBand = false;
  const candidatesByWidth = new Map<number, number[]>();
  for (let round = 0; ; round++) {
    const blocks = blocksOf(params, sizing);
    // Card widths change only when widened, so a band-only round reuses its shelf candidates.
    let candidates = candidatesByWidth.get(sizing.minWidth);
    if (!candidates) {
      candidates = shelfCandidates(blocks.map((b) => b.width));
      candidatesByWidth.set(sizing.minWidth, candidates);
    }
    const { spanX, spanY } = pack(blocks, bestShelf(blocks, params, candidates));
    const scale = Math.min(
      fitScale(spanX, spanY, params.width, params.height, params.bottomInset),
      MAX_FIT_SCALE,
    );
    // Cards widened for titles are not worth hexes too small to read.
    if (sizing.minWidth > MIN_FRAME_WIDTH && scale * LABEL_BAND < (params.minBandPx ?? 0)) {
      minFramePx = 0;
      sizing.minWidth = MIN_FRAME_WIDTH;
      continue;
    }
    const band = noBand ? 0 : params.bandPx ? params.bandPx / scale : LABEL_BAND;
    const minWidth = Math.max(sizing.minWidth, minFramePx / scale);
    const stable =
      Math.abs(band - sizing.band) * scale < SETTLED_PX && minWidth <= sizing.minWidth + EPSILON;
    const narrowest = blocks.reduce((min, b) => Math.min(min, b.width), Infinity) * scale;
    // A header too narrow for a readable title is no header: the tooltip and nav carry the name.
    if (stable && params.bandPx && !noBand && narrowest < (params.minTitlePx ?? 0)) {
      noBand = true;
      sizing.band = 0;
      continue;
    }
    if (stable || round >= MAX_SETTLE_ROUNDS) return { blocks, sizing };
    Object.assign(sizing, { band, minWidth });
  }
}

function atScale(params: LayoutParams, scale: number): { blocks: Block[]; sizing: Sizing } {
  const pad = PAD_SHARE * params.width;
  const card = Math.max(MIN_FRAME_WIDTH, (params.minFramePx ?? 0) / scale);
  const band = params.bandPx ? params.bandPx / scale : LABEL_BAND;
  const sizing = { minWidth: card, maxWidth: card, band };
  const blocks = blocksOf(params, sizing);
  pack(blocks, (params.width - 2 * pad) / scale);
  return { blocks, sizing };
}

function computeLayout(params: LayoutParams): HexLayout {
  const framed = isFramed(params);
  const pad = framed ? PAD : 0;
  const { blocks, sizing } = params.fixedScale
    ? atScale(params, params.fixedScale)
    : settled(params);
  const band = framed ? sizing.band : 0;
  const total = blocks.reduce((sum, b) => sum + b.n, 0);
  const x = new Float64Array(total);
  const y = new Float64Array(total);
  const frames: HexFrame[] = [];
  const bounds: HexBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  let index = 0;
  for (const block of blocks) {
    for (let i = 0; i < block.n; i++, index++) {
      const row = Math.floor(i / block.cols);
      const col = i % block.cols;
      x[index] =
        block.left + pad + HEX_HALF_WIDTH + col * HEX_WIDTH + (row % 2 ? HEX_HALF_WIDTH : 0);
      y[index] = -(block.top + band + pad + HEX_HALF_HEIGHT + row * ROW_STEP);
    }
    const frame = {
      left: block.left,
      right: block.left + block.width,
      top: -block.top,
      bottom: -(block.top + block.height),
      headerBottom: -(block.top + band),
    };
    if (framed) frames.push(frame);
    bounds.maxX = Math.max(bounds.maxX, frame.right);
    bounds.minY = Math.min(bounds.minY, frame.bottom);
  }
  return { x, y, frames, bounds };
}

// The widest window of `text` that fits and covers where it first and last differs from its peers.
function aroundDifference(
  text: string,
  peers: readonly string[],
  maxPx: number,
  measure: (s: string) => number,
) {
  const common = (a: string, b: string, step: (s: string, k: number) => string) => {
    let k = 0;
    while (k < Math.min(a.length, b.length) && step(a, k) === step(b, k)) k++;
    return k;
  };
  const start = Math.min(...peers.map((p) => common(text, p, (s, k) => s[k])));
  const tail = Math.min(...peers.map((p) => common(text, p, (s, k) => s[s.length - 1 - k])));
  const end = Math.max(start, text.length - tail);
  const show = (a: number, b: number) =>
    `${a > 0 ? "…" : ""}${text.slice(a, b)}${b < text.length ? "…" : ""}`;
  let [a, b] = [Math.min(start, Math.max(0, end - 1)), end];
  if (measure(show(a, b)) > maxPx) return middleTruncate(text, maxPx, measure);
  while (a > 0 || b < text.length) {
    const grown = b < text.length && (a === 0 || b - end <= start - a) ? [a, b + 1] : [a - 1, b];
    if (measure(show(grown[0], grown[1])) > maxPx) break;
    [a, b] = grown;
  }
  return show(a, b);
}
