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
 * Threshold marklines for the alert preview chart.
 *
 * One helper for every query mode (builder/aggregation, SQL, custom SQL,
 * PromQL) so the two levels are always drawn together and styled the same
 * way. No text label — colour alone identifies the level (red = critical,
 * amber = warning), which also avoids labels clipping at the chart top.
 */

import { chartColor } from "@/utils/chartTheme";

export interface ThresholdMarkLine {
  name: "Critical" | "Warning";
  type: "yAxis";
  value: string;
  color: string;
  show_label: false;
}

/** Axis bounds a chart should honour so its threshold lines stay on screen. */
export interface ThresholdAxisBounds {
  y_axis_min?: number;
  y_axis_max?: number;
}

/**
 * Headroom above/below the outermost threshold, so a line that defines the
 * axis edge is not drawn ON the edge (where it reads as a border, not a
 * threshold). Proportional to the threshold's own magnitude, with an absolute
 * floor for thresholds at or near zero.
 */
const PAD_RATIO = 0.1;
const MIN_PAD = 1;

const has = (v: unknown): v is string | number => v !== undefined && v !== null && v !== "";

export function buildThresholdMarkLines(critical: unknown, warning: unknown): ThresholdMarkLine[] {
  const lines: ThresholdMarkLine[] = [];
  if (has(critical)) {
    lines.push({
      name: "Critical",
      type: "yAxis",
      value: String(critical),
      color: chartColor("--color-status-error-text"),
      show_label: false,
    });
  }
  if (has(warning)) {
    lines.push({
      name: "Warning",
      type: "yAxis",
      value: String(warning),
      color: chartColor("--color-status-warning-text"),
      show_label: false,
    });
  }
  return lines;
}

/**
 * Y-axis bounds that keep every threshold line visible.
 *
 * A chart auto-scales to its DATA, so a threshold outside that range is drawn
 * outside the plot area and simply never appears — the common case being an
 * alert that has not fired, where every value sits below the threshold and the
 * line the user came to see is the one thing missing.
 *
 * The returned values are advisory: both chart pipelines feed them through
 * `getFinalAxisValue`, which takes `max(config, dataMax)` and
 * `min(config, dataMin)`. So these only ever WIDEN the axis — data that already
 * exceeds a threshold still scales normally and nothing is clipped.
 */
export function thresholdAxisBounds(markLines: ThresholdMarkLine[]): ThresholdAxisBounds {
  const values = markLines
    .filter((line) => line.type === "yAxis")
    .map((line) => Number(line.value))
    .filter((value) => Number.isFinite(value));

  if (!values.length) return {};

  const highest = Math.max(...values);
  const lowest = Math.min(...values);
  const pad = (value: number) => Math.max(Math.abs(value) * PAD_RATIO, MIN_PAD);

  return {
    y_axis_min: lowest - pad(lowest),
    y_axis_max: highest + pad(highest),
  };
}
