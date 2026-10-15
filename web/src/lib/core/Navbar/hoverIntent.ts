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

export type Point = { x: number; y: number };

export interface AimState {
  exit: Point | null;
  last: Point | null;
  movedAt: number;
  flyout: HTMLElement | null;
}

export const AIM_SLACK = 12;
export const AIM_IDLE = 150;
export const REST_TOLERANCE = 4;

// Shared by every ONavGroup: only one flyout is open, so one aim is ever live.
export const aim: AimState = { exit: null, last: null, movedAt: 0, flyout: null };

export function trackPointer(e: PointerEvent): void {
  aim.last = { x: e.clientX, y: e.clientY };
  aim.movedAt = performance.now();
}

let pointerTrackers = 0;

// Two groups swap open and closed in one flush in either order, so the shared listener is counted, not toggled.
export function retainPointerTracking(): void {
  if (pointerTrackers++ === 0) document.addEventListener("pointermove", trackPointer, true);
}

export function releasePointerTracking(): void {
  if (pointerTrackers === 0) return;
  if (--pointerTrackers === 0) document.removeEventListener("pointermove", trackPointer, true);
}

function sign(p: Point, a: Point, b: Point): number {
  return (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
}

// Apex sits AIM_SLACK behind the exit point so a pointer that drifts back a hair is still aiming.
export function aimTriangle(exit: Point, flyout: DOMRect, rtl: boolean): [Point, Point, Point] {
  const edgeX = rtl ? flyout.right : flyout.left;
  const apex = { x: exit.x + (rtl ? AIM_SLACK : -AIM_SLACK), y: exit.y };
  const top = { x: edgeX, y: flyout.top - AIM_SLACK };
  const bottom = { x: edgeX, y: flyout.bottom + AIM_SLACK };
  return [apex, top, bottom];
}

export function isPointInTriangle(p: Point, tri: [Point, Point, Point]): boolean {
  const [a, b, c] = tri;
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

// True only while the pointer is still travelling: a rest of AIM_IDLE ends the aim.
export function isAimingAtOpenFlyout(now: number = performance.now()): boolean {
  const { exit, last, flyout } = aim;
  if (!exit || !last || !flyout) return false;
  if (now - aim.movedAt > AIM_IDLE) return false;
  const rtl = document.documentElement.dir === "rtl";
  return isPointInTriangle(last, aimTriangle(exit, flyout.getBoundingClientRect(), rtl));
}
