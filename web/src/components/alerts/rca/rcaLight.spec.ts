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

import { describe, expect, it } from "vitest";
import type { RcaRunItem, RcaSummaryHypothesis } from "@/services/incidents";
import {
  rcaFailedAnalyses,
  rcaFailReason,
  rcaFiringScope,
  rcaImpactFact,
  rcaOpenFindings,
  type RcaIncidentEvent,
} from "./rcaLight";

const hypothesis = (id: string, status: RcaSummaryHypothesis["status"]): RcaSummaryHypothesis => ({
  id,
  statement: id,
  status,
  reason: "",
  evidence_numbers: [],
  unverified_ids: [],
  lead_ids: [],
  first_seen_seq: 0,
  history: [],
});

const run = (state: RcaRunItem["state"], extra: Partial<RcaRunItem> = {}): RcaRunItem => ({
  run_id: `r-${state}`,
  subject_type: "incident",
  trigger: "auto_new_incident",
  mode: "fresh",
  started_by: "system",
  state,
  started_at: 1_000,
  ended_at: 2_000,
  outcome: null,
  confidence: null,
  cancelled_by: null,
  error_reason: null,
  report_format: "v2",
  has_record: false,
  ...extra,
});

const MIN = 60_000_000;
const begin = (timestamp: number): RcaIncidentEvent => ({ timestamp, type: "ai_analysis_begin" });
const failed = (timestamp: number, reason: string): RcaIncidentEvent => ({
  timestamp,
  type: "ai_analysis_failed",
  data: { reason },
});
// 3 attempts, 5 failure events, no success.
const FAILED_EVENTS: RcaIncidentEvent[] = [
  begin(MIN),
  failed(3 * MIN, "RCA service call failed"),
  failed(3 * MIN + 5_000, "Background spawn failed"),
  begin(10 * MIN),
  failed(12 * MIN, "Service call failed"),
  begin(20 * MIN),
  failed(22 * MIN, "RCA service call failed"),
  failed(22 * MIN + 5_000, "Reanalysis trigger failed"),
];

describe("rcaLight", () => {
  it("counts Likely and untested hypotheses as open findings, never the root cause", () => {
    const open = rcaOpenFindings([
      hypothesis("root", "root_cause"),
      hypothesis("exposure", "likely"),
      hypothesis("gone", "ruled_out"),
      hypothesis("later", "untested"),
    ]);
    expect(open.map((h) => h.id)).toEqual(["exposure", "later"]);
  });

  describe("impact fact", () => {
    it("names the impacted services first", () => {
      expect(rcaImpactFact("", { summary: "x" }, ["api", "db"])).toEqual({
        kind: "services",
        services: ["api", "db"],
      });
    });

    it("shortens the report's Customer Impact row to its first clause", () => {
      const report =
        "- **Customer Impact**: None — no outage, no data loss, no compromise. Every flow was rejected.";
      expect(rcaImpactFact(report, { summary: "summary" }, [])).toEqual({
        kind: "customer",
        short: "None",
        full: "None — no outage, no data loss, no compromise. Every flow was rejected.",
      });
      expect(rcaImpactFact("| Customer Impact | Minor delays. |", undefined, [])).toMatchObject({
        short: "Minor delays",
      });
    });

    it("falls back to impact.summary, then to none", () => {
      expect(rcaImpactFact("", { summary: "No service impact: blocked scans." }, [])).toEqual({
        kind: "summary",
        short: "No service impact",
        full: "No service impact: blocked scans.",
      });
      expect(rcaImpactFact("", undefined, [])).toEqual({ kind: "none" });
    });
  });

  it("scopes this incident's firings: count, distinct alerts, first and last", () => {
    expect(
      rcaFiringScope([
        { alert_id: "a", alert_name: "A", alert_fired_at: 30 },
        { alert_id: "b", alert_name: "B", alert_fired_at: 10 },
        { alert_id: "a", alert_name: "A", alert_fired_at: 20 },
        // One evaluation can write two rows for the same firing.
        { alert_id: "a", alert_name: "A", alert_fired_at: 20 },
      ]),
    ).toEqual({ firings: 3, alerts: 2, firstAt: 10, lastAt: 30 });
    expect(rcaFiringScope([])).toBeNull();
  });

  describe("failed analyses", () => {
    it("counts attempts, not failure events, for the attempts and their reasons alike", () => {
      expect(rcaFailedAnalyses(FAILED_EVENTS, [])).toEqual({
        attempts: 3,
        lastAt: 22 * MIN + 5_000,
        reasons: [{ reason: "noResponse", count: 3 }],
      });
    });

    it("is null once any analysis succeeded or when nothing failed", () => {
      expect(
        rcaFailedAnalyses(
          [...FAILED_EVENTS, { timestamp: 30 * MIN, type: "ai_analysis_complete" }],
          [],
        ),
      ).toBeNull();
      expect(rcaFailedAnalyses(FAILED_EVENTS, [run("completed")])).toBeNull();
      expect(rcaFailedAnalyses([], [])).toBeNull();
      expect(rcaFailedAnalyses(null, [run("running")])).toBeNull();
    });

    it("falls back to the failed runs when the events are not loaded", () => {
      expect(
        rcaFailedAnalyses(null, [
          run("failed", { ended_at: 5_000, error_reason: "RCA service call failed" }),
          run("failed", { ended_at: 9_000, error_reason: "boom" }),
        ]),
      ).toEqual({
        attempts: 2,
        lastAt: 9_000,
        reasons: [
          { reason: "noResponse", count: 1 },
          { reason: "other", count: 1 },
        ],
      });
    });

    it("maps unknown reasons to a plain catch-all", () => {
      expect(rcaFailReason(null)).toBe("other");
      expect(rcaFailReason("error sending request: operation timed out")).toBe("noResponse");
    });
  });
});
