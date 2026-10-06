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

import { MAX_FIT_SCALE, fitScale } from "./hexViewport";
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

// Widening lowers the fit scale, which needs more width again; this converges in a few rounds.
const MAX_WIDEN_ROUNDS = 8;

// Run sums equal a cursor position exactly, but float addition order differs.
const EPSILON = 1e-9;

let last: { params: LayoutParams; layout: HexLayout } | null = null;

export function hexLayout(params: LayoutParams): HexLayout {
  if (last && sameParams(last.params, params)) return last.layout;
  const layout = computeLayout(params);
  last = { params, layout };
  return layout;
}

export function packedSpan(params: LayoutParams, shelfWidth: number) {
  return pack(blocksOf(params), shelfWidth);
}

// Only a shelf width equal to a contiguous run of blocks can change a greedy packing.
export function shelfCandidates(widths: readonly number[]): number[] {
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

function blocksOf(params: LayoutParams, minWidth = MIN_FRAME_WIDTH): Block[] {
  const framed = isFramed(params);
  const pad = framed ? PAD : 0;
  const band = framed ? LABEL_BAND : 0;
  return params.groups.map((keys) => {
    const n = keys.length;
    const cols = Math.max(1, Math.min(n, Math.ceil(Math.sqrt((n * ROW_STEP) / HEX_WIDTH))));
    const rows = Math.ceil(n / cols);
    const contentWidth = cols * HEX_WIDTH + (rows > 1 ? HEX_HALF_WIDTH : 0);
    const contentHeight = (rows - 1) * ROW_STEP + 2 * HEX_HALF_HEIGHT;
    const width = Math.max(contentWidth + 2 * pad, framed ? minWidth : 0);
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

function bestShelf(blocks: Block[], params: LayoutParams) {
  let best = { width: 0, scale: -Infinity };
  for (const width of shelfCandidates(blocks.map((b) => b.width))) {
    const { spanX, spanY } = pack(blocks, width);
    const scale = fitScale(spanX, spanY, params.width, params.height, params.bottomInset);
    if (scale > best.scale) best = { width, scale };
  }
  return best.width;
}

// A pixel minimum depends on the fit scale, which depends on the widths, so widen until it holds.
function blocksWithMinPx(params: LayoutParams) {
  const plain = blocksOf(params);
  let blocks = plain;
  let minWidth = MIN_FRAME_WIDTH;
  for (let round = 0; ; round++) {
    const { spanX, spanY } = pack(blocks, bestShelf(blocks, params));
    const scale = Math.min(
      fitScale(spanX, spanY, params.width, params.height, params.bottomInset),
      MAX_FIT_SCALE,
    );
    // Wider cards are only worth it while the header band can still show a title.
    if (round > 0 && scale * LABEL_BAND < (params.minBandPx ?? 0)) {
      pack(plain, bestShelf(plain, params));
      return plain;
    }
    const needed = (params.minFramePx ?? 0) / scale;
    if (needed <= minWidth + EPSILON || round === MAX_WIDEN_ROUNDS) return blocks;
    minWidth = needed;
    blocks = blocksOf(params, minWidth);
  }
}

function computeLayout(params: LayoutParams): HexLayout {
  const framed = isFramed(params);
  const pad = framed ? PAD : 0;
  const band = framed ? LABEL_BAND : 0;
  const blocks = blocksWithMinPx(params);
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
      y[index] = -(block.top + pad + band + HEX_HALF_HEIGHT + row * ROW_STEP);
    }
    const frame = {
      left: block.left,
      right: block.left + block.width,
      top: -block.top,
      bottom: -(block.top + block.height),
      headerBottom: -(block.top + pad + band),
    };
    if (framed) frames.push(frame);
    bounds.maxX = Math.max(bounds.maxX, frame.right);
    bounds.minY = Math.min(bounds.minY, frame.bottom);
  }
  return { x, y, frames, bounds };
}
