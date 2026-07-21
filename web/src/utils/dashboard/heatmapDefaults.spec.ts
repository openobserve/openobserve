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

import { describe, it, expect } from "vitest";
import { computeStepSeconds } from "@/utils/metrics/metricDefaults";
import {
  HEATMAP_LABEL_CELL_LIMIT,
  HEATMAP_MAX_COLUMNS,
  HEATMAP_SPLIT_AREA,
  HEATMAP_VISUAL_MAP_COLORS,
  heatmapCellItemStyle,
  heatmapLargeGridDefaults,
  heatmapValueLabel,
} from "./heatmapDefaults";
import { SPECTRAL_HEATMAP_STOP_COUNT } from "./promql/shared/spectral";
import { chartColor } from "@/utils/chartTheme";

describe("shared heatmap defaults", () => {
  it("runs the colour ramp cool-to-warm", () => {
    // ColorBrewer publishes Spectral warm-first. Used in that order, a
    // histogram's near-empty high-`le` rows came out as a solid dark-red slab —
    // the loudest thing on the chart — while the busy low buckets sank into
    // blue. The eye reads hot as "more", so low must be cool.
    expect(HEATMAP_VISUAL_MAP_COLORS).toHaveLength(SPECTRAL_HEATMAP_STOP_COUNT);
    expect(HEATMAP_VISUAL_MAP_COLORS[0]).toBe("#5e4fa2");
    expect(HEATMAP_VISUAL_MAP_COLORS.at(-1)).toBe("#9e0142");
  });

  it("strokes cells in the panel background so they read as discrete tiles", () => {
    // Without a border ECharts paints cells edge to edge and a dense heatmap
    // collapses into solid horizontal bands.
    expect(heatmapCellItemStyle({ state: { theme: "dark" } })).toEqual({
      borderColor: chartColor("--color-surface-base"),
      borderWidth: 1,
    });
    expect(heatmapCellItemStyle({ state: { theme: "light" } })).toEqual({
      borderColor: chartColor("--color-surface-base"),
      borderWidth: 1,
    });
  });

  it("survives a missing store rather than throwing", () => {
    expect(heatmapCellItemStyle(undefined).borderWidth).toBe(1);
  });

  it("turns the split-area backdrop off", () => {
    // The cell borders delineate the grid; a banded backdrop under them muddies it.
    expect(HEATMAP_SPLIT_AREA).toEqual({ show: false });
  });
});

describe("large-grid guards", () => {
  const fmt = () => "x";

  it("labels a small grid, where the numbers can actually be read", () => {
    expect(heatmapValueLabel(120, fmt)).toEqual({
      show: true,
      fontSize: 12,
      formatter: fmt,
    });
  });

  it("drops the labels once the grid is too dense to read them", () => {
    // A Prometheus histogram over a full-size panel is ~24 buckets x ~300
    // timestamps ≈ 7,000 cells. Labelling all of them means a text element AND a
    // unit-formatter call per cell — the difference between a heavy chart and a
    // hung tab. Nothing is lost: at that density the labels overlap into mush.
    expect(heatmapValueLabel(7224, fmt)).toEqual({ show: false });
  });

  it("adds nothing to a small grid", () => {
    // Animation and per-cell rendering are fine when there is little to draw.
    expect(heatmapLargeGridDefaults(120)).toEqual({});
  });

  it("chunks the render and kills the animation on a big grid", () => {
    // Nobody watches a heatmap fade in; animating thousands of rects is pure
    // cost, and `progressive` keeps the render off the main thread's critical
    // path instead of doing it in one blocking pass.
    expect(heatmapLargeGridDefaults(7224)).toEqual({
      animation: false,
      progressive: 1000,
      progressiveThreshold: 1000,
    });
  });

  it("switches over at the documented limit, not somewhere near it", () => {
    expect(heatmapValueLabel(HEATMAP_LABEL_CELL_LIMIT, fmt).show).toBe(true);
    expect(heatmapValueLabel(HEATMAP_LABEL_CELL_LIMIT + 1, fmt).show).toBe(false);
  });
});

describe("the column cap is what actually bounds the work", () => {
  // A heatmap's cost is COLUMNS x BUCKETS. Capping labels and chunking the
  // render only soften the blow; capping the COLUMNS is what stops the grid
  // being enormous in the first place. `step: "0"` let the backend decide, and
  // it returns ~300 points at any range — ~7,000 cells against a 24-bucket
  // histogram, which is what took the tab down.
  const columnsFor = (rangeSeconds: number) =>
    Math.round(rangeSeconds / computeStepSeconds(rangeSeconds, HEATMAP_MAX_COLUMNS));

  it.each([
    ["15 minutes", 15 * 60],
    ["1 hour", 60 * 60],
    ["6 hours", 6 * 60 * 60],
    ["1 day", 24 * 60 * 60],
    ["30 days", 30 * 24 * 60 * 60],
  ])("never exceeds the cap over %s", (_label, rangeSeconds) => {
    expect(columnsFor(rangeSeconds)).toBeLessThanOrEqual(HEATMAP_MAX_COLUMNS);
  });

  it("takes a 15m histogram from ~7,000 cells down to ~1,400", () => {
    // 24 le buckets is typical. This is the whole fix in one number.
    const cells = columnsFor(15 * 60) * 24;
    expect(cells).toBeLessThan(2000);
  });
});
