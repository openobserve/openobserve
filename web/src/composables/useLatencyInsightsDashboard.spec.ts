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

const BASE = { startTime: 1_000_000, endTime: 9_000_000 };
const SEL = { startTime: 3_000_000, endTime: 5_000_000 };

const config = (overrides: Partial<LatencyInsightsConfig> = {}): LatencyInsightsConfig => ({
  streamName: "default",
  streamType: "traces",
  orgIdentifier: "org",
  baselineTimeRange: BASE,
  selectedTimeRange: SEL,
  durationFilter: { start: 100, end: 500, timeStart: SEL.startTime, timeEnd: SEL.endTime },
  baseFilter: "service_name = 'api'",
  dimensions: ["service_name"],
  analysisType: "duration",
  ...overrides,
});

const panelOf = (cfg: LatencyInsightsConfig) =>
  generateDashboard([{ dimensionName: "service_name" } as any], cfg).tabs[0].panels[0] as any;

const sqlOf = (cfg: LatencyInsightsConfig): string => panelOf(cfg).queries[0].query;

const part = (sql: string, series: "Selected" | "Baseline") =>
  sql.split(/\bUNION\b/).find((p) => p.includes(`'${series}' AS series`)) ?? "";

describe("useLatencyInsightsDashboard — buildComparisonQuery", () => {
  describe("half-open selection (latency comparison, traces)", () => {
    it("ends Selected time exclusively at the applied end, like the table query", () => {
      const selected = part(sqlOf(config()), "Selected");
      expect(selected).toContain(`_timestamp >= ${SEL.startTime}`);
      expect(selected).toContain(`_timestamp < ${SEL.endTime}`);
      expect(selected).not.toContain(`_timestamp <= ${SEL.endTime}`);
    });

    it("bounds the duration band half-open", () => {
      const selected = part(sqlOf(config()), "Selected");
      expect(selected).toContain("duration >= 100 AND duration < 500");
      expect(selected).not.toContain("duration <= 500");
    });

    it("leaves Baseline time inclusive", () => {
      const baseline = part(sqlOf(config()), "Baseline");
      expect(baseline).toContain(
        `_timestamp >= ${BASE.startTime} AND _timestamp <= ${BASE.endTime}`,
      );
    });
  });

  describe("other tabs and logs are unchanged", () => {
    it("keeps an inclusive Selected end on the volume tab", () => {
      const sql = sqlOf(
        config({
          analysisType: "volume",
          rateFilter: { start: -1, end: -1, timeStart: SEL.startTime, timeEnd: SEL.endTime },
        }),
      );
      expect(part(sql, "Selected")).toContain(`_timestamp <= ${SEL.endTime}`);
    });

    it("keeps an inclusive Selected end on the error tab", () => {
      const sql = sqlOf(
        config({
          analysisType: "error",
          errorFilter: { start: -1, end: -1, timeStart: SEL.startTime, timeEnd: SEL.endTime },
        }),
      );
      expect(part(sql, "Selected")).toContain(`_timestamp <= ${SEL.endTime}`);
    });

    it("keeps an inclusive Selected end for logs", () => {
      const sql = sqlOf(
        config({ streamType: "logs", analysisType: "volume", durationFilter: undefined }),
      );
      expect(part(sql, "Selected")).toContain(`_timestamp <= ${SEL.endTime}`);
    });
  });
});
