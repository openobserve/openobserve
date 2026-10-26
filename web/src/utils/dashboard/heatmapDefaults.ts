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

/**
 * Shared visual defaults for every heatmap the app draws.
 *
 * Three separate renderers build heatmaps — the PromQL converter, its
 * Prometheus-histogram mode, and the SQL converter — and share these defaults so
 * a heatmap looks like a heatmap wherever it appears.
 *
 * It also holds the cell budget, colour range/scale and warning helpers, but never prepares data:
 * the classic-histogram `le`-sort and de-accumulation stay opt-in behind
 * `config.heatmap_mode === "prometheus_histogram"`, because applying them to an
 * arbitrary heatmap would corrupt it.
 */

import {
  DEFAULT_HEATMAP_PALETTE,
  HEATMAP_PALETTES,
  HEATMAP_STOP_COUNT,
  buildColorStops,
} from "./heatmapPalettes";
import { chartColor } from "@/utils/chartTheme";
import { gt } from "@/types/i18n";
import { addCommasToNumber } from "@/utils/formatters";

/**
 * Stroke every cell in the panel background colour.
 *
 * Without a border ECharts paints cells edge to edge and a dense heatmap
 * collapses into solid bands — you cannot see where one bucket ends and the
 * next begins.
 */
export function heatmapCellItemStyle(_store: any) {
  return {
    borderColor: chartColor("--color-surface-base"),
    borderWidth: 1,
  };
}

/** The colour scales `heatmap_color_scale` accepts; unset is square root. */
export const HEATMAP_COLOR_SCALES = ["linear", "sqrt", "log"] as const;

export const DEFAULT_HEATMAP_COLOR_SCALE = "sqrt";

/**
 * The cell borders delineate the grid; a split-area backdrop underneath them
 * only muddies it.
 */
export const HEATMAP_SPLIT_AREA = { show: false };

/**
 * Above this many cells, per-cell value labels stop being information.
 *
 * A number needs roughly 40x16px to be legible. A 900x400 panel therefore has
 * room for a few hundred of them at most — beyond that the labels overlap into
 * illegible mush, so nothing is lost by hiding them. What IS gained is not
 * asking ECharts to create a text element per cell and run a unit formatter per
 * cell: a Prometheus histogram over a full-size panel is ~24 buckets x ~300
 * timestamps = ~7,000 cells, and labelling all of them is what turns a heavy
 * chart into a hung tab.
 *
 * The card previews on the Metrics Explorer never hit this — they request a
 * coarse step (~40 columns) precisely because they are small. A full-size editor
 * panel asks the backend for its default step and gets an order of magnitude
 * more columns, which is why the same metric renders fine on a card and can
 * bring down the editor.
 */
export const HEATMAP_LABEL_CELL_LIMIT = 300;

/**
 * The per-cell value label, shown only while the grid is small enough to read.
 */
export function heatmapValueLabel(cellCount: number, formatter: (params: any) => string) {
  if (cellCount > HEATMAP_LABEL_CELL_LIMIT) return { show: false };
  return { show: true, fontSize: 12, formatter };
}

/**
 * Series options for a grid big enough to hurt: render it in chunks instead of
 * one blocking pass, and skip the entry animation (animating thousands of rects
 * is pure cost — nobody is watching a heatmap fade in).
 */
export function heatmapLargeGridDefaults(cellCount: number) {
  if (cellCount <= HEATMAP_LABEL_CELL_LIMIT) return {};
  return {
    animation: false,
    progressive: 1000,
    progressiveThreshold: 1000,
  };
}

/** The axis line `axis_border_show` asks for, spread into every heatmap axis; unset keeps the ECharts default, as the other PromQL axes do. */
export function heatmapAxisLine(config: any): { axisLine?: { show: boolean } } {
  if (config?.axis_border_show === undefined || config?.axis_border_show === null) return {};
  return { axisLine: { show: !!config.axis_border_show } };
}

/**
 * The most columns a heatmap will ever ask the backend for.
 *
 * A heatmap's cost is COLUMNS x BUCKETS. Left to itself the backend returns
 * ~300 points whatever the range, which against a ~24-bucket Prometheus
 * histogram is ~7,000 cells — enough to take the tab down on a full-size panel.
 * Capping the columns caps the cells.
 *
 * 120 is not a compromise: a heatmap column has to be wide enough to SEE, and at
 * ~8px per column that is already ~1000px of chart. Asking for more columns than
 * the panel has pixels buys nothing and costs everything. (Explicit `step_value`
 * on the panel or the query still wins — this is only the default.)
 */
export const HEATMAP_MAX_COLUMNS = 120;

/** The most cells a heatmap grid holds: 120 columns by ~400 rows, past which rows shrink below a pixel on a full-size panel. */
export const HEATMAP_MAX_CELLS = 50_000;

export interface HeatmapGridCut {
  firstColumn: number;
  rows: number[];
}

export interface HistogramStackCut {
  groups: number[];
  firstColumn: number;
}

function pinnedColorBound(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const bound = Number(value);
  return Number.isFinite(bound) ? bound : undefined;
}

/** The `visualMap` range with `heatmap_color_min` / `heatmap_color_max` applied over `baseRange`, ignoring pins that would leave min >= max. */
export function heatmapColorRange(
  config: any,
  baseRange: { min: number; max: number },
): { min: number; max: number } {
  const pinnedMin = pinnedColorBound(config?.heatmap_color_min);
  const pinnedMax = pinnedColorBound(config?.heatmap_color_max);
  if (pinnedMin === undefined && pinnedMax === undefined) return { ...baseRange };

  const min = pinnedMin ?? baseRange.min;
  const max = pinnedMax ?? baseRange.max;
  if (min >= max) return { ...baseRange };
  return { min, max };
}

/** The `visualMap` range and `inRange.color` stops for `config`'s palette, reverse flag and colour scale over `range`; `cellSets` holds the `[x, y, value]` cells it colours. */
export function heatmapColorScale(
  config: any,
  range: { min: number; max: number },
  cellSets: any[][],
): { min: number; max: number; color: string[] } {
  const palette =
    HEATMAP_PALETTES[config?.heatmap_palette] ?? HEATMAP_PALETTES[DEFAULT_HEATMAP_PALETTE];
  const ramp = config?.heatmap_palette_reverse ? [...palette].reverse() : palette;
  const scale = config?.heatmap_color_scale ?? DEFAULT_HEATMAP_COLOR_SCALE;

  // Log runs over [max(min, smallest positive cell), max]; cells at or below that floor (so every value <= 0) fall under the bar and take its lowest colour, and with no positive span the scale is linear.
  if (scale === "log") {
    const floor = Math.max(range.min, smallestPositiveCell(cellSets));
    if (floor > 0 && range.max > floor) {
      const logSpan = Math.log(range.max / floor);
      const warp = (t: number) => Math.log((floor + t * (range.max - floor)) / floor) / logSpan;
      return { min: floor, max: range.max, color: buildColorStops(ramp, HEATMAP_STOP_COUNT, warp) };
    }
  }
  // Square root is the variance-stabilising transform for Poisson counts, so a colour step means similar evidence along the ramp.
  const warp = scale === "linear" || scale === "log" ? (t: number) => t : Math.sqrt;
  return { ...range, color: buildColorStops(ramp, HEATMAP_STOP_COUNT, warp) };
}

/** The `visualMap` range for a set of cell values; the floor drops below 0 only for negative data, so all-negative grids are not one colour. */
export function visualMapRangeOf(minValue: number, maxValue: number): { min: number; max: number } {
  return {
    min: Number.isFinite(minValue) ? Math.min(0, minValue) : 0,
    max: Number.isFinite(maxValue) ? maxValue : 0,
  };
}

/** The cut that fits a `columnCount` x `rowTotals.length` grid into `budget` cells, or null when it already fits. */
export function cutHeatmapToBudget(
  columnCount: number,
  rowTotals: number[],
  budget: number = HEATMAP_MAX_CELLS,
): HeatmapGridCut | null {
  if (columnCount * rowTotals.length <= budget) return null;
  if (columnCount <= budget) {
    return { firstColumn: 0, rows: largestRows(rowTotals, Math.floor(budget / columnCount)) };
  }
  return { firstColumn: columnCount - budget, rows: largestRows(rowTotals, 1) };
}

export function heatmapBudgetWarning(
  cut: HeatmapGridCut,
  columnCount: number,
  rowCount: number,
): string {
  if (cut.firstColumn === 0) {
    return gt("dashboard.utils.heatmapRowsCapped", {
      shown: addCommasToNumber(cut.rows.length),
      total: addCommasToNumber(rowCount),
    });
  }
  return gt("dashboard.utils.heatmapColumnsCapped", {
    shownColumns: addCommasToNumber(columnCount - cut.firstColumn),
    totalColumns: addCommasToNumber(columnCount),
    shownRows: addCommasToNumber(cut.rows.length),
    totalRows: addCommasToNumber(rowCount),
  });
}

/** The histogram grids (indices, in input order) and first column a stack keeps within `budget`: smallest-total grids go first, then the oldest columns, never a bucket; null when it fits. */
export function cutHistogramsToBudget(
  columnCount: number,
  groupRows: number[],
  groupTotals: number[],
  budget: number = HEATMAP_MAX_CELLS,
): HistogramStackCut | null {
  const totalRows = groupRows.reduce((sum, rows) => sum + rows, 0);
  if (columnCount * totalRows <= budget) return null;

  const groups: number[] = [];
  let keptRows = 0;
  const byTotal = groupTotals
    .map((_total, index) => index)
    .sort((a, b) => groupTotals[b] - groupTotals[a] || a - b);
  for (const group of byTotal) {
    if (groups.length > 0 && (keptRows + groupRows[group]) * columnCount > budget) break;
    groups.push(group);
    keptRows += groupRows[group];
  }
  const keptColumns = Math.max(1, Math.floor(budget / Math.max(1, keptRows)));
  return {
    groups: groups.sort((a, b) => a - b),
    firstColumn: Math.max(0, columnCount - keptColumns),
  };
}

export function histogramBudgetWarnings(
  cut: HistogramStackCut,
  columnCount: number,
  groupCount: number,
): string[] {
  const warnings: string[] = [];
  if (cut.groups.length < groupCount) {
    warnings.push(
      gt("dashboard.utils.heatmapHistogramsCapped", {
        shown: addCommasToNumber(cut.groups.length),
        total: addCommasToNumber(groupCount),
      }),
    );
  }
  if (cut.firstColumn > 0) {
    warnings.push(
      gt("dashboard.utils.heatmapHistogramColumnsCapped", {
        shown: addCommasToNumber(columnCount - cut.firstColumn),
        total: addCommasToNumber(columnCount),
      }),
    );
  }
  return warnings;
}

/** Adds `message` to the panel's warning, which the header shows through the series-limit notice. */
export function addHeatmapWarning(extras: any, message: string): void {
  if (!extras) return;
  const existing = extras.limitNumberOfSeriesWarningMessage;
  extras.limitNumberOfSeriesWarningMessage = existing ? `${existing}. ${message}` : message;
}

function smallestPositiveCell(cellSets: any[][]): number {
  let smallest = Infinity;
  for (const cells of cellSets) {
    for (const cell of cells) {
      const value = Number(cell?.[2]);
      if (value > 0 && value < smallest) smallest = value;
    }
  }
  return smallest;
}

function largestRows(rowTotals: number[], keep: number): number[] {
  return rowTotals
    .map((_total, index) => index)
    .sort((a, b) => rowTotals[b] - rowTotals[a] || a - b)
    .slice(0, keep)
    .sort((a, b) => a - b);
}
