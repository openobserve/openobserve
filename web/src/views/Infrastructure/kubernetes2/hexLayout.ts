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

import type { MapEntity, MapGroup } from "./kubernetesQueries";

export interface LayoutParams {
  entity: MapEntity;
  group: MapGroup;
  groups: string[][];
  width: number;
  height: number;
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
  labelX: number;
  labelY: number;
}

export interface HexLayout {
  x: Float64Array;
  y: Float64Array;
  frames: HexFrame[];
  bounds: HexBounds;
}

export const HEX_HALF_WIDTH = Math.sqrt(3) / 2;

export const HEX_HALF_HEIGHT = 1;

const HEX_WIDTH = 2 * HEX_HALF_WIDTH;

const ROW_STEP = 1.5;

const PAD = 0.75;

const LABEL_BAND = 2;

const GAP = 1.5;

// Leaves a one-hex group's frame room for a readable label.
const MIN_FRAME_WIDTH = 8;

let last: { params: LayoutParams; layout: HexLayout } | null = null;

export function hexLayout(params: LayoutParams): HexLayout {
  if (last && sameParams(last.params, params)) return last.layout;
  const layout = computeLayout(params);
  last = { params, layout };
  return layout;
}

function sameParams(a: LayoutParams, b: LayoutParams) {
  if (a.entity !== b.entity || a.group !== b.group) return false;
  if (a.width !== b.width || a.height !== b.height || a.groups.length !== b.groups.length) {
    return false;
  }
  for (let g = 0; g < a.groups.length; g++) {
    const [ka, kb] = [a.groups[g], b.groups[g]];
    if (ka.length !== kb.length) return false;
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return false;
  }
  return true;
}

function computeLayout(params: LayoutParams): HexLayout {
  const framed = params.entity === "pods" && params.group !== "none";
  const pad = framed ? PAD : 0;
  const band = framed ? LABEL_BAND : 0;
  const blocks = params.groups.map((keys) => {
    const n = keys.length;
    const cols = Math.max(1, Math.min(n, Math.ceil(Math.sqrt((n * ROW_STEP) / HEX_WIDTH))));
    const rows = Math.ceil(n / cols);
    const contentWidth = cols * HEX_WIDTH + (rows > 1 ? HEX_HALF_WIDTH : 0);
    const contentHeight = (rows - 1) * ROW_STEP + 2 * HEX_HALF_HEIGHT;
    const width = Math.max(contentWidth + 2 * pad, framed ? MIN_FRAME_WIDTH : 0);
    return { n, cols, width, height: contentHeight + 2 * pad + band, left: 0, top: 0 };
  });
  const area = blocks.reduce((sum, b) => sum + (b.width + GAP) * (b.height + GAP), 0);
  const aspect = params.width > 0 && params.height > 0 ? params.width / params.height : 1.6;
  const widest = blocks.reduce((max, b) => Math.max(max, b.width), 0);
  const shelfWidth = Math.max(widest, Math.sqrt(area * aspect));
  let cursorX = 0;
  let cursorY = 0;
  let shelfHeight = 0;
  for (const block of blocks) {
    if (cursorX > 0 && cursorX + block.width > shelfWidth) {
      cursorY += shelfHeight + GAP;
      cursorX = 0;
      shelfHeight = 0;
    }
    block.left = cursorX;
    block.top = cursorY;
    cursorX += block.width + GAP;
    shelfHeight = Math.max(shelfHeight, block.height);
  }
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
      labelX: block.left + pad,
      labelY: -(block.top + pad + band / 2),
    };
    if (framed) frames.push(frame);
    bounds.maxX = Math.max(bounds.maxX, frame.right);
    bounds.minY = Math.min(bounds.minY, frame.bottom);
  }
  return { x, y, frames, bounds };
}
