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

// `POST /api/v2/{org_id}/alerts/evaluate` (B-1). Contract: o2-polish run
// alert-form-2026-11-18 consolidated/contracts.md. Every time is Unix microseconds.

/** The create payload (`CreateAlertRequestBody`), as `getAlertPayload` builds it. */
export interface EvaluateAlertBody {
  name?: string;
  stream_type: "logs" | "metrics" | "traces";
  stream_name: string;
  is_real_time: boolean;
  alert_type?: "scheduled" | "anomaly_detection" | "composite";
  query_condition: {
    type: "custom" | "sql" | "promql";
    conditions?: unknown;
    sql?: string | null;
    promql?: string | null;
    promql_condition?: { column: string; operator: string; value: unknown } | null;
    promql_warning_value?: number | null;
    promql_multi_alert?: boolean;
    promql_rule_mode?: boolean;
    aggregation?: {
      group_by?: string[] | null;
      function: string;
      having: { column: string; operator: string; value: unknown };
      warning_value?: number | null;
      multi_alert?: boolean;
    } | null;
    vrl_function?: string | null;
    search_event_type?: string | null;
    multi_time_range?: { offSet: string }[] | null;
  };
  trigger_condition: {
    period: number;
    operator: string;
    threshold: number;
    warning_threshold?: number | null;
    frequency: number;
    frequency_type?: "minutes" | "cron";
    cron?: string;
    silence: number;
    timezone?: string;
    align_time?: boolean;
  };
  pending_period_sec?: number;
  keep_firing_for?: number;
  suppress_repeats?: boolean;
  destinations?: string[];
  [field: string]: unknown;
}

/** Either explicit check times or a range; neither means every check of the last 24 hours. */
export type EvaluateAlertRequest = { alert: EvaluateAlertBody } & (
  | { times: number[]; start?: never; end?: never; step?: never }
  | { times?: never; start?: number; end?: number; step?: number }
);

export type EvaluateCheckState = "quiet" | "pending" | "firing";

export type EvaluateLevel = "warning" | "critical";

export type EvaluateNotFiredReason = "below_threshold" | "no_data" | "pending" | "error";

export type EvaluateHeldBy = "notify_at_most_every" | "suppress_repeats";

export interface EvaluateGroup {
  /** The trigger record's `group_label` form: "host=b,region=eu". */
  key: string;
  labels: Record<string, string>;
  value: number | null;
  threshold: number | null;
  fired: boolean;
  level: EvaluateLevel | null;
}

export interface EvaluateError {
  code: number;
  message: string;
}

export interface EvaluateCheck {
  time: number;
  window_start: number;
  window_end: number;
  state: EvaluateCheckState;
  fired: boolean;
  notified: boolean;
  held_by: EvaluateHeldBy | null;
  level: EvaluateLevel | null;
  value: number | null;
  /** The count hit the search cap, so `value` is "at least". */
  value_is_lower_bound: boolean;
  operator: string;
  threshold: number | null;
  warning_threshold: number | null;
  matched: number;
  /** Fired first, then by value descending; at most 100. */
  groups: EvaluateGroup[];
  groups_total: number;
  reason: EvaluateNotFiredReason | null;
  error: EvaluateError | null;
}

export interface EvaluateGroupFired {
  key: string;
  labels: Record<string, string>;
  checks: number;
}

export interface EvaluateSummary {
  checks: number;
  fired: number;
  pending: number;
  notifications: number;
  held: number;
  errors: number;
  notified_at: number[];
  first_fired_at: number | null;
  last_fired_at: number | null;
  groups_fired: EvaluateGroupFired[];
  groups_fired_total: number;
}

export interface EvaluateDiagnostics {
  /** PromQL only: each metric the query reads, with its series in the latest window. */
  metrics: { name: string; series: number }[];
}

export interface EvaluateAlertResponse {
  query_type: "custom" | "sql" | "promql";
  is_real_time: boolean;
  start: number;
  end: number;
  truncated: boolean;
  /** Ascending by time; the last one is "right now". */
  checks: EvaluateCheck[];
  summary: EvaluateSummary;
  diagnostics: EvaluateDiagnostics | null;
}
