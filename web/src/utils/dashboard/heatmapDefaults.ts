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
 * This is presentation only. It says nothing about how the data is prepared:
 * the classic-histogram `le`-sort and de-accumulation stay opt-in behind
 * `config.heatmap_mode === "prometheus_histogram"`, because applying them to an
 * arbitrary heatmap would corrupt it.
 */

import { SPECTRAL_HEATMAP_STOPS } from "./promql/shared/spectral";
import { chartColor } from "@/utils/chartTheme";

/**
 * Stroke every cell in the panel background colour.
 *
 * Without a border ECharts paints cells edge to edge and a dense heatmap
 * collapses into solid bands — you cannot see where one bucket ends and the
 * next begins.
 */
export function heatmapCellItemStyle(store: any) {
  return {
    borderColor: chartColor("--color-surface-base"),
    borderWidth: 1,
  };
}

/**
 * The Spectral ramp, cool-to-warm, with the colour-scale exponent already baked
 * into the stop positions (see spectral.ts). ECharts spreads `inRange.color`
 * linearly over [min, max], so the non-linear scale has to live in where each
 * stop is sampled from the ramp rather than in ECharts' own config.
 */
export const HEATMAP_VISUAL_MAP_COLORS = SPECTRAL_HEATMAP_STOPS;

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
