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

import http, { attemptTokenRefresh } from "./http";
import store from "@/stores";
import analytics from "./product_analytics";
import type { TranslateFn } from "@/types/i18n";
import type { ResolutionCause } from "@/ts/interfaces/oncall";
import serviceStreamsApi, {
  type CorrelationRequest,
  type CorrelationResponse,
  type StreamInfo,
} from "./service_streams";
import { filterDimensionsForCorrelation } from "@/utils/telemetryCorrelation";
import {
  loadIdentityConfig,
  clearIdentityConfigCache,
  clearAllIdentityConfigCache,
} from "@/utils/identityConfig";

// Types matching backend API responses
export interface Incident {
  id: string;
  org_id: string;
  status: "open" | "acknowledged" | "resolved";
  severity: "P1" | "P2" | "P3" | "P4";
  group_values?: Record<string, string>;
  key_type?: "Primary" | "Secondary" | "AlertId";
  topology_context?: IncidentTopology;
  first_alert_at: number;
  last_alert_at: number;
  resolved_at?: number;
  alert_count: number;
  title?: string;
  assigned_to?: string;
  acknowledged_by?: string;
  acknowledged_at?: number;
  created_at: number;
  updated_at: number;
  /** Set while a downtime mutes the incident; cleared by the first firing after the window. */
  muted_by_downtime_id?: string | null;
  /** Summary of the latest RCA run, or null when the incident has none. */
  rca: RcaSummary | null;
  /** Why no automatic run started for this incident (e.g. "l0_off"), or null. */
  rca_off_reason?: string | null;
}

export type RcaRunState = "running" | "waiting_input" | "completed" | "failed" | "cancelled";

export type RcaTrigger =
  | "auto_new_incident"
  | "auto_new_alert_type"
  | "auto_reopen"
  | "manual"
  | "reanalyze"
  | "oncall_page"
  | "resume"
  | "legacy";

export type RcaRunMode = "fresh" | "build_on_previous";

/** `v1`: a pre-upgrade report served as markdown only; `v2`: an `rca_runs` row. */
export type RcaReportFormat = "v1" | "v2";

/** Outcome of a completed run (03 VE14). */
export type RcaOutcome =
  "root_cause_identified" | "contributing_factor" | "inconclusive" | "blocked";

/** Graded confidence band (CG §5.3). */
export type RcaBand = "high" | "medium" | "low";

export type RcaRunSubjectType = "incident" | "alert";

/** The finished result shown while a newer run is live, failed or cancelled. */
export interface RcaPreviousResult {
  run_id: string;
  outcome: RcaOutcome | null;
  confidence: RcaBand | null;
  /** Microseconds since epoch. */
  ended_at: number;
}

/** The `rca_summary` fields stored on the incident row. */
export interface RcaSummaryFields {
  stage: string | null;
  stage_index: number | null;
  stage_count: number;
  steps: number;
  tool_calls: number;
  steered_by: string[];
  unblocked_by: string | null;
  /** The error reason of a failed run, or the blocked detail. */
  detail: string | null;
  deadline_at: number | null;
  /** Display name of the user who cancelled the run. */
  cancelled_by?: string | null;
  previous: RcaPreviousResult | null;
}

/** Run summary of an incident's latest run. Times are microseconds since epoch. */
export interface RcaSummary {
  run_id: string;
  state: RcaRunState;
  /** Computed by the server: a running run with no update past the stale threshold. */
  stale: boolean;
  started_at: number;
  updated_at: number;
  outcome: RcaOutcome | null;
  confidence: RcaBand | null;
  summary: RcaSummaryFields;
  /** Detail endpoint only: the newest run, without its report. */
  current_run?: RcaRun | null;
  /** Detail endpoint only: the newest completed run, without its report. */
  report_run?: RcaRunItem | null;
  /** Detail endpoint only: runs newest first. */
  history?: RcaRunItem[];
  resume_run_id?: string | null;
  report_format: RcaReportFormat;
}

export interface RcaRunItem {
  run_id: string;
  subject_type: RcaRunSubjectType;
  trigger: RcaTrigger;
  mode: RcaRunMode;
  started_by: string;
  state: RcaRunState;
  started_at: number;
  ended_at: number | null;
  outcome: RcaOutcome | null;
  confidence: RcaBand | null;
  cancelled_by: string | null;
  error_reason: string | null;
  report_format: RcaReportFormat;
}

export interface RcaRunError {
  code: string;
  reason: string;
  details: string | null;
  trigger_type: string | null;
}

export interface RcaRunStats {
  steps?: number;
  tool_calls?: number;
  duration_ms?: number;
  tokens?: unknown;
  credits?: number;
  steered?: number;
}

export interface RcaRun {
  run_id: string;
  subject_type: RcaRunSubjectType;
  subject_id: string;
  incident_id: string | null;
  trigger: RcaTrigger;
  mode: RcaRunMode;
  started_by: string;
  guidance: string | null;
  state: RcaRunState;
  started_at: number;
  updated_at: number;
  ended_at: number | null;
  cancelled_by: string | null;
  outcome: RcaOutcome | null;
  confidence: RcaBand | null;
  report: string | null;
  result: unknown;
  error: RcaRunError | null;
  session_id: string | null;
  stats: RcaRunStats | null;
  /** Current stage of the seven-stage protocol (02 TH18). */
  stage?: string | null;
  /** 1-based index of `stage`. */
  stage_index?: number | null;
  /** What the run was given as leads (02 TH38): past causes, skills, AI toolsets. */
  context_used?: RcaContextUsed | null;
  /** Continuation turns the run used. */
  continuations?: number;
  report_format: RcaReportFormat;
}

/** `rca_runs.context_used`: the leads the run started with, not evidence. */
export interface RcaContextUsed {
  past_causes?: { id: string; summary: string }[];
  skills?: string[];
  toolsets?: string[];
  /** A resumed run (J8): the source run, the steps it reused and the step it redid first. */
  resumed_from?: {
    run_id: string;
    steps: number;
    from_step: { index: number; stage: string; title: string };
  };
}

/** Whether a run's transcript can be read (02 §7.3). */
export type RcaTranscriptState = "available" | "expired" | "none";

export type RcaToolCallStatus = "ok" | "error" | "running";

/** One tool call of a thread step. Times are microseconds since epoch. */
export interface RcaToolCall {
  call_id: string;
  tool: string;
  key_arg: string | null;
  status: RcaToolCallStatus;
  started_at: number | null;
  interrupted?: boolean;
  duration_ms: number | null;
  result_summary: string | null;
  error: string | null;
  /** Present only with the org setting `ai_rca_thread_tool_output` (02 TH34). */
  input?: unknown;
  /** Present only with the org setting `ai_rca_thread_tool_output` (02 TH34). */
  output?: string | null;
}

/** One step the agent recorded with `record_step` (02 TH29). */
export interface RcaStep {
  index: number;
  stage: string | null;
  title: string;
  started_at: number | null;
  /** Null while the step runs. */
  ended_at: number | null;
  note: string | null;
  note_truncated: boolean;
  /** Evidence ids cited in the note, e.g. "e3". */
  citations: string[];
  from_steering?: boolean;
  tool_calls: RcaToolCall[];
}

export interface RcaThreadStats {
  steps: number;
  tool_calls: number;
  duration_ms: number;
  tokens?: { input: number; output: number; reasoning: number; cache_read: number };
}

/** A responder message the thread decoded from the transcript (04 §10.6); text without the header lines. */
export interface RcaThreadUserMessage {
  /** Microseconds since epoch. */
  at: number | null;
  text: string;
  steer_id?: string | null;
  author?: string | null;
  kind?: RcaSteerKind | null;
  question_id?: string | null;
  read_at?: number | null;
}

/** An `ask_responders` call of the run: a "Needs input" entry (04 SG25). */
export interface RcaThreadQuestion {
  /** The tool call's `callID`. */
  question_id: string;
  question: string;
  need: string;
  hypothesis_id?: string | null;
  /** Microseconds since epoch; null when the transcript has no time for it. */
  at: number | null;
  /** Email of the first answer's author. */
  answered_by?: string | null;
  answered_at?: number | null;
}

/** `GET …/rca/runs/{run_id}/thread` (02 TH29–TH31). */
export interface RcaThread {
  run_id: string;
  state_version: string;
  not_modified: false;
  active: boolean;
  transcript: RcaTranscriptState;
  started: { at: number | null; prompt: string } | null;
  steps: RcaStep[];
  user_messages: RcaThreadUserMessage[];
  questions: RcaThreadQuestion[];
  report_submitted: boolean;
  stats: RcaThreadStats;
}

export type RcaSteerKind = "message" | "answer" | "hypothesis_action" | "guidance";

/** Status of a steering row (04 §8.2). */
export type RcaSteerStatus =
  "queued" | "delivered" | "read" | "applied" | "declined" | "not_read" | "rejected";

export type RcaSteerAction = "disprove" | "reopen" | "test_first";

export type RcaSteerStatusReason =
  | "finalizing"
  | "no_active_turn"
  | "agent_unreachable"
  | "run_completed"
  | "run_cancelled"
  | "run_failed";

/** One `rca_steering` row with the transcript state merged in (04 §8.1, SG22). Times are µs. */
export interface RcaSteerRecord {
  org_id: string;
  steer_id: string;
  run_id: string;
  incident_id: string;
  author_email: string;
  kind: RcaSteerKind;
  action?: RcaSteerAction | null;
  hypothesis_id?: string | null;
  question_id?: string | null;
  text: string;
  status: RcaSteerStatus;
  status_reason?: RcaSteerStatusReason | null;
  created_at: number;
  delivered_at?: number | null;
  read_at?: number | null;
  acted_at?: number | null;
  agent_note?: string | null;
  opencode_message_id?: string | null;
}

/** The question a paused run waits on (04 §9.2). */
export interface RcaOpenQuestion {
  question_id: string;
  question: string;
  need: string;
  hypothesis_id?: string | null;
  /** Answer deadline, microseconds since epoch. */
  deadline_at: number | null;
}

/** `GET …/rca/runs/{run_id}/steering` (04 §9.2, SG22, SG37). */
export interface RcaSteering {
  items: RcaSteerRecord[];
  open_question: RcaOpenQuestion | null;
  /** The run takes messages and the user may send them (SG37). */
  can_steer: boolean;
}

/** Body of `POST …/rca/runs/{run_id}/steer` (04 §9.1). */
export interface RcaSteerRequest {
  text: string;
  kind: "message" | "hypothesis_action";
  action?: RcaSteerAction;
  hypothesis_id?: string;
}

export interface RcaSteerResponse {
  steer: RcaSteerRecord;
  run_state: RcaRunState;
}

/** Why the outcome was derived (03 VE14). */
export type RcaOutcomeReason =
  | "answer_deadline"
  | "root_cause_graded"
  | "ambiguous_cause"
  | "leading_blocked"
  | "contributing_graded"
  | "cause_below_medium"
  | "no_hypothesis"
  | "no_confirmed_cause";

export type RcaHypothesisStatus =
  | "testing"
  | "untested"
  | "likely"
  | "root_cause"
  | "contributing"
  | "symptom"
  | "ruled_out"
  | "inconclusive"
  | "blocked";

/** Signal class of a tool call (CG §5.3.2). */
export type RcaSignalClass =
  "logs" | "metrics" | "traces" | "change" | "infra" | "context" | "unclassified";

export type RcaPolarity = "supports" | "contradicts" | "rules_out";
export type RcaStrength = "decisive" | "supporting";

/** Timeline status after the evidence check (03 VE31). */
export type RcaTimelineStatus = "confirmed" | "refuted" | "likely" | "unverified";

export type RcaBlindSpotAxis = "change" | "logs" | "metrics" | "traces" | "infra" | "other";
export type RcaBlindSpotFix =
  "connect_toolset" | "ingest_data" | "open_pipeline" | "sampling_rules" | "resume_run" | "none";

export type RcaChangeKind = "deploy" | "commit" | "config_change" | "feature_flag" | "infra";

/** Code-derived state of the suspect change (03 VE35). */
export type RcaSuspectShownState = "confirmed" | "under_test" | "not_read";

export interface RcaLeadingEntry {
  id: string;
  statement: string;
}

/** Live card label (03 VE21). */
export interface RcaVerdictSoFar {
  label: "preliminary" | "revised";
  was?: string;
}

export interface RcaSummarySuspectChange {
  kind: RcaChangeKind;
  reference: string;
  author?: string;
  /** Microseconds since epoch. */
  occurred_at: number;
  shown_state: RcaSuspectShownState;
  /** Author of the steering lead behind the subject hypothesis (VE35 "(from <author>)"). */
  lead_author?: string;
}

export interface RcaImpact {
  summary: string;
  peak?: string;
  /** Microseconds since epoch. */
  window?: { start: number; end: number };
}

/** The verdict card of a summary; the server omits each field it has no value for. */
export interface RcaSummaryCard {
  outcome?: RcaOutcome;
  outcome_reason?: RcaOutcomeReason;
  headline?: string;
  leading?: RcaLeadingEntry;
  verdict_so_far?: RcaVerdictSoFar;
  band?: RcaBand;
  /** Server-built reason line (CG §5.3.4). */
  band_reason?: string;
  suspect_change?: RcaSummarySuspectChange;
  impact?: RcaImpact;
  needs?: string;
}

export interface RcaSummaryTimelineEntry {
  /** Microseconds since epoch. */
  at: number;
  text: string;
  status: RcaTimelineStatus;
  evidence_numbers: number[];
}

export interface RcaSummaryStatusChange {
  /** Microseconds since epoch. */
  at: number;
  status: RcaHypothesisStatus;
  run_ended?: boolean;
  /** Author of the steering message that caused the change, if any. */
  steered_by?: string;
}

export interface RcaSummaryHypothesis {
  id: string;
  statement: string;
  status: RcaHypothesisStatus;
  reason: string;
  evidence_numbers: number[];
  unverified_ids: string[];
  lead_ids: string[];
  first_seen_seq: number;
  history: RcaSummaryStatusChange[];
}

/** Where an evidence entry's query ran (03 VE26); the UI builds the link (VE29). */
export interface RcaEvidenceTarget {
  signal: RcaSignalClass;
  streams: string[];
  sql?: string;
  promql?: string;
  filter?: string;
  /** Shell or CLI command of change and infra evidence; never linked (VE29). */
  command?: string;
  /** Microseconds since epoch. */
  start_us?: number;
  end_us?: number;
}

export interface RcaCitation {
  hypothesis_id: string;
  evidence_id: string;
  polarity: RcaPolarity;
  strength: RcaStrength;
  observation: string;
}

export interface RcaEvidenceEntry {
  number: number;
  ids: string[];
  call_id: string;
  kind: string;
  target: RcaSignalClass;
  link: RcaEvidenceTarget;
  result_summary: string;
  duration_ms: number;
  decisive: boolean;
  citations: RcaCitation[];
}

export interface RcaUnverifiedCitation {
  hypothesis_id: string;
  evidence_id: string;
  tool: string;
  query: string;
  reason: "not_run" | "failed";
}

export interface RcaBlindSpot {
  id: string;
  axis: RcaBlindSpotAxis;
  title: string;
  why: string;
  fix: RcaBlindSpotFix;
}

/** `GET …/rca/runs/{run_id}/summary` (03 §12). */
export interface RcaRunSummary {
  run_id: string;
  state: RcaRunState;
  state_version: string;
  not_modified: false;
  /** A finished run with no stored record (03 VE42). */
  legacy: boolean;
  card: RcaSummaryCard;
  timeline: RcaSummaryTimelineEntry[];
  hypotheses: RcaSummaryHypothesis[];
  evidence: RcaEvidenceEntry[];
  unverified: RcaUnverifiedCitation[];
  blind_spots: RcaBlindSpot[];
}

/** The `data` of an `error` event of the live stream (05 LU5). */
export interface RcaLiveError {
  /** `transcript` covers the thread and the summary. */
  part: "transcript" | "steering" | "rca";
  /** The status the part's GET route answers with for the same fault. */
  status: number;
  error_code: string | null;
  message: string;
}

/** One event of `GET …/rca/live_stream`; each part is a full snapshot (05 LU5). */
export type RcaLiveEvent =
  | { event: "rca"; data: RcaSummary | null }
  | { event: "thread"; data: RcaThread }
  | { event: "summary"; data: RcaRunSummary }
  | { event: "steering"; data: RcaSteering }
  | { event: "error"; data: RcaLiveError }
  | { event: "end"; data: { state: RcaRunState | null } };

/** The live stream did not open: `status` is the server's answer (05 LU16). */
export class RcaLiveStreamRefused extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`The live stream was refused with status ${status}`);
    this.name = "RcaLiveStreamRefused";
    this.status = status;
  }
}

export interface ListRcaRunsResponse {
  runs: RcaRunItem[];
  has_more: boolean;
}

/** POST …/rca: 202 `{message, run_id}` (02 TH13). */
export interface TriggerRcaResponse {
  message: string;
  run_id: string;
}

/** DELETE …/rca (02 TH41). */
export interface CancelRcaResponse {
  run_id: string;
  cancelled: boolean;
}

/** A responder's verdict on a finished run (README §9). */
export type RcaFeedbackVerdict = "yes" | "no" | "change";

/** Why a run is not the cause (`no` only). */
export type RcaFeedbackReason =
  "wrong_service" | "symptom_not_cause" | "evidence_does_not_hold" | "missed_change";

/** One `rca_feedback` row: one per run and author. Times are microseconds. */
export interface RcaFeedback {
  run_id: string;
  author_email: string;
  incident_id: string | null;
  subject_type: RcaRunSubjectType;
  subject_id: string;
  verdict: RcaFeedbackVerdict;
  cause: ResolutionCause | null;
  note: string | null;
  reasons: RcaFeedbackReason[];
  created_at: number;
  updated_at: number;
}

/** Body of `PUT …/rca/runs/{run_id}/feedback`. */
export interface PutRcaFeedbackRequest {
  verdict: RcaFeedbackVerdict;
  cause?: ResolutionCause;
  note?: string;
  reasons?: RcaFeedbackReason[];
}

/** `GET …/rca/runs/{run_id}/feedback`: every author's row and the caller's own. */
export interface ListRcaFeedbackResponse {
  items: RcaFeedback[];
  mine: RcaFeedback | null;
}

/** `POST …/rca/runs/{run_id}/resume`: 202 (J7). */
export interface ResumeRcaResponse {
  message: string;
  run_id: string;
  resumed_from: string;
  reused_steps: number;
  from_step: { index: number; stage: string; title: string };
}

export interface IncidentTopology {
  nodes: AlertNode[];
  edges: AlertEdge[];
  related_incident_ids: string[];
}

export interface AlertNode {
  alert_id: string;
  alert_name: string;
  service_name: string;
  alert_count: number;
  first_fired_at: number;
  last_fired_at: number;
}

export interface AlertEdge {
  from_node_index: number;
  to_node_index: number;
  edge_type: "temporal" | "service_dependency";
}

export interface IncidentAlert {
  incident_id: string;
  alert_id: string;
  alert_name: string;
  alert_kind?: "internal" | "external";
  alert_fired_at: number;
  correlation_reason: "service_discovery" | "primary_match" | "secondary_match" | "alert_id";
  created_at: number;
  source_url?: string | null;
  labels?: Record<string, string> | null;
  detected_source?: string | null;
}

export interface CompositeAlertSummary {
  id: string;
  name: string;
  alert_type: "composite";
  enabled: boolean;
  folder_id: string;
}

export interface IncidentWithAlerts extends Incident {
  alerts: IncidentAlert[];
  triggers: IncidentAlert[];
  composite_alerts?: CompositeAlertSummary[];
}

export interface ExternalAlertPayload {
  id: string;
  detected_source: string;
  source_url: string | null;
  first_seen_at: number;
  last_seen_at: number;
  last_payload: unknown;
}

export interface UpdateSeverityResponse extends Incident {
  analysis_in_flight: boolean;
}

export interface ListIncidentsResponse {
  incidents: Incident[];
  total: number;
}

export interface IncidentStats {
  total_incidents: number;
  open_incidents: number;
  acknowledged_incidents: number;
  resolved_incidents: number;
  by_severity: Record<string, number>;
  by_service: Record<string, number>;
  mttr_minutes?: number;
  alerts_per_incident_avg: number;
}

// Telemetry correlation types
export interface IncidentCorrelatedStreams {
  serviceName: string;
  matchedDimensions: Record<string, string>;
  additionalDimensions: Record<string, string>;
  logStreams: StreamInfo[];
  metricStreams: StreamInfo[];
  traceStreams: StreamInfo[];
  correlationData: CorrelationResponse | null;
}

const LIVE_EVENTS: Record<RcaLiveEvent["event"], true> = {
  rca: true,
  thread: true,
  summary: true,
  steering: true,
  error: true,
  end: true,
};

/** One `event:`/`data:` frame of the live stream; null for a heartbeat or an unknown event. */
const parseLiveFrame = (frame: string): RcaLiveEvent | null => {
  let name = "";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }
  if (!Object.hasOwn(LIVE_EVENTS, name) || data.length === 0) return null;
  try {
    return { event: name, data: JSON.parse(data.join("\n")) } as RcaLiveEvent;
  } catch {
    return null;
  }
};

const incidents = {
  /**
   * List incidents with optional filtering and pagination
   */
  list: (
    org_identifier: string,
    status?: string,
    limit: number = 50,
    offset: number = 0,
    keyword?: string,
  ) => {
    let url = `/api/v2/${org_identifier}/alerts/incidents?limit=${limit}&offset=${offset}`;
    if (status) {
      url += `&status=${status}`;
    }
    if (keyword) {
      url += `&keyword=${encodeURIComponent(keyword)}`;
    }
    return http().get<ListIncidentsResponse>(url);
  },

  /**
   * Get incident details with all correlated alerts
   */
  get: (org_identifier: string, incident_id: string) => {
    return http().get<IncidentWithAlerts>(
      `/api/v2/${org_identifier}/alerts/incidents/${incident_id}`,
    );
  },

  /**
   * Get the raw webhook payload originally received for an external alert
   */
  getExternalAlertPayload: (org_identifier: string, external_alert_id: string) => {
    return http().get<ExternalAlertPayload>(
      `/api/v2/${org_identifier}/alerts/incidents/external-alerts/${external_alert_id}/payload`,
    );
  },

  /**
   * Update incident status (open, acknowledged, resolved)
   */
  updateStatus: (
    org_identifier: string,
    incident_id: string,
    status: "open" | "acknowledged" | "resolved",
  ) => {
    return http()
      .patch<Incident>(`/api/v2/${org_identifier}/alerts/incidents/${incident_id}/update`, {
        status,
      })
      .then((res) => {
        analytics.track("incident_status_updated", { status });
        return res;
      });
  },

  /**
   * Update incident details (title, severity, etc.)
   */
  updateIncident: (
    org_identifier: string,
    incident_id: string,
    updates: { title?: string; severity?: string },
  ) => {
    return http()
      .patch<Incident | UpdateSeverityResponse>(
        `/api/v2/${org_identifier}/alerts/incidents/${incident_id}/update`,
        updates,
      )
      .then((res) => {
        analytics.track("incident_updated", {
          severity_changed: updates.severity !== undefined,
          title_changed: updates.title !== undefined,
        });
        return res;
      });
  },

  /**
   * Get incident statistics
   */
  getStats: (org_identifier: string) => {
    return http().get<IncidentStats>(`/api/v2/${org_identifier}/alerts/incidents/stats`);
  },

  /**
   * Start an RCA run; the run itself runs in the background (202). `guidance`
   * goes in the JSON body and becomes the run's first message (04 SG33).
   */
  triggerRca: (
    org_identifier: string,
    incident_id: string,
    params: { build_on_previous?: boolean; guidance?: string } = {},
    config: { signal?: AbortSignal } = {},
  ) => {
    const { guidance, ...query } = params;
    return http()
      .post<TriggerRcaResponse>(
        `/api/v2/${org_identifier}/alerts/incidents/${incident_id}/rca`,
        guidance ? { guidance } : null,
        { params: query, signal: config.signal },
      )
      .then((res) => {
        analytics.track("incident_rca_requested", {
          build_on_previous: params.build_on_previous === true,
        });
        return res;
      });
  },

  /**
   * List the RCA runs of an incident, newest first. `before` is a run id for paging.
   */
  listRcaRuns: (
    org_identifier: string,
    incident_id: string,
    params: { limit?: number; before?: string } = {},
  ) => {
    return http().get<ListRcaRunsResponse>(
      `/api/v2/${org_identifier}/alerts/incidents/${incident_id}/rca/runs`,
      { params },
    );
  },

  /**
   * Get one RCA run of an incident, including its report.
   */
  getRcaRun: (org_identifier: string, incident_id: string, run_id: string) => {
    return http().get<RcaRun>(
      `/api/v2/${org_identifier}/alerts/incidents/${incident_id}/rca/runs/${run_id}`,
    );
  },

  /** Stream the incident's analysis (05 LU1) into `onEvent`; rejects with RcaLiveStreamRefused if refused. */
  openRcaLiveStream: async (
    org_identifier: string,
    incident_id: string,
    run_id: string | null,
    options: { onEvent: (event: RcaLiveEvent) => void; signal?: AbortSignal },
  ): Promise<{ ended: boolean }> => {
    const query = run_id ? `?run_id=${encodeURIComponent(run_id)}` : "";
    const url = `${store.state.API_ENDPOINT}/api/v2/${org_identifier}/alerts/incidents/${incident_id}/rca/live_stream${query}`;
    const init: RequestInit = {
      method: "GET",
      credentials: "include",
      headers: { Accept: "text/event-stream" },
      signal: options.signal,
    };
    // The axios interceptor never sees a fetch: refresh the token here, once.
    let response = await fetch(url, init);
    if (response.status === 401) {
      await attemptTokenRefresh(url);
      response = await fetch(url, init);
    }
    const reader = response.ok ? response.body?.getReader() : undefined;
    if (!reader) throw new RcaLiveStreamRefused(response.status);

    const decoder = new TextDecoder();
    let buffer = "";
    let ended = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) return { ended };
      buffer += decoder.decode(value, { stream: true });
      // Events end with a blank line; a partial tail stays buffered.
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const event = parseLiveFrame(frame);
        if (!event) continue;
        if (event.event === "end") ended = true;
        options.onEvent(event);
      }
    }
  },

  /**
   * Cancel the live RCA run of an incident through its session (02 TH41).
   */
  cancelRca: (org_identifier: string, incident_id: string) => {
    return http().delete<CancelRcaResponse>(
      `/api/v2/${org_identifier}/alerts/incidents/${incident_id}/rca`,
    );
  },

  /**
   * Send a steering message or a hypothesis action to a live run (04 §9.1).
   * A 201 can carry a `rejected` row.
   */
  steerRca: (
    org_identifier: string,
    incident_id: string,
    run_id: string,
    body: RcaSteerRequest,
  ) => {
    return http().post<RcaSteerResponse>(
      `/api/v2/${org_identifier}/alerts/incidents/${incident_id}/rca/runs/${run_id}/steer`,
      body,
    );
  },

  /** Read the feedback rows of one run; `mine` is the caller's (README §9). */
  getRcaFeedback: (org_identifier: string, incident_id: string, run_id: string) => {
    return http().get<ListRcaFeedbackResponse>(
      `/api/v2/${org_identifier}/alerts/incidents/${incident_id}/rca/runs/${run_id}/feedback`,
    );
  },

  /** Save the caller's feedback on a finished run; the latest write wins. */
  putRcaFeedback: (
    org_identifier: string,
    incident_id: string,
    run_id: string,
    body: PutRcaFeedbackRequest,
  ) => {
    return http().put<RcaFeedback>(
      `/api/v2/${org_identifier}/alerts/incidents/${incident_id}/rca/runs/${run_id}/feedback`,
      body,
    );
  },

  /** Undo: delete the caller's own feedback row (204). */
  deleteRcaFeedback: (org_identifier: string, incident_id: string, run_id: string) => {
    return http().delete(
      `/api/v2/${org_identifier}/alerts/incidents/${incident_id}/rca/runs/${run_id}/feedback`,
    );
  },

  /**
   * Resume a failed or cancelled run from its last finished step (J7): a new
   * run that reuses the finished steps (202).
   */
  resumeRca: (
    org_identifier: string,
    incident_id: string,
    run_id: string,
    config: { signal?: AbortSignal } = {},
  ) => {
    return http().post<ResumeRcaResponse>(
      `/api/v2/${org_identifier}/alerts/incidents/${incident_id}/rca/runs/${run_id}/resume`,
      null,
      { signal: config.signal },
    );
  },

  /**
   * Get correlated telemetry streams for an incident
   *
   * Uses the incident's group_values to find related logs, metrics, and traces
   * via the service correlation API. Filters dimensions to only include
   * fields that are actually used for disambiguation.
   *
   * @param org_identifier Organization ID
   * @param incident The incident with group_values
   * @param t Translator, threaded from the calling component — the only
   *   user-facing string here is the "unknown service" fallback name.
   * @returns Correlated streams grouped by type
   */
  getCorrelatedStreams: async (
    org_identifier: string,
    incident: Incident,
    t: TranslateFn,
  ): Promise<IncidentCorrelatedStreams> => {
    const allDimensions = incident.group_values ?? {};

    // Load identity config to filter dimensions (with caching)
    let filteredDimensions = allDimensions;
    try {
      const identityConfig = await loadIdentityConfig(org_identifier);

      // Filter dimensions to only include disambiguation fields
      filteredDimensions = filterDimensionsForCorrelation(allDimensions, identityConfig);
    } catch (err) {
      console.warn(
        "[incidents] Failed to load identity config for dimension filtering, using all dimensions:",
        err,
      );
    }

    const request: CorrelationRequest = {
      source_stream:
        // filteredDimensions only contains "service" key if present (not variations)
        filteredDimensions.service ||
        // Fallback to original dimensions for service name variations
        allDimensions.serviceName ||
        allDimensions["service.name"] ||
        allDimensions["service_name"] ||
        "default",
      source_type: "logs",
      available_dimensions: filteredDimensions,
    };

    const response = await serviceStreamsApi.correlate(org_identifier, request);
    const correlationData = response.data;

    // Handle null response when no service is found
    if (!correlationData) {
      return {
        serviceName: t("traces.unknownService"),
        matchedDimensions: {},
        additionalDimensions: allDimensions,
        logStreams: [],
        metricStreams: [],
        traceStreams: [],
        correlationData: null,
      };
    }

    return {
      serviceName: correlationData.service_name,
      matchedDimensions: correlationData.matched_dimensions || {},
      additionalDimensions: correlationData.additional_dimensions || {},
      logStreams: correlationData.related_streams.logs || [],
      metricStreams: correlationData.related_streams.metrics || [],
      traceStreams: correlationData.related_streams.traces || [],
      correlationData,
    };
  },

  /**
   * Get event timeline for an incident
   */
  getEvents: (org_identifier: string, incident_id: string) => {
    return http().get(`/api/v2/${org_identifier}/alerts/incidents/${incident_id}/events`);
  },

  /**
   * Post a comment on an incident
   */
  postComment: (org_identifier: string, incident_id: string, comment: string) => {
    return http()
      .post(`/api/v2/${org_identifier}/alerts/incidents/${incident_id}/events/comment`, {
        comment,
      })
      .then((res) => {
        analytics.track("incident_comment_added");
        return res;
      });
  },

  /**
   * Clear identity config cache for a specific organization
   * Call this when identity config settings are updated
   */
  clearIdentityConfigCache,

  /**
   * Clear all identity config caches
   * Use when switching organizations or on logout
   */
  clearAllIdentityConfigCaches: clearAllIdentityConfigCache,
};

export default incidents;
