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

import { describe, expect, it } from "vitest";

import type { FloatingWindow } from "./assistantStore.types";
import {
  TRAY_FOOTPRINT_REM,
  atCorner,
  cascadeGeometry,
  clampRect,
  coversFully,
  defaultGeometry,
  dropTargetAt,
  geometryOf,
  intersects,
  openWindowCap,
  otherCorners,
  rectOf,
  resizeRect,
  sizeLimits,
  snapRect,
  type PageArea,
} from "./windows";

const AREA: PageArea = { start: 6, end: 90, top: 3, bottom: 60, viewport: 90 };

const dom = (left: number, top: number, right: number, bottom: number) =>
  ({ left, top, right, bottom }) as DOMRect;

describe("caps", () => {
  it.each([
    [90, 2],
    [80, 2],
    [79.9, 1],
    [64, 1],
    [63.9, 0],
  ])("at %s rem allows %s open windows", (rem, cap) => {
    expect(openWindowCap(rem)).toBe(cap);
  });
});

describe("placement", () => {
  it("cascades 2 rem toward the start and top while the spot is taken", () => {
    const taken: FloatingWindow[] = [{ sid: "a", state: "open", geometry: defaultGeometry() }];
    expect(cascadeGeometry([])).toEqual(defaultGeometry());
    expect(cascadeGeometry(taken)).toMatchObject({ dxRem: 3, dyRem: 3 });
    taken.push({ sid: "b", state: "open", geometry: cascadeGeometry(taken) });
    expect(cascadeGeometry(taken)).toMatchObject({ dxRem: 5, dyRem: 5 });
  });

  it("ignores a minimised window's spot", () => {
    const tray: FloatingWindow[] = [{ sid: "a", state: "minimised", geometry: defaultGeometry() }];
    expect(cascadeGeometry(tray)).toEqual(defaultGeometry());
  });

  it("keeps a window in its corner across a browser resize", () => {
    const geometry = geometryOf({ x: 60, y: 20, w: 24, h: 30 }, AREA);
    expect(geometry).toMatchObject({ corner: "bottom-end", dxRem: 6, dyRem: 10 });
    const wider = rectOf(geometry, { ...AREA, end: 120, viewport: 120 });
    expect(wider.x).toBe(90);
    expect(wider.y).toBe(20);
  });

  it("round-trips every corner", () => {
    for (const rect of [
      { x: 8, y: 5, w: 24, h: 30 },
      { x: 60, y: 5, w: 24, h: 30 },
      { x: 8, y: 25, w: 24, h: 30 },
      { x: 60, y: 25, w: 24, h: 30 },
    ])
      expect(rectOf(geometryOf(rect, AREA), AREA)).toEqual(rect);
  });

  it("parks at a corner at the current size and lists the other three", () => {
    expect(atCorner(defaultGeometry(), "top-start")).toMatchObject({
      corner: "top-start",
      dxRem: 1,
      dyRem: 1,
      wRem: 24,
    });
    expect(otherCorners("bottom-end")).toEqual(["top-start", "top-end", "bottom-start"]);
  });
});

describe("clamping", () => {
  it("holds the size to min and max, 40 rem or 60 % of the viewport", () => {
    expect(sizeLimits(AREA)).toEqual({ maxW: 40, maxH: 57 });
    expect(sizeLimits({ ...AREA, viewport: 50 }).maxW).toBe(30);
    expect(clampRect({ x: 10, y: 10, w: 5, h: 5 }, AREA)).toMatchObject({ w: 20, h: 24 });
  });

  it("keeps the window inside the page", () => {
    expect(clampRect({ x: 0, y: 0, w: 24, h: 30 }, AREA)).toMatchObject({ x: 6, y: 3 });
    expect(clampRect({ x: 200, y: 200, w: 24, h: 30 }, AREA)).toMatchObject({ x: 66, y: 30 });
  });

  it("moves up keeping its size when the tray band appears, and goes back when it leaves (B99)", () => {
    const geometry = { ...defaultGeometry(), hRem: 30 };
    const before = rectOf(geometry, AREA);
    const above = rectOf(geometry, AREA, TRAY_FOOTPRINT_REM);
    expect(above.h).toBe(30);
    expect(above.y + above.h).toBe(AREA.bottom - TRAY_FOOTPRINT_REM - 0.5);
    expect(rectOf(geometry, AREA)).toEqual(before);
  });

  it("gives up height toward the minimum only when moving is not enough (B99)", () => {
    const rect = clampRect({ x: 10, y: 3, w: 24, h: 57 }, AREA, TRAY_FOOTPRINT_REM);
    expect(rect.h).toBe(53.5);
    const short = { ...AREA, bottom: 26 };
    expect(clampRect({ x: 10, y: 3, w: 24, h: 40 }, short, TRAY_FOOTPRINT_REM).h).toBe(24);
  });
});

describe("snap and drop targets", () => {
  it("snaps to a 1 rem inset near a corner", () => {
    const rect = { x: 7.2, y: 4.2, w: 24, h: 30 };
    expect(snapRect(rect, AREA)).toMatchObject({ x: 7, y: 4 });
  });

  it("insets the bottom corner by 1 rem with no band and sits on the band's gap with one", () => {
    const rect = { x: 65.5, y: 29.5, w: 24, h: 30 };
    expect(snapRect(rect, AREA)).toMatchObject({ x: 65, y: 29 });
    const low = { ...rect, y: 26 };
    expect(snapRect(low, AREA, TRAY_FOOTPRINT_REM).y).toBe(26.5);
  });

  it("aligns to one edge and leaves the other axis alone", () => {
    const rect = { x: 7.5, y: 20, w: 24, h: 30 };
    expect(snapRect(rect, AREA)).toMatchObject({ x: 7, y: 20 });
  });

  it("leaves a window in the open alone", () => {
    const rect = { x: 30, y: 15, w: 24, h: 30 };
    expect(snapRect(rect, AREA)).toEqual(rect);
  });

  it("shows the sidebar target within 3 rem of the end and the tray within 3 rem of the bottom", () => {
    expect(dropTargetAt(87.5, 30, AREA)).toBe("sidebar");
    expect(dropTargetAt(50, 58, AREA)).toBe("tray");
    expect(dropTargetAt(50, 30, AREA)).toBeNull();
    expect(dropTargetAt(88, 59, AREA)).toBe("sidebar");
  });
});

describe("resize", () => {
  const start = { x: 30, y: 20, w: 24, h: 30 };

  it("moves the dragged edges and pins the opposite ones", () => {
    expect(resizeRect(start, "e", 4, 0, AREA)).toEqual({ ...start, w: 28 });
    expect(resizeRect(start, "s", 0, 4, AREA)).toEqual({ ...start, h: 34 });
    expect(resizeRect(start, "w", -4, 0, AREA)).toEqual({ ...start, x: 26, w: 28 });
    expect(resizeRect(start, "n", 0, -4, AREA)).toEqual({ ...start, y: 16, h: 34 });
    expect(resizeRect(start, "se", 2, 2, AREA)).toEqual({ ...start, w: 26, h: 32 });
    expect(resizeRect(start, "nw", -2, -2, AREA)).toEqual({ x: 28, y: 18, w: 26, h: 32 });
  });

  it("stops at the minimum, the maximum and the page's edges", () => {
    expect(resizeRect(start, "e", -30, 0, AREA).w).toBe(20);
    expect(resizeRect(start, "w", 30, 0, AREA)).toMatchObject({ w: 20, x: 34 });
    expect(resizeRect(start, "e", 100, 0, AREA).w).toBe(40);
    expect(resizeRect({ ...start, x: 60 }, "e", 100, 0, AREA).w).toBe(30);
    expect(resizeRect(start, "s", 0, 100, AREA).h).toBe(40);
    expect(resizeRect(start, "s", 0, 100, AREA, TRAY_FOOTPRINT_REM).h).toBe(36.5);
  });
});

describe("covering", () => {
  it("counts a control as covered only when none of it shows", () => {
    expect(coversFully(dom(0, 0, 100, 100), dom(10, 10, 20, 20))).toBe(true);
    expect(coversFully(dom(0, 0, 15, 100), dom(10, 10, 20, 20))).toBe(false);
  });

  it("treats rects that only touch as apart", () => {
    expect(intersects(dom(0, 0, 10, 10), dom(5, 5, 20, 20))).toBe(true);
    expect(intersects(dom(0, 0, 10, 10), dom(10, 0, 20, 10))).toBe(false);
  });
});
