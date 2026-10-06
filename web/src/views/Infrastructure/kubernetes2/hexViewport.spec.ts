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
import {
  MAX_FIT_SCALE,
  axisRanges,
  fit,
  isClick,
  pan,
  toLayout,
  zoomAt,
  type ViewSize,
} from "./hexViewport";

const BOUNDS = { minX: 0, maxX: 120, minY: -80, maxY: 0 };

describe("hexViewport (AC 52)", () => {
  it.each([
    [343, 600],
    [1200, 700],
  ])("fit gives equal units per pixel on both axes at %ix%i", (width, height) => {
    const state = fit(BOUNDS, width, height);
    const { x, y } = axisRanges(state, width, height);
    const xPerPx = (x[1] - x[0]) / width;
    const yPerPx = (y[1] - y[0]) / height;
    expect(xPerPx).toBeCloseTo(yPerPx, 12);
    expect((x[1] - x[0]) / (y[1] - y[0])).toBeCloseTo(width / height, 12);
    // The packed bounds sit inside the visible ranges, centred.
    expect(x[0]).toBeLessThan(BOUNDS.minX);
    expect(x[1]).toBeGreaterThan(BOUNDS.maxX);
    expect(y[0]).toBeLessThan(BOUNDS.minY);
    expect(y[1]).toBeGreaterThan(BOUNDS.maxY);
    expect(state.cx).toBe(60);
    expect(state.cy).toBe(-40);
  });

  it("pads the shorter side and caps the fit scale", () => {
    const state = fit(BOUNDS, 1200, 700);
    expect(state.scale * 80).toBeLessThan(700);
    expect(state.scale * 80).toBeGreaterThan(600);
    expect(fit({ minX: 0, maxX: 2, minY: -2, maxY: 0 }, 1200, 700).scale).toBe(MAX_FIT_SCALE);
  });

  it("horizontal pan: a 100px drag right moves cx by −100/scale, y unchanged", () => {
    const state = { scale: 8, cx: 10, cy: -5 };
    expect(pan(state, 100, 0)).toEqual({ scale: 8, cx: 10 - 100 / 8, cy: -5 });
  });

  it("vertical pan: a 100px drag down moves cy by +100/scale, x unchanged", () => {
    const state = { scale: 8, cx: 10, cy: -5 };
    expect(pan(state, 0, 100)).toEqual({ scale: 8, cx: 10, cy: -5 + 100 / 8 });
  });

  it("off-centre zoom keeps the layout point under the cursor and multiplies scale by 1.2", () => {
    const size: ViewSize = { width: 1000, height: 600, fit: 4 };
    const state = { scale: 5, cx: 30, cy: -20 };
    const [px, py] = [250, 450];
    const before = toLayout(state, px, py, size);
    const next = zoomAt(state, px, py, 1.2, size);
    expect(next.scale).toBeCloseTo(6, 12);
    const after = toLayout(next, px, py, size);
    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
  });

  it("clamps zoom to [fit, fit × 20]", () => {
    const size: ViewSize = { width: 1000, height: 600, fit: 4 };
    expect(zoomAt({ scale: 4, cx: 0, cy: 0 }, 10, 10, 1 / 1.2, size).scale).toBe(4);
    expect(zoomAt({ scale: 79, cx: 0, cy: 0 }, 10, 10, 1.2, size).scale).toBe(80);
  });

  it("a press that moves less than 4px is a click", () => {
    expect(isClick(3, 2)).toBe(true);
    expect(isClick(4, 0)).toBe(false);
    expect(isClick(0, -10)).toBe(false);
  });
});
