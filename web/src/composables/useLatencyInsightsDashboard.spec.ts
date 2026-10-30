// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect } from "vitest";
import { useLatencyInsightsDashboard } from "./useLatencyInsightsDashboard";
import type { LatencyInsightsConfig } from "./useLatencyInsightsAnalysis";

const t = ((key: string) => key) as any;
const { generateDashboard } = useLatencyInsightsDashboard(t);

const RANGE = { startTime: 1_000_000, endTime: 9_000_000 };
const BRUSH = { startTime: 3_000_000, endTime: 5_000_000 };

// The shape logs/Index.vue passes: volume analysis, a histogram brush as rateFilter.
const logsConfig = (
  brush: { startTime: number; endTime: number } | null,
  baseFilter = "",
): LatencyInsightsConfig => ({
  streamName: "app_logs",
  streamType: "logs",
  orgIdentifier: "org",
  baselineTimeRange: RANGE,
  selectedTimeRange: brush ?? RANGE,
  rateFilter: brush
    ? { start: 0, end: 0, timeStart: brush.startTime, timeEnd: brush.endTime }
    : undefined,
  baseFilter,
  dimensions: ["k8s_namespace"],
  analysisType: "volume",
});

const dashboardOf = (cfg: LatencyInsightsConfig) =>
  generateDashboard([{ dimensionName: "k8s_namespace" } as any], cfg, "light") as any;
const panelOf = (cfg: LatencyInsightsConfig) => dashboardOf(cfg).tabs[0].panels[0];
const sqlOf = (cfg: LatencyInsightsConfig): string =>
  panelOf(cfg).queries[0].query.replace(/\s+/g, " ");

describe("useLatencyInsightsDashboard — logs Drill down", () => {
  it("counts each value with one query when no brush narrows the range", () => {
    const panel = panelOf(logsConfig(null, "level = 'error'"));
    const sql = sqlOf(logsConfig(null, "level = 'error'"));
    expect(sql).toBe(
      `SELECT COALESCE(CAST(k8s_namespace AS VARCHAR), '(no value)') AS value, count(_timestamp) AS trace_count FROM "app_logs" WHERE _timestamp >= ${RANGE.startTime} AND _timestamp <= ${RANGE.endTime} AND level = 'error' GROUP BY k8s_namespace ORDER BY trace_count DESC LIMIT 5`,
    );
    expect(panel.config.show_legends).toBe(false);
    expect(panel.queries[0].fields.breakdown).toEqual([]);
    expect(panel.config.unit).toBe("numbers");
    expect(panel.queries[0].fields.y[0].alias).toBe("trace_count");
  });

  it("compares the brushed window with the range, the range scaled to the window", () => {
    const panel = panelOf(logsConfig(BRUSH));
    const sql = sqlOf(logsConfig(BRUSH));
    const [baseline, selected] = sql.split(" UNION ");
    expect(baseline).toContain("'Baseline' AS series");
    expect(baseline).toContain("(count(_timestamp) * 2) / 8 AS trace_count");
    expect(baseline).toContain(
      `_timestamp >= ${RANGE.startTime} AND _timestamp <= ${RANGE.endTime}`,
    );
    expect(selected).toContain("'Selected' AS series");
    expect(selected).toContain("count(_timestamp) AS trace_count");
    expect(selected).toContain(
      `_timestamp >= ${BRUSH.startTime} AND _timestamp <= ${BRUSH.endTime}`,
    );
    expect(sql).not.toContain("approx_distinct");
    expect(panel.config.show_legends).toBe(true);
    expect(panel.queries[0].fields.breakdown.map((b: any) => b.alias)).toEqual(["series"]);
  });

  it("titles the dashboard and panel as a volume analysis", () => {
    const dashboard = dashboardOf(logsConfig(BRUSH));
    expect(dashboard.title).toBe("latencyInsights.dashboardTitleVolume");
    expect(dashboard.variables).toEqual({ list: [], showDynamicFilters: false });
    expect(dashboard.tabs[0].panels[0].id).toBe("Panel_VolumeInsights_k8s_namespace_0");
    expect(dashboard.tabs[0].panels[0].config.decimals).toBe(0);
  });
});
