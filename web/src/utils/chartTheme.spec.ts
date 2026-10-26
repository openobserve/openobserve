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

import { describe, expect, it, afterEach, vi } from "vitest";
import { lightenForContrast, chartMarkerColor, invalidateChartTheme } from "./chartTheme";

describe("lightenForContrast", () => {
  it("leaves a colour unchanged against a light background, even a low-contrast one", () => {
    // TEXT_SWATCHES' green/teal/purple read as low-contrast against white in light theme, which the fix must not touch.
    expect(lightenForContrast("#34d399", "#ffffff")).toBe("#34d399");
    expect(lightenForContrast("#111827", "#ffffff")).toBe("#111827");
  });

  it("lightens a near-black colour against a dark (near-black) background to clear 3:1", () => {
    const result = lightenForContrast("#111827", "#0d1117");
    expect(result).not.toBe("#111827");
    expect(result.toLowerCase()).toBe("#4d525d");
  });

  it("lightens a dark, low-contrast saturated colour against a dark background to clear 3:1", () => {
    const result = lightenForContrast("#b91c1c", "#0d1117");
    expect(result).not.toBe("#b91c1c");
    expect(result.toLowerCase()).toBe("#c03333");
  });

  it("leaves a saturated colour that already contrasts against a dark background", () => {
    expect(lightenForContrast("#15803d", "#0d1117")).toBe("#15803d");
    expect(lightenForContrast("#6b7280", "#0d1117")).toBe("#6b7280");
  });

  it("falls back to white against a mid-tone background where 3:1 is unreachable", () => {
    // #737373 has luminance ~0.45: even pure white against it caps out under 3:1.
    const result = lightenForContrast("#5a5a5a", "#737373");
    expect(result).toBe("#ffffff");
  });

  it("passes through a non-hex colour (rgb/rgba) or malformed value unchanged", () => {
    expect(lightenForContrast("rgb(1, 2, 3)", "#0d1117")).toBe("rgb(1, 2, 3)");
    expect(lightenForContrast("#111827", "")).toBe("#111827");
  });
});

describe("chartMarkerColor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    invalidateChartTheme();
  });

  it("resolves the chart's own canvas colour as the contrast background", () => {
    const real = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) =>
      el === document.documentElement
        ? ({ getPropertyValue: () => "#0d1117" } as unknown as CSSStyleDeclaration)
        : real(el),
    );
    expect(chartMarkerColor("#111827")).not.toBe("#111827");
  });
});
