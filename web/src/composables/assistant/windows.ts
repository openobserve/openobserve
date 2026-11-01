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

import type { FloatingWindow, WindowCorner, WindowGeometry } from "./assistantStore.types";

export const MAX_FLOATING_CHATS = 4;

export const WINDOW_DEFAULT_W_REM = 24;

export const WINDOW_DEFAULT_H_REM = 36;

export const WINDOW_MIN_W_REM = 20;

export const WINDOW_MIN_H_REM = 24;

/** Below this width Layout folds into More (PO A15, B95). */
export const WINDOW_NARROW_REM = 24;

/** Wider, Narrower, Taller and Shorter step by this much (PO B93). */
export const WINDOW_STEP_REM = 4;

export const WINDOW_INSET_REM = 1;

/** The tray's offset plus its 2.5 rem bar. */
export const TRAY_FOOTPRINT_REM = 3;

/** A window's bottom edge stays this far above the tray-and-notice band (PO B99). */
export const BAND_GAP_REM = 0.5;

/** A tear-off starts after the pointer travels this far toward the page. */
export const TEAR_OFF_REM = 1;

const WINDOW_MAX_W_REM = 40;

const WINDOW_MAX_W_SHARE = 0.6;

const CASCADE_REM = 2;

const SNAP_CORNER_REM = 1.5;

const SNAP_EDGE_REM = 1;

const DROP_ZONE_REM = 3;

const WIDE_VIEWPORT_REM = 80;

const LG_VIEWPORT_REM = 64;

const CORNERS: readonly WindowCorner[] = ["top-start", "top-end", "bottom-start", "bottom-end"];

/** The page area in rem from the viewport's start and top edges; a window never leaves it. */
export interface PageArea {
  start: number;
  end: number;
  top: number;
  bottom: number;
  viewport: number;
}

/** A drawn window, in the same coordinates as `PageArea`. */
export interface WindowRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export type DropTarget = "sidebar" | "tray" | null;

/** How many windows may stay open at this width: 2 at 1280 px and up, 1 at 1024–1279, none below. */
export function openWindowCap(viewportRem: number): number {
  if (viewportRem >= WIDE_VIEWPORT_REM) return 2;
  return viewportRem >= LG_VIEWPORT_REM ? 1 : 0;
}

export function defaultGeometry(): WindowGeometry {
  return {
    corner: "bottom-end",
    dxRem: WINDOW_INSET_REM,
    dyRem: WINDOW_INSET_REM,
    wRem: WINDOW_DEFAULT_W_REM,
    hRem: WINDOW_DEFAULT_H_REM,
  };
}

/** The next window steps toward the start and top while its spot is taken. */
export function cascadeGeometry(taken: readonly FloatingWindow[]): WindowGeometry {
  const next = defaultGeometry();
  const occupied = (geometry: WindowGeometry) =>
    taken.some(
      ({ geometry: other, state }) =>
        state === "open" &&
        other.corner === geometry.corner &&
        other.dxRem === geometry.dxRem &&
        other.dyRem === geometry.dyRem,
    );
  while (occupied(next)) {
    next.dxRem += CASCADE_REM;
    next.dyRem += CASCADE_REM;
  }
  return next;
}

export function sizeLimits(area: PageArea): { maxW: number; maxH: number } {
  const maxW = Math.min(
    WINDOW_MAX_W_REM,
    area.viewport * WINDOW_MAX_W_SHARE,
    area.end - area.start,
  );
  return {
    maxW: Math.max(WINDOW_MIN_W_REM, maxW),
    maxH: Math.max(WINDOW_MIN_H_REM, area.bottom - area.top),
  };
}

/** Clamps size to min and max, then position into the page, keeping the bottom edge above the band. */
export function clampRect(rect: WindowRect, area: PageArea, bandRem = 0): WindowRect {
  const { maxW, maxH } = sizeLimits(area);
  const floor = bandFloor(area, bandRem);
  const w = clamp(rect.w, WINDOW_MIN_W_REM, maxW);
  // The height gives way toward its minimum only when moving up is not enough (PO B99).
  const h = Math.max(WINDOW_MIN_H_REM, Math.min(rect.h, maxH, floor - area.top));
  return {
    w,
    h,
    x: clamp(rect.x, area.start, Math.max(area.start, area.end - w)),
    y: clamp(rect.y, area.top, Math.max(area.top, floor - h)),
  };
}

/** The stored corner-relative geometry as a rect in this page, clear of the tray-and-notice band. */
export function rectOf(geometry: WindowGeometry, area: PageArea, bandRem = 0): WindowRect {
  const { corner, dxRem, dyRem, wRem, hRem } = geometry;
  const atEnd = corner.endsWith("end");
  const atBottom = corner.startsWith("bottom");
  // A stored offset from the bottom never counts the band, so the window goes back when the band shrinks.
  return clampRect(
    {
      w: wRem,
      h: hRem,
      x: atEnd ? area.end - dxRem - wRem : area.start + dxRem,
      y: atBottom ? area.bottom - dyRem - hRem : area.top + dyRem,
    },
    area,
    bandRem,
  );
}

/** The rect as offsets from its nearest corner, so a browser resize keeps the window there. */
export function geometryOf(rect: WindowRect, area: PageArea): WindowGeometry {
  const fromStart = rect.x - area.start;
  const fromEnd = area.end - rect.x - rect.w;
  const fromTop = rect.y - area.top;
  const fromBottom = area.bottom - rect.y - rect.h;
  const horizontal = fromEnd <= fromStart ? "end" : "start";
  const vertical = fromBottom <= fromTop ? "bottom" : "top";
  return {
    corner: `${vertical}-${horizontal}`,
    dxRem: horizontal === "end" ? fromEnd : fromStart,
    dyRem: vertical === "bottom" ? fromBottom : fromTop,
    wRem: rect.w,
    hRem: rect.h,
  };
}

/** Near a corner the window snaps to a 1 rem inset; near one edge it aligns to that edge's inset. */
export function snapRect(rect: WindowRect, area: PageArea, bandRem = 0): WindowRect {
  const floor = bandFloor(area, bandRem);
  const gaps = {
    start: rect.x - area.start,
    end: area.end - rect.x - rect.w,
    top: rect.y - area.top,
    bottom: floor - rect.y - rect.h,
  };
  const near = (gap: number) => gap <= SNAP_EDGE_REM + WINDOW_INSET_REM;
  const xEdge = Math.min(gaps.start, gaps.end);
  const yEdge = Math.min(gaps.top, gaps.bottom);
  const corner = xEdge <= SNAP_CORNER_REM && yEdge <= SNAP_CORNER_REM;
  const next = { ...rect };
  if (corner || near(xEdge))
    next.x =
      gaps.start <= gaps.end ? area.start + WINDOW_INSET_REM : area.end - rect.w - WINDOW_INSET_REM;
  if (corner || near(yEdge))
    next.y =
      gaps.top <= gaps.bottom
        ? area.top + WINDOW_INSET_REM
        : floor - rect.h - (bandRem > 0 ? 0 : WINDOW_INSET_REM);
  return next;
}

/** Which drop target the pointer is over, in the page's coordinates. */
export function dropTargetAt(x: number, y: number, area: PageArea): DropTarget {
  if (area.end - x <= DROP_ZONE_REM) return "sidebar";
  return area.bottom - y <= DROP_ZONE_REM ? "tray" : null;
}

/** One live step of a resize: the dragged edges move, the opposite ones stay put. */
export function resizeRect(
  start: WindowRect,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  area: PageArea,
  bandRem = 0,
): WindowRect {
  const { maxW, maxH } = sizeLimits(area);
  const floor = bandFloor(area, bandRem);
  const west = edge.includes("w");
  const north = edge.includes("n");
  const rawW = start.w + (edge.includes("e") ? dx : west ? -dx : 0);
  const rawH = start.h + (edge.includes("s") ? dy : north ? -dy : 0);
  const roomW = west ? start.x + start.w - area.start : area.end - start.x;
  const roomH = north ? start.y + start.h - area.top : floor - start.y;
  const w = clamp(rawW, WINDOW_MIN_W_REM, Math.min(maxW, Math.max(WINDOW_MIN_W_REM, roomW)));
  const h = clamp(rawH, WINDOW_MIN_H_REM, Math.min(maxH, Math.max(WINDOW_MIN_H_REM, roomH)));
  return {
    w,
    h,
    x: west ? start.x + start.w - w : start.x,
    y: north ? start.y + start.h - h : start.y,
  };
}

/** The corners a window can move to, its current one left out. */
export function otherCorners(current: WindowCorner): WindowCorner[] {
  return CORNERS.filter((corner) => corner !== current);
}

/** The geometry of a window parked 1 rem in from `corner` at its current size. */
export function atCorner(geometry: WindowGeometry, corner: WindowCorner): WindowGeometry {
  return { ...geometry, corner, dxRem: WINDOW_INSET_REM, dyRem: WINDOW_INSET_REM };
}

/** True when `outer` hides the whole of `inner`; a part left showing still takes the focus ring. */
export function coversFully(outer: DOMRect, inner: DOMRect): boolean {
  return (
    outer.left <= inner.left &&
    outer.right >= inner.right &&
    outer.top <= inner.top &&
    outer.bottom >= inner.bottom
  );
}

export function intersects(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function bandFloor(area: PageArea, bandRem: number): number {
  return bandRem > 0 ? area.bottom - bandRem - BAND_GAP_REM : area.bottom;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
