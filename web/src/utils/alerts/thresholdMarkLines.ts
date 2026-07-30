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
