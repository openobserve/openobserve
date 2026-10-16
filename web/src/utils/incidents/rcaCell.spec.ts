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
import type { Incident, RcaSummary } from "@/services/incidents";
import { isLiveRca, rcaCellModel, type RcaCellModel } from "./rcaCell";

const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);
const minutesAgoMicros = (m: number) => (NOW - m * 60_000) * 1000;

const PREVIOUS = {
  run_id: "run-0",
  outcome: null,
  confidence: null,
  ended_at: minutesAgoMicros(60),
};

function rca(over: Partial<RcaSummary> & { summary?: Partial<RcaSummary["summary"]> }) {
  const { summary, ...rest } = over;
  return {
    run_id: "run-1",
    state: "running",
    stale: false,
    started_at: minutesAgoMicros(4),
    updated_at: minutesAgoMicros(4),
    outcome: null,
    confidence: null,
    ...rest,
    summary: {
      stage: null,
      stage_index: null,
      stage_count: 0,
      steps: 0,
      tool_calls: 0,
      steered_by: [],
      unblocked_by: null,
      detail: null,
      deadline_at: null,
      cancelled_by: null,
      previous: null,
      ...summary,
    },
  } as RcaSummary;
}

type Row = Pick<Incident, "rca" | "rca_off_reason" | "severity">;
type Expected = Pick<RcaCellModel, "kind" | "label" | "tone" | "detail" | "rerunNote"> &
  Partial<Pick<RcaCellModel, "spinner" | "showAnalyzeOnHover">>;

// 01 §12.1, Phase 1 rows; RR-42 previous-result rows; RR-43 precedence.
const cases: [string, Row, boolean, Expected][] = [
  [
    "RCA disabled",
    { rca: null, rca_off_reason: null, severity: "P2" },
    false,
    { kind: "state", label: "RCA disabled", tone: "muted", detail: "", rerunNote: "" },
  ],
  [
    "RR-43: disabled hides Analyze and wins over RCA off",
    { rca: null, rca_off_reason: "l0_off", severity: "P4" },
    false,
    {
      kind: "state",
      label: "RCA disabled",
      tone: "muted",
      detail: "",
      rerunNote: "",
      showAnalyzeOnHover: false,
    },
  ],
  [
    "RCA off · No AI SRE for P4",
    { rca: null, rca_off_reason: "l0_off", severity: "P4" },
    true,
    {
      kind: "state",
      label: "RCA off",
      tone: "muted",
      detail: "No AI SRE for P4",
      rerunNote: "",
      showAnalyzeOnHover: true,
    },
  ],
  [
    "Analyze",
    { rca: null, rca_off_reason: null, severity: "P2" },
    true,
    { kind: "analyze", label: "Analyze", tone: "muted", detail: "", rerunNote: "" },
  ],
  [
    "Investigating · 4m",
    { rca: rca({}), severity: "P2" },
    true,
    {
      kind: "state",
      label: "Investigating",
      tone: "muted",
      detail: "4m",
      rerunNote: "",
      spinner: true,
    },
  ],
  [
    "Investigating · re-run · 4m",
    { rca: rca({ summary: { previous: PREVIOUS } }), severity: "P2" },
    true,
    {
      kind: "state",
      label: "Investigating",
      tone: "muted",
      detail: "re-run · 4m",
      rerunNote: "",
      spinner: true,
    },
  ],
  [
    "Investigating · no update for 12m (server stale)",
    {
      rca: rca({ stale: true, started_at: minutesAgoMicros(30), updated_at: minutesAgoMicros(12) }),
      severity: "P2",
    },
    true,
    {
      kind: "state",
      label: "Investigating",
      tone: "warn",
      detail: "no update for 12m",
      rerunNote: "",
      spinner: false,
    },
  ],
  [
    "running but not server-stale never reads stale, however old",
    {
      rca: rca({ started_at: minutesAgoMicros(90), updated_at: minutesAgoMicros(80) }),
      severity: "P2",
    },
    true,
    {
      kind: "state",
      label: "Investigating",
      tone: "muted",
      detail: "1h 30m",
      rerunNote: "",
      spinner: true,
    },
  ],
  [
    "Analyzed · 3m ago (outcome null: Phase 1 behaviour)",
    { rca: rca({ state: "completed", updated_at: minutesAgoMicros(3) }), severity: "P2" },
    true,
    { kind: "state", label: "Analyzed", tone: "ok", detail: "3m ago", rerunNote: "" },
  ],
  [
    "RR-43: an older completed run still shows Analyzed when RCA is disabled",
    { rca: rca({ state: "completed", updated_at: minutesAgoMicros(3) }), severity: "P2" },
    false,
    { kind: "state", label: "Analyzed", tone: "ok", detail: "3m ago", rerunNote: "" },
  ],
  [
    "Failed · Agent unavailable",
    { rca: rca({ state: "failed", summary: { detail: "Agent unavailable" } }), severity: "P2" },
    true,
    { kind: "state", label: "Failed", tone: "err", detail: "Agent unavailable", rerunNote: "" },
  ],
  [
    "Failed · Cancelled by a.rao",
    {
      rca: rca({ state: "cancelled", summary: { cancelled_by: "a.rao@acme.io" } }),
      severity: "P2",
    },
    true,
    { kind: "state", label: "Failed", tone: "err", detail: "Cancelled by a.rao", rerunNote: "" },
  ],
  [
    "RR-42: previous + re-run failed",
    {
      rca: rca({ state: "failed", summary: { detail: "Agent unavailable", previous: PREVIOUS } }),
      severity: "P2",
    },
    true,
    { kind: "state", label: "Analyzed", tone: "ok", detail: "", rerunNote: "re-run failed" },
  ],
  [
    "RR-42: previous + re-run cancelled by a.rao",
    {
      rca: rca({
        state: "cancelled",
        summary: { cancelled_by: "a.rao@acme.io", previous: PREVIOUS },
      }),
      severity: "P2",
    },
    true,
    {
      kind: "state",
      label: "Analyzed",
      tone: "ok",
      detail: "",
      rerunNote: "re-run cancelled by a.rao",
    },
  ],
  // 03 VE14, VE16, VE44: outcome labels with the band; blocked names what it needs.
  [
    "Root cause identified · High",
    {
      rca: rca({ state: "completed", outcome: "root_cause_identified", confidence: "high" }),
      severity: "P2",
    },
    true,
    { kind: "state", label: "Root cause identified", tone: "ok", detail: "High", rerunNote: "" },
  ],
  [
    "Contributing factor · Medium",
    {
      rca: rca({ state: "completed", outcome: "contributing_factor", confidence: "medium" }),
      severity: "P2",
    },
    true,
    { kind: "state", label: "Contributing factor", tone: "warn", detail: "Medium", rerunNote: "" },
  ],
  [
    "Inconclusive · Low",
    {
      rca: rca({ state: "completed", outcome: "inconclusive", confidence: "low" }),
      severity: "P2",
    },
    true,
    { kind: "state", label: "Inconclusive", tone: "warn", detail: "Low", rerunNote: "" },
  ],
  [
    "an outcome with no band shows no detail",
    { rca: rca({ state: "completed", outcome: "inconclusive", confidence: null }), severity: "P2" },
    true,
    { kind: "state", label: "Inconclusive", tone: "warn", detail: "", rerunNote: "" },
  ],
  [
    "Blocked · Needs: Change history (VE44 detail, not the band)",
    {
      rca: rca({
        state: "completed",
        outcome: "blocked",
        confidence: "low",
        summary: { detail: "Needs: Change history" },
      }),
      severity: "P2",
    },
    true,
    {
      kind: "state",
      label: "Blocked",
      tone: "warn-strong",
      detail: "Needs: Change history",
      rerunNote: "",
    },
  ],
  [
    "waiting_input · Blocked with the question's need",
    {
      rca: rca({ state: "waiting_input", summary: { detail: "Needs change history" } }),
      severity: "P2",
    },
    true,
    {
      kind: "state",
      label: "Blocked",
      tone: "warn-strong",
      detail: "Needs change history",
      rerunNote: "",
    },
  ],
  [
    "RR-42: the previous outcome and band stay when a re-run fails",
    {
      rca: rca({
        state: "failed",
        summary: {
          detail: "Agent unavailable",
          previous: { ...PREVIOUS, outcome: "root_cause_identified", confidence: "high" },
        },
      }),
      severity: "P2",
    },
    true,
    {
      kind: "state",
      label: "Root cause identified",
      tone: "ok",
      detail: "High",
      rerunNote: "re-run failed",
    },
  ],
  [
    "RR-42: the previous outcome and band stay when a re-run is cancelled",
    {
      rca: rca({
        state: "cancelled",
        summary: {
          cancelled_by: "a.rao@acme.io",
          previous: { ...PREVIOUS, outcome: "inconclusive", confidence: "low" },
        },
      }),
      severity: "P2",
    },
    true,
    {
      kind: "state",
      label: "Inconclusive",
      tone: "warn",
      detail: "Low",
      rerunNote: "re-run cancelled by a.rao",
    },
  ],
];

describe("rcaCellModel (01 §12.1, RR-42, 03 VE14/VE44)", () => {
  it.each(cases)("%s", (_name, row, rcaEnabled, expected) => {
    const model = rcaCellModel(row, { rcaEnabled, now: NOW });
    expect(model).toMatchObject(expected);
  });
});

describe("isLiveRca (RR-34)", () => {
  it.each([
    ["running", true],
    ["waiting_input", true],
    ["completed", false],
    ["failed", false],
    ["cancelled", false],
  ] as const)("%s → %s", (state, live) => {
    expect(isLiveRca(rca({ state }))).toBe(live);
  });

  it("no run is not live", () => {
    expect(isLiveRca(null)).toBe(false);
  });
});
