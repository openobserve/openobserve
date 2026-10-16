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

// Fixtures for the RCA investigation thread (02 TH29–TH38). Times are microseconds.

import type {
  RcaRun,
  RcaRunItem,
  RcaStep,
  RcaSummary,
  RcaThread,
  RcaToolCall,
} from "@/services/incidents";

/** 2025-10-09T08:53:20Z. */
export const RCA_T0 = 1_760_000_000_000_000;

export const sec = (s: number) => s * 1_000_000;

export function rcaToolCall(overrides: Partial<RcaToolCall> = {}): RcaToolCall {
  return {
    call_id: "call-1",
    tool: "SearchSQL",
    key_arg: "SELECT count(*) FROM checkout_logs",
    status: "ok",
    started_at: RCA_T0 + sec(5),
    duration_ms: 1_200,
    result_summary: "42 rows",
    error: null,
    ...overrides,
  };
}

export function rcaStep(overrides: Partial<RcaStep> = {}): RcaStep {
  return {
    index: 1,
    stage: "context",
    title: "Load incident context",
    started_at: RCA_T0 + sec(4),
    ended_at: RCA_T0 + sec(20),
    note: "Checkout errors rose at 08:52 [e3] after the deploy [e7].",
    note_truncated: false,
    citations: ["e3", "e7"],
    tool_calls: [
      rcaToolCall(),
      rcaToolCall({
        call_id: "call-2",
        tool: "get_topology",
        key_arg: "service=checkout",
        status: "error",
        duration_ms: 300,
        result_summary: null,
        error: "upstream timeout",
      }),
    ],
    ...overrides,
  };
}

/** A live thread: one finished step and one running step. */
export function rcaThread(overrides: Partial<RcaThread> = {}): RcaThread {
  return {
    run_id: "run-2",
    state_version: "12.100.200",
    not_modified: false,
    active: true,
    transcript: "available",
    started: { at: RCA_T0, prompt: "Analyze incident checkout-errors (3 alerts, P1)." },
    steps: [
      rcaStep(),
      rcaStep({
        index: 2,
        stage: "topology",
        title: "Map the checkout dependencies",
        started_at: RCA_T0 + sec(21),
        ended_at: null,
        note: null,
        citations: [],
        tool_calls: [
          rcaToolCall({
            call_id: "call-3",
            tool: "get_service_graph",
            key_arg: "checkout",
            status: "running",
            duration_ms: null,
            result_summary: null,
          }),
        ],
      }),
    ],
    user_messages: [],
    questions: [],
    report_submitted: false,
    stats: { steps: 9, tool_calls: 27, duration_ms: 252_000 },
    ...overrides,
  };
}

export function rcaRunItem(overrides: Partial<RcaRunItem> = {}): RcaRunItem {
  return {
    run_id: "run-1",
    subject_type: "incident",
    trigger: "auto_new_incident",
    mode: "fresh",
    started_by: "system",
    state: "completed",
    started_at: RCA_T0,
    ended_at: RCA_T0 + sec(60),
    outcome: null,
    confidence: null,
    cancelled_by: null,
    error_reason: null,
    ...overrides,
  };
}

export function rcaRun(overrides: Partial<RcaRun> = {}): RcaRun {
  return {
    run_id: "run-2",
    subject_type: "incident",
    subject_id: "inc-1",
    incident_id: "inc-1",
    trigger: "reanalyze",
    mode: "fresh",
    started_by: "a.rao@acme.io",
    guidance: null,
    state: "running",
    started_at: RCA_T0 + sec(120),
    updated_at: RCA_T0 + sec(120),
    ended_at: null,
    cancelled_by: null,
    outcome: null,
    confidence: null,
    report: null,
    result: null,
    error: null,
    session_id: "sess-2",
    stats: null,
    ...overrides,
  };
}

export function rcaSummary(
  overrides: Partial<RcaSummary> & { summary?: Partial<RcaSummary["summary"]> } = {},
): RcaSummary {
  const { summary, ...rest } = overrides;
  return {
    run_id: "run-2",
    state: "running",
    stale: false,
    started_at: RCA_T0 + sec(120),
    updated_at: RCA_T0 + sec(120),
    outcome: null,
    confidence: null,
    ...rest,
    summary: {
      stage: null,
      stage_index: null,
      stage_count: 7,
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
  };
}
