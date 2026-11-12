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

import type { MetricUnit } from "../coverageSeries";
import type { LiveChartSignal } from "./serviceChartSql";

/** What a chart needs of one of the service's own alerts to draw where it fires. */
export interface ThresholdAlert {
  sql?: string | null;
  /** Minutes the alert's query counts over. */
  period?: number | null;
  streamType?: string | null;
}

const P95_HAVING = /HAVING\s+approx_percentile_cont\([^)]*\)\s*(\/\s*1000\s*)?>\s*([\d.]+)/i;
const COUNT_HAVING = /HAVING\s+count\(\*\)\s*>\s*([\d.]+)/i;

// Only the thresholds AutoObserve's own drafts write can be read off the query; anything else draws no line.
const thresholdOf = (
  signal: LiveChartSignal,
  unit: MetricUnit,
  alert: ThresholdAlert,
): number | null => {
  const sql = alert.sql ?? "";
  if (signal === "latency" && unit === "ms") {
    const m = P95_HAVING.exec(sql);
    if (!m) return null;
    const value = Number(m[2]);
    // A traces duration is in microseconds unless the query already divided it into milliseconds.
    return m[1] || alert.streamType !== "traces" ? value : value / 1000;
  }
  if (signal === "errors" && unit === "perMin") {
    const m = COUNT_HAVING.exec(sql);
    const period = Number(alert.period);
    return m && period > 0 ? Number(m[1]) / period : null;
  }
  return null;
};

/** The lowest level at which one of the service's alerts fires, in the chart's own unit; null when none can be read. */
export const chartThreshold = (
  signal: LiveChartSignal,
  unit: MetricUnit,
  alerts: ThresholdAlert[],
): number | null => {
  const found = alerts
    .map((a) => thresholdOf(signal, unit, a))
    .filter((v): v is number => v !== null && Number.isFinite(v));
  return found.length ? Math.min(...found) : null;
};
