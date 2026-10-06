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

  describe("baseline from before the box (latency comparison, traces)", () => {
    const baselineFilter = "service_name = 'x' or a = '1'";

    it("ANDs the parenthesised pre-box filter into both sides instead of baseFilter", () => {
      const sql = sqlOf(config({ baselineFilter }));
      expect(part(sql, "Selected")).toContain(
        `WHERE _timestamp >= ${SEL.startTime} AND _timestamp < ${SEL.endTime} AND duration >= 100 AND duration < 500 AND (${baselineFilter})`,
      );
      expect(part(sql, "Baseline")).toContain(
        `WHERE _timestamp >= ${BASE.startTime} AND _timestamp <= ${BASE.endTime} AND (${baselineFilter})`,
      );
      expect(sql).not.toContain("service_name = 'api'");
    });

    it("adds no scope filter for an empty pre-box editor, even when baseFilter holds the band", () => {
      const band = "duration >= 100 AND duration < 500";
      const sql = sqlOf(config({ baselineFilter: "", baseFilter: band }));
      const selected = part(sql, "Selected");
      const baseline = part(sql, "Baseline");
      expect(selected.split(band)).toHaveLength(2);
      expect(baseline).not.toMatch(/\bduration\b(?!,)/);
      expect(baseline).toContain(
        `WHERE _timestamp >= ${BASE.startTime} AND _timestamp <= ${BASE.endTime} AND COALESCE(`,
      );
    });

    it("treats a whitespace-only pre-box editor as empty", () => {
      const band = "duration >= 100 AND duration < 500";
      const baseline = part(sqlOf(config({ baselineFilter: "   ", baseFilter: band })), "Baseline");
      expect(baseline).not.toContain(band);
      expect(baseline).not.toContain("()");
    });

    it("parenthesises an OR baseFilter on both sides when no baselineFilter is given", () => {
      const sql = sqlOf(config({ baseFilter: "a = '1' or b = '2'" }));
      expect(part(sql, "Selected")).toContain("duration < 500 AND (a = '1' or b = '2')");
      expect(part(sql, "Baseline")).toContain(
        `_timestamp <= ${BASE.endTime} AND (a = '1' or b = '2')`,
      );
    });

    it("groups both sides by the displayed value, so null and '(no value)' share one row", () => {
      const sql = sqlOf(config({ baselineFilter }));
      const grouped = "GROUP BY COALESCE(CAST(service_name AS VARCHAR), '(no value)')";
      expect(part(sql, "Selected")).toContain(grouped);
      expect(part(sql, "Baseline")).toContain(grouped);
      expect(sql).not.toMatch(/GROUP BY service_name\b/);
    });

    it("keeps baseFilter when no baselineFilter is given", () => {
      const sql = sqlOf(config());
      expect(part(sql, "Selected")).toContain("service_name = 'api'");
      expect(part(sql, "Baseline")).toContain("service_name = 'api'");
    });

    it("takes the top 5 values from Selected and restricts Baseline to them", () => {
      const sql = sqlOf(config({ baselineFilter }));
      expect(sql).toMatch(/^WITH selected AS \(/);
      expect(part(sql, "Selected")).toMatch(
        /ORDER BY percentile_latency DESC LIMIT 5\)\s*SELECT value, series, percentile_latency FROM selected\s*$/,
      );
      expect(part(sql, "Baseline")).toContain(
        "AND COALESCE(CAST(service_name AS VARCHAR), '(no value)') IN (SELECT value FROM selected)",
      );
      expect(sql.match(/\bLIMIT\b/g)).toHaveLength(1);
      // The column visitor reads `*` as a stream wildcard, so the CTE's columns are named.
      expect(sql).not.toContain("SELECT *");
    });

    it("leaves the volume and error queries unchanged by baselineFilter", () => {
      const volume = config({
        analysisType: "volume",
        rateFilter: { start: -1, end: -1, timeStart: SEL.startTime, timeEnd: SEL.endTime },
      });
      const error = config({
        analysisType: "error",
        errorFilter: { start: -1, end: -1, timeStart: SEL.startTime, timeEnd: SEL.endTime },
      });
      expect(sqlOf({ ...volume, baselineFilter })).toBe(sqlOf(volume));
      expect(sqlOf({ ...error, baselineFilter })).toBe(sqlOf(error));
    });
  });

  describe("comparison mode", () => {
    const sameRange = { baselineTimeRange: SEL, selectedTimeRange: SEL };
    const isComparison = (cfg: LatencyInsightsConfig) => {
      const panel = panelOf(cfg);
      return {
        legends: panel.config.show_legends,
        breakdown: panel.queries[0].fields.breakdown.map((b: any) => b.alias),
      };
    };

    it("stays on for the traces latency tab when a full-width box equals the baseline range", () => {
      expect(isComparison(config(sameRange))).toEqual({ legends: true, breakdown: ["series"] });
    });

    it("stays off for the volume and error tabs with equal ranges", () => {
      const time = { start: -1, end: -1, timeStart: SEL.startTime, timeEnd: SEL.endTime };
      expect(
        isComparison(config({ ...sameRange, analysisType: "volume", rateFilter: time })),
      ).toEqual({ legends: false, breakdown: [] });
      expect(
        isComparison(config({ ...sameRange, analysisType: "error", errorFilter: time })),
      ).toEqual({ legends: false, breakdown: [] });
    });

    it("stays off for logs with equal ranges", () => {
      expect(isComparison(config({ ...sameRange, streamType: "logs" }))).toEqual({
        legends: false,
        breakdown: [],
      });
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
