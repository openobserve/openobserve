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

import type { HexBounds } from "./hexLayout";

export interface ViewState {
  scale: number;
  cx: number;
  cy: number;
}

export interface ViewSize {
  width: number;
  height: number;
  fit: number;
}

// A handful of hexes must not grow huge.
export const MAX_FIT_SCALE = 44;

export const MAX_ZOOM = 20;

export const WHEEL_FACTOR = 1.2;

const CLICK_SLOP = 4;

export const PAD_SHARE = 0.04;

// Uncapped, so callers comparing packings can tell them apart.
export function fitScale(
  spanX: number,
  spanY: number,
  width: number,
  height: number,
  bottomInset = 0,
) {
  const pad = PAD_SHARE * Math.min(width, height);
  return Math.min(
    (width - 2 * pad) / Math.max(spanX, 1e-9),
    (height - bottomInset - 2 * pad) / Math.max(spanY, 1e-9),
  );
}

// The bounds are centred in the band above the bottom overlays, so none covers a hex at fit.
export function fit(bounds: HexBounds, width: number, height: number, bottomInset = 0): ViewState {
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const scale = Math.max(
    Math.min(fitScale(spanX, spanY, width, height, bottomInset), MAX_FIT_SCALE),
    1e-6,
  );
  return {
    scale,
    cx: (bounds.minX + bounds.maxX) / 2,
    cy: (bounds.minY + bounds.maxY) / 2 - bottomInset / (2 * scale),
  };
}

// One scale for both axes, so a hex never stretches.
export function axisRanges(state: ViewState, width: number, height: number) {
  const halfX = width / 2 / state.scale;
  const halfY = height / 2 / state.scale;
  return {
    x: [state.cx - halfX, state.cx + halfX] as [number, number],
    y: [state.cy - halfY, state.cy + halfY] as [number, number],
  };
}

// Pixels are from the canvas top-left; the layout's y axis points up.
export function toLayout(state: ViewState, px: number, py: number, size: ViewSize) {
  return [
    state.cx + (px - size.width / 2) / state.scale,
    state.cy - (py - size.height / 2) / state.scale,
  ] as [number, number];
}

export function zoomAt(
  state: ViewState,
  px: number,
  py: number,
  factor: number,
  size: ViewSize,
): ViewState {
  const [lx, ly] = toLayout(state, px, py, size);
  const scale = Math.min(Math.max(state.scale * factor, size.fit), size.fit * MAX_ZOOM);
  return {
    scale,
    cx: lx - (px - size.width / 2) / scale,
    cy: ly + (py - size.height / 2) / scale,
  };
}

export function pan(state: ViewState, dx: number, dy: number): ViewState {
  return { scale: state.scale, cx: state.cx - dx / state.scale, cy: state.cy + dy / state.scale };
}

// The map follows the fingers' midpoint and scales by their separation, as one gesture.
export function pinch(
  state: ViewState,
  from: { x: number; y: number }[],
  to: { x: number; y: number }[],
  size: ViewSize,
): ViewState {
  const mid = (p: { x: number; y: number }[]) => [(p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2];
  const span = (p: { x: number; y: number }[]) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  const [x0, y0] = mid(from);
  const [x1, y1] = mid(to);
  const moved = pan(state, x1 - x0, y1 - y0);
  const before = span(from);
  return before > 0 && span(to) !== before ? zoomAt(moved, x1, y1, span(to) / before, size) : moved;
}

export function isClick(dx: number, dy: number) {
  return Math.hypot(dx, dy) < CLICK_SLOP;
}
