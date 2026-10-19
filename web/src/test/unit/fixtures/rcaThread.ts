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
  RcaBlindSpot,
  RcaEvidenceEntry,
  RcaRun,
  RcaRunItem,
  RcaRunSummary,
  RcaStep,
  RcaSteerRecord,
  RcaSteering,
  RcaSummary,
  RcaSummaryHypothesis,
  RcaThread,
  RcaThreadQuestion,
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
    report_format: "v2",
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
    report_format: "v2",
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
    report_format: "v2",
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

/** A pre-upgrade report served at read time; `v1-0` is the newest. Its time is `RCA_T0`. */
export function rcaV1RunItem(overrides: Partial<RcaRunItem> = {}): RcaRunItem {
  return rcaRunItem({
    run_id: "v1-0",
    trigger: "legacy",
    started_by: "system",
    started_at: RCA_T0,
    ended_at: RCA_T0,
    report_format: "v1",
    ...overrides,
  });
}

/** The detail `rca` of an incident whose only reports are pre-upgrade ones, newest first. */
export function rcaV1Summary(items: RcaRunItem[] = [rcaV1RunItem()]): RcaSummary {
  const newest = items[0];
  const at = newest.ended_at ?? newest.started_at;
  return rcaSummary({
    run_id: newest.run_id,
    state: "completed",
    started_at: newest.started_at,
    updated_at: at,
    report_format: "v1",
    current_run: rcaRun({
      run_id: newest.run_id,
      trigger: "legacy",
      started_by: "system",
      state: "completed",
      started_at: newest.started_at,
      updated_at: at,
      ended_at: at,
      session_id: null,
      report_format: "v1",
    }),
    report_run: newest,
    history: items,
    resume_run_id: null,
  });
}

// Summary views (03 §12), one for each redesign frame plus a legacy run.

export function rcaEvidenceEntry(overrides: Partial<RcaEvidenceEntry> = {}): RcaEvidenceEntry {
  return {
    number: 1,
    ids: ["e1"],
    call_id: "call-1",
    kind: "SQL",
    target: "logs",
    link: {
      signal: "logs",
      streams: ["checkout_api"],
      sql: "SELECT count(*) FROM \"checkout_api\" WHERE level = 'error'",
      start_us: RCA_T0 - sec(1_800),
      end_us: RCA_T0 + sec(1_800),
    },
    result_summary: "2 rows · took 41 ms",
    duration_ms: 41,
    decisive: true,
    citations: [
      {
        hypothesis_id: "h1",
        evidence_id: "e1",
        polarity: "supports",
        strength: "decisive",
        observation: "Errors begin 116 s after the rollout.",
      },
    ],
    ...overrides,
  };
}

export function rcaHypothesis(overrides: Partial<RcaSummaryHypothesis> = {}): RcaSummaryHypothesis {
  return {
    id: "h1",
    statement: "Deploy 4f2c1e opens one orders-db connection per line item",
    status: "root_cause",
    reason: "Pool hits 100/100 within 2 min of rollout.",
    evidence_numbers: [1],
    unverified_ids: [],
    lead_ids: [],
    first_seen_seq: 3,
    history: [
      { at: RCA_T0 + sec(60), status: "testing" },
      { at: RCA_T0 + sec(200), status: "root_cause" },
    ],
    ...overrides,
  };
}

export function rcaBlindSpot(overrides: Partial<RcaBlindSpot> = {}): RcaBlindSpot {
  return {
    id: "b1",
    axis: "other",
    title: "Feature-flag history",
    why: "No toolset in this org provides flag changes.",
    fix: "connect_toolset",
    ...overrides,
  };
}

const PROMQL_ENTRY = rcaEvidenceEntry({
  number: 2,
  ids: ["e2"],
  call_id: "call-2",
  kind: "PromQL",
  target: "metrics",
  link: {
    signal: "metrics",
    streams: [],
    promql: 'max(db_pool_in_use{db="orders"})',
    start_us: RCA_T0 - sec(1_800),
    end_us: RCA_T0 + sec(1_800),
  },
  result_summary: "6 series · 240 points",
  duration_ms: 230,
  decisive: false,
  citations: [
    {
      hypothesis_id: "h2",
      evidence_id: "e2",
      polarity: "supports",
      strength: "supporting",
      observation: "orders pool at 100/100 on all 6 pods from 14:04:05",
    },
  ],
});

/** Frame B: completed, root cause identified, high band. */
export function rcaRunSummary(overrides: Partial<RcaRunSummary> = {}): RcaRunSummary {
  return {
    run_id: "run-2",
    state: "completed",
    state_version: "-1.0.1760000000000000.0",
    not_modified: false,
    legacy: false,
    card: {
      outcome: "root_cause_identified",
      outcome_reason: "root_cause_graded",
      headline: "checkout-api deploy 4f2c1e exhausted the orders-db connection pool",
      band: "high",
      band_reason: "high · decisive: traces + change · ruled out: node CPU",
      suspect_change: {
        kind: "deploy",
        reference: "4f2c1e",
        occurred_at: RCA_T0,
        shown_state: "confirmed",
      },
      impact: {
        summary: "3 services",
        peak: "4.1% 5xx",
        window: { start: RCA_T0 + sec(120), end: RCA_T0 + sec(1_740) },
      },
    },
    timeline: [
      {
        at: RCA_T0 + sec(234),
        text: "Pool saturated; requests wait 2 s for a connection and time out",
        status: "confirmed",
        evidence_numbers: [2],
      },
      {
        at: RCA_T0,
        text: "Deploy 4f2c1e (PR #812) rolls out to checkout-api",
        status: "confirmed",
        evidence_numbers: [1],
      },
      {
        at: RCA_T0 + sec(379),
        text: "cart-api errors follow through calls to checkout-api",
        status: "likely",
        evidence_numbers: [],
      },
    ],
    hypotheses: [
      rcaHypothesis(),
      rcaHypothesis({
        id: "h2",
        statement: "Pool sized at 100 with a 2 s acquire timeout",
        status: "contributing",
        reason: "The pool has no headroom for the new query pattern.",
        evidence_numbers: [2],
        first_seen_seq: 5,
      }),
      rcaHypothesis({
        id: "h3",
        statement: "Feature flag flip at about 14:00",
        status: "blocked",
        reason: "No flag history is reachable.",
        evidence_numbers: [],
        first_seen_seq: 7,
        history: [],
      }),
      rcaHypothesis({
        id: "h4",
        statement: "Node CPU saturation",
        status: "ruled_out",
        reason: "CPU flat at 34–41% across 9 nodes.",
        evidence_numbers: [],
        unverified_ids: ["e7"],
        first_seen_seq: 4,
        history: [
          { at: RCA_T0 + sec(60), status: "testing" },
          { at: RCA_T0 + sec(180), status: "ruled_out", steered_by: "a.rao@acme.io" },
        ],
      }),
    ],
    evidence: [rcaEvidenceEntry(), PROMQL_ENTRY],
    unverified: [
      {
        hypothesis_id: "h4",
        evidence_id: "e7",
        tool: "PrometheusRangeQuery",
        query: "avg(node_cpu)",
        reason: "not_run",
      },
    ],
    blind_spots: [
      rcaBlindSpot(),
      rcaBlindSpot({
        id: "b2",
        axis: "logs",
        title: "payments-worker logs are sampled",
        why: "Pipeline drop-debug keeps 10% of payments_worker logs.",
        fix: "open_pipeline",
      }),
    ],
    ...overrides,
  };
}

/** Frame A: live, the leading hypothesis was revised; no band, no timeline. */
export const rcaRunSummaryLive = (overrides: Partial<RcaRunSummary> = {}): RcaRunSummary =>
  rcaRunSummary({
    state: "running",
    state_version: "12.100.200",
    card: {
      leading: { id: "h1", statement: "Deploy 4f2c1e exhausted the orders-db pool" },
      verdict_so_far: {
        label: "revised",
        was: "Pool too small for the load after deploy 4f2c1e",
      },
    },
    timeline: [],
    hypotheses: [
      rcaHypothesis({ status: "testing", history: [] }),
      rcaHypothesis({
        id: "h2",
        statement: "checkout-api 5xx on POST /api/orders",
        status: "symptom",
        evidence_numbers: [2],
        first_seen_seq: 5,
        history: [],
      }),
    ],
    unverified: [],
    blind_spots: [],
    ...overrides,
  });

/** Frame C: completed, inconclusive, low band, suspect change not read. */
export const rcaRunSummaryInconclusive = (
  overrides: Partial<RcaRunSummary> = {},
): RcaRunSummary => {
  const base = rcaRunSummary();
  return rcaRunSummary({
    card: {
      ...base.card,
      outcome: "inconclusive",
      outcome_reason: "no_confirmed_cause",
      headline: "orders-db connection pool exhaustion after checkout-api deploy 4f2c1e",
      band: "low",
      band_reason: "low · no confirmed cause",
      suspect_change: { ...base.card.suspect_change!, shown_state: "not_read" },
    },
    hypotheses: [
      rcaHypothesis({ status: "inconclusive" }),
      rcaHypothesis({
        id: "h2",
        statement: "Traffic surge on POST /api/orders",
        status: "inconclusive",
        first_seen_seq: 6,
      }),
      rcaHypothesis({
        id: "h5",
        statement: "Old root cause claim",
        status: "root_cause",
        first_seen_seq: 9,
      }),
    ],
    evidence: base.evidence.map((entry) => ({ ...entry, decisive: false })),
    ...overrides,
  });
};

/** Frame D: completed, blocked on change history. */
export const rcaRunSummaryBlocked = (overrides: Partial<RcaRunSummary> = {}): RcaRunSummary => {
  const base = rcaRunSummary();
  return rcaRunSummary({
    card: {
      ...base.card,
      outcome: "blocked",
      outcome_reason: "leading_blocked",
      headline: "orders-db pool saturated at 14:04. The change behind it can't be checked",
      band: "low",
      band_reason: "low · no confirmed cause",
      suspect_change: undefined,
      needs: "Change history",
    },
    blind_spots: [
      rcaBlindSpot({
        id: "b1",
        axis: "change",
        title: "Change history",
        why: "No toolset provides deploys, PRs or config changes.",
      }),
    ],
    ...overrides,
  });
};

/** Frame E: cancelled with a partial record (VE34); no verdict, no grade, no timeline. */
export const rcaRunSummaryCancelled = (overrides: Partial<RcaRunSummary> = {}): RcaRunSummary =>
  rcaRunSummary({
    state: "cancelled",
    card: {},
    timeline: [],
    hypotheses: [
      rcaHypothesis({ status: "untested", evidence_numbers: [1, 2] }),
      rcaHypothesis({
        id: "h2",
        statement: "Traffic surge on POST /api/orders",
        status: "untested",
        evidence_numbers: [],
        first_seen_seq: 6,
        history: [],
      }),
    ],
    unverified: [],
    blind_spots: [
      rcaBlindSpot({
        id: "run_end",
        axis: "other",
        title: "3 stages did not run",
        why: "Log patterns, Metrics, Converge",
        fix: "resume_run",
      }),
    ],
    ...overrides,
  });

/** A run that finished with no stored record (VE42). */
export const rcaRunSummaryLegacy = (overrides: Partial<RcaRunSummary> = {}): RcaRunSummary =>
  rcaRunSummaryCancelled({
    state: "completed",
    legacy: true,
    hypotheses: [],
    evidence: [],
    blind_spots: [],
    ...overrides,
  });

/** One steering row (04 §8.1): a queued message from a.rao. */
export function rcaSteerRecord(overrides: Partial<RcaSteerRecord> = {}): RcaSteerRecord {
  return {
    org_id: "default",
    steer_id: "stg_2QaRao000000000000000000001",
    run_id: "run-2",
    incident_id: "inc-1",
    author_email: "a.rao@acme.io",
    kind: "message",
    action: null,
    hypothesis_id: null,
    question_id: null,
    text: "We raised the orders pool to 150 on Oct 8",
    status: "queued",
    status_reason: null,
    created_at: RCA_T0 + sec(200),
    delivered_at: null,
    read_at: null,
    acted_at: null,
    agent_note: null,
    ...overrides,
  };
}

/** The steering view (04 §9.2) of a live run the user can steer, with no rows. */
export function rcaSteering(overrides: Partial<RcaSteering> = {}): RcaSteering {
  return { items: [], open_question: null, can_steer: true, ...overrides };
}

/** The question of frames D and G: change history no connected tool provides. */
export function rcaThreadQuestion(overrides: Partial<RcaThreadQuestion> = {}): RcaThreadQuestion {
  return {
    question_id: "call_7f",
    question:
      "Which change went out to checkout-api around 14:02? " +
      "No connected AI Toolset has deploy or PR history.",
    need: "change history",
    hypothesis_id: "h1",
    at: RCA_T0 + sec(240),
    answered_by: null,
    answered_at: null,
    ...overrides,
  };
}

/** Frame F: live and steered twice, the newest message applied. */
export const rcaSteeringLive = (overrides: Partial<RcaSteering> = {}): RcaSteering =>
  rcaSteering({
    items: [
      rcaSteerRecord({
        steer_id: "stg_2QjOkafor000000000000000001",
        author_email: "j.okafor@acme.io",
        text: "Ignore the payments 5xx, that is the canary.",
        status: "read",
        created_at: RCA_T0 + sec(150),
        delivered_at: RCA_T0 + sec(151),
        read_at: RCA_T0 + sec(170),
      }),
      rcaSteerRecord({
        status: "applied",
        delivered_at: RCA_T0 + sec(201),
        read_at: RCA_T0 + sec(220),
        acted_at: RCA_T0 + sec(221),
        agent_note: "Checking the pool size against the connection errors.",
      }),
    ],
    ...overrides,
  });

/** Frame D: paused on the change-history question until 14:40. */
export const rcaSteeringPaused = (overrides: Partial<RcaSteering> = {}): RcaSteering => {
  const question = rcaThreadQuestion();
  return rcaSteering({
    open_question: {
      question_id: question.question_id,
      question: question.question,
      need: question.need,
      hypothesis_id: question.hypothesis_id ?? null,
      deadline_at: RCA_T0 + sec(1_800),
    },
    ...overrides,
  });
};

/** Frame G: the answer was read; the run then finished. */
export const rcaSteeringUnblocked = (overrides: Partial<RcaSteering> = {}): RcaSteering =>
  rcaSteering({
    can_steer: false,
    items: [
      rcaSteerRecord({
        kind: "answer",
        question_id: "call_7f",
        text: "PR #812 in acme/checkout, deployed around 14:02.",
        status: "read",
        created_at: RCA_T0 + sec(300),
        delivered_at: RCA_T0 + sec(301),
        read_at: RCA_T0 + sec(310),
      }),
    ],
    ...overrides,
  });
