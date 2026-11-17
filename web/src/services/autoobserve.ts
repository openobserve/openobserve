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

import http from "./http";
import type { Incident, RcaOutcome, RcaRunState, RcaSummaryFields } from "./incidents";

export type AutoObserveClass =
  "errors" | "latency" | "saturation" | "absence" | "external_probe" | "workload_health" | "node";

export type AutoObserveCellState = "covered" | "weak" | "silent" | "blind" | "unmapped" | "none";

export type AutoObserveCoverageView = "strict" | "weak";

export type AutoObserveSuggestionKind =
  | "coverage_gap"
  | "no_absence_check"
  | "silent_coverage"
  | "coverage_lost"
  | "blind_guardrail"
  | "discovery_unusable"
  | "alert_not_working"
  | "alert_no_destination"
  | "alert_notify_failed";

export interface AutoObserveEvidence {
  monitor_kind: string;
  monitor_id: string;
  monitor_name: string;
  predicate: string;
  last_data_at: number | null;
}

export interface AutoObserveStatedEvidence extends AutoObserveEvidence {
  state: AutoObserveCellState;
}

export interface AutoObserveCell {
  state: AutoObserveCellState;
  evidence: AutoObserveEvidence[];
  counts: Partial<Record<AutoObserveCellState, number>>;
  // Every matching monitor with the state it alone would give, so a losing blind one stays visible.
  all_evidence?: AutoObserveStatedEvidence[];
}

export interface AutoObserveCoverageRow {
  service_id: string;
  service_name: string;
  cluster: string | null;
  namespace: string | null;
  // learning_until is null or absent once the stream has enough history.
  streams: { type: string; name: string; learning_until?: number | null }[];
  traffic_per_hour: number | null;
  // The engine raises findings only for good services while discovery is partial.
  good?: boolean;
  cells: Partial<Record<AutoObserveClass, AutoObserveCell>>;
}

export interface AutoObserveQuality {
  good: number;
  active: number;
  score: number;
  mode: "full" | "partial" | "unusable";
  stale_since: number | null;
}

// Streams still gathering history; next_ready_at is when the first one is ready, in microseconds.
export interface AutoObserveLearning {
  streams_learning: number;
  streams_ready: number;
  history_days_needed: number;
  next_ready_at: number | null;
}

// pass_at, refreshed_at and quality are null when the engine wrote no pass in the last day.
export interface AutoObserveCoverage {
  view: AutoObserveCoverageView;
  pass_at: number | null;
  refreshed_at: number | null;
  quality: AutoObserveQuality | null;
  classes: AutoObserveClass[];
  rows: AutoObserveCoverageRow[];
  learning?: AutoObserveLearning;
}

export type AutoObserveTier = "A" | "B" | "C";

export type AutoObserveReviewFocus = "settings" | "threshold" | "query" | "grouping";

export interface AutoObserveReviewAlertAction {
  type: "review_alert";
  alert_id: string;
  focus?: AutoObserveReviewFocus;
}

export interface AutoObserveReviewSourceAction {
  type: "review_source";
  stream_type: string;
  stream_name: string;
}

export type AutoObserveInsightAction = AutoObserveReviewAlertAction | AutoObserveReviewSourceAction;

export interface AutoObserveInsightQuality {
  level: "unavailable" | "partial" | "usable";
  reasons: string[];
}

export interface AutoObserveSuggestion {
  id: string;
  org: string;
  analyzer: string;
  kind: AutoObserveSuggestionKind | string;
  subject: { kind: string; key_dims: Record<string, string> };
  evidence: Record<string, unknown>;
  score: number | null;
  confidence: string;
  status: string;
  decided_score: number | null;
  on_accept: unknown;
  last_seen_at?: number;
  // Rows written before the v2 insight fields have none of these.
  tier?: AutoObserveTier | null;
  limitations?: string[];
  advice?: string | null;
  actions?: AutoObserveInsightAction[];
  quality?: AutoObserveInsightQuality | null;
  // Sent only for an issue item while the server's issue context is on.
  context?: AutoObserveIssueContext;
}

export interface AutoObserveEntityRef {
  kind: string;
  key_dims: Record<string, string>;
}

// A page below the org, with its query; the path may or may not start with "/".
export interface AutoObserveDeepLink {
  path: string;
  query: Record<string, string>;
}

export type AutoObserveChecked =
  { kind: "ok" | "off" | "not_recorded" | "partial" } | { kind: "failed"; reason: string };

export type AutoObserveChangeKind =
  | "deploy"
  | "rollback"
  | "config_rollout"
  | "collector_offline"
  | "collector_export_errors"
  | "pipeline_failing"
  | "pipeline_changed"
  | "ingestion_refused"
  | "settings_changed"
  | "token_changed"
  | "alert_changed"
  | "stream_deleted";

export interface AutoObserveChangeRecord {
  provider: string;
  kind: AutoObserveChangeKind;
  at: number;
  until: number | null;
  actor: string | null;
  subject: AutoObserveEntityRef;
  subject_name: string;
  affects: AutoObserveEntityRef[];
  link: "exact" | "inferred" | "stream_wide" | "unmapped";
  // [n, of] for a counted condition such as 3 of 4 collectors.
  count: [number, number] | null;
  facts: Record<string, string>;
  needs: "security" | "subject" | null;
  open: AutoObserveDeepLink | null;
}

export interface AutoObserveImpactItem {
  dependent: AutoObserveEntityRef;
  name: string;
  attrs: Record<string, string>;
  open: AutoObserveDeepLink | null;
}

export interface AutoObserveImpactRecord {
  provider: string;
  kind: "detection" | "alert" | "slo" | "dashboard" | "service";
  effect: "blind" | "partial";
  subject: AutoObserveEntityRef;
  counts: Record<string, number>;
  items: AutoObserveImpactItem[];
  more: number;
  needs: "security" | "subject" | null;
  classes: string[];
  issue: string | null;
}

export interface AutoObserveCauseLine {
  id: string;
  record: AutoObserveChangeRecord;
  relates: "direct" | "related" | "org_wide";
  grade: "likely" | "possible";
  sentence: string;
  used: boolean;
}

export interface AutoObserveImpactLine {
  id: string;
  record: AutoObserveImpactRecord;
  // Empty when nothing depends on the subject.
  sentence: string;
  redacted: boolean;
  used: boolean;
}

export interface AutoObserveProviderCheck {
  label: string;
  state: AutoObserveChecked;
}

export type AutoObserveStepAction =
  { open: AutoObserveDeepLink } | { insight: AutoObserveInsightAction } | "check_only";

export interface AutoObserveNextStep {
  step_id: string;
  source: "engine" | "ai";
  action: AutoObserveStepAction;
  label: string;
  why: string;
  // Cause and impact line ids the step rests on.
  cites: string[];
  at: number;
  run_id: string | null;
}

export type AutoObserveStepState = "engine_only" | { working: { since: number } } | "ready";

export interface AutoObserveStepView {
  step: AutoObserveNextStep;
  state: AutoObserveStepState;
  // false once someone marked this step not helpful.
  judged: boolean | null;
  // The issue's decision id; sent back as the decide route's id, never shown.
  issue_id: string;
}

// window and asked_at are microseconds; asked_at is null until the first ask is stored.
export interface AutoObserveIssueContext {
  causes: { top: AutoObserveCauseLine[]; more: number };
  impact: AutoObserveImpactLine[];
  classes: string[];
  window: [number, number];
  asked_at: number | null;
  settled: boolean;
  checks: AutoObserveProviderCheck[];
  hidden: number;
  region_only: boolean;
  next_step: AutoObserveStepView | null;
}

export interface AutoObserveSuggestionParams {
  entity_type?: string;
  kind?: string;
  status?: string;
  subject?: string;
  sort?: "score" | "priority";
  limit?: number;
  offset?: number;
}

// total counts every match before paging.
export interface AutoObserveSuggestionList {
  suggestions: AutoObserveSuggestion[];
  total: number;
  limit: number;
  offset: number;
}

export type AutoObserveFindingKind = "stream_silence" | "stream_drop" | "stream_rise";

export type AutoObservePageOutcome = "paged" | "unrouted" | "failed" | "pending";

// Who a stopped stream paged; absent on a server that does not record it.
export interface AutoObservePage {
  outcome: AutoObservePageOutcome;
  team_id: string | null;
  team_name: string | null;
}

// One stream grouped into the same incident; the list is omitted when empty.
export interface AutoObserveIncidentMember {
  id: string;
  title: string;
  // Null once the org no longer has the stream.
  stream_type: string | null;
  stream_name: string | null;
  first_seen_at: number;
  recovered_at: number | null;
}

export interface AutoObserveIncidentItem {
  // kind and stream are null when the incident's group values are unreadable.
  finding: {
    id: string;
    kind: AutoObserveFindingKind | string | null;
    stream_type: string | null;
    stream_name: string | null;
    first_seen_at: number;
  };
  incident: {
    id: string;
    status: Incident["status"];
    severity: Incident["severity"];
    title: string;
    created_at: number;
  };
  investigation: {
    run_id: string | null;
    state: RcaRunState | null;
    outcome: RcaOutcome | null;
    summary: RcaSummaryFields | null;
    not_run_reason: string | null;
  };
  page?: AutoObservePage;
  members?: AutoObserveIncidentMember[];
  // Absent while the server's issue context is off.
  context?: AutoObserveIssueContext;
}

// available is false when the deployment turns paging off; the switch then cannot be turned on.
export interface AutoObservePagingSettings {
  page_on_stop: boolean;
  available: boolean;
}

// Items come newest first; there is no total, only has_more.
export interface AutoObserveIncidentList {
  paging: boolean;
  has_more: boolean;
  items: AutoObserveIncidentItem[];
}

const autoobserve = {
  coverage: (org: string, view: AutoObserveCoverageView) =>
    http().get<AutoObserveCoverage>(`/api/v2/${org}/autoobserve/coverage`, { params: { view } }),
  suggestions: (org: string, params: AutoObserveSuggestionParams) =>
    http().get<AutoObserveSuggestionList>(`/api/v2/${org}/autoobserve/suggestions`, { params }),
  incidents: (org: string, params: { limit: number; offset: number }) =>
    http().get<AutoObserveIncidentList>(`/api/v2/${org}/autoobserve/incidents`, { params }),
  pagingSettings: (org: string) =>
    http().get<AutoObservePagingSettings>(`/api/v2/${org}/autoobserve/settings/paging`, {
      silentForbidden: true,
    }),
  setPagingSettings: (org: string, body: { page_on_stop: boolean }) =>
    http().put<AutoObservePagingSettings>(`/api/v2/${org}/autoobserve/settings/paging`, body, {
      silentForbidden: true,
    }),
};

export default autoobserve;
