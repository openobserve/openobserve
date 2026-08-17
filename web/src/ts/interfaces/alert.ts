// Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import type { I18nText } from "@/types/i18n";

export interface Condition {
  column: string;
  ignore_case: null | boolean;
  operator: string;
  value: string;
}

// Alert payload which is sent to backend
export interface Alert {
  id?: string;
  name: string;
  stream_name: string;
  stream_type: string;
  query_condition: {
    conditions: Array<Condition>;
    sql: string | null;
    promql: string | null;
    type: "sql" | "promql" | "custom";
  };
  destination: Array<string | Destination>;
  trigger_condition: {
    period: number;
    operator: "=" | ">" | "<" | ">=" | "<=" | "!=" | "Contains" | "NotContains";
    threshold: number;
    silence: number;
  };
  is_real_time: boolean;
  enabled: boolean;
  context_attributes: { [key: string]: string };
  description: I18nText;
  uuid?: string;
  deduplication?: {
    enabled: boolean;
    fingerprint_fields: string[];
    time_window_minutes?: number;
    grouping?: {
      enabled: boolean;
      max_group_size: number;
      send_strategy: "first_with_count" | "summary" | "all";
      group_wait_seconds: number;
    };
  };
  creates_incident?: boolean;
}

// Alert object which is modified in frontend to display in table and form
export interface AlertListItem {
  "#": number | string;
  name: string;
  stream_name: string;
  stream_type: string;
  enabled: boolean;
  alert_type: string;
  description: I18nText;
  uuid?: string;
}

// Template payload which is sent to backend
export interface Template {
  name: string;
  body: any;
  isDefault?: boolean;
  // True for system-managed prebuilt templates (name starts with
  // "prebuilt_"). Such templates are read-only — the UI must hide edit /
  // delete actions for them and the backend will refuse mutations.
  isPrebuilt?: boolean;
  type: "http" | "email";
  title?: I18nText;
  // Distinguishes a structured "content" template (built via the fields/links/
  // rows editor, body is a serialized ContentSpec JSON string) from a
  // "custom" raw-payload template (body is an arbitrary user string). Absent
  // on templates created before this field existed — treat as "custom".
  kind?: "content" | "custom";
}

// Template object which is modified in frontend to display in table and form
export interface TemplateData extends Template {
  "#"?: number | string;
}

// Destination payload which is sent to backend
export interface Headers {
  [key: string]: string;
}
export interface DestinationMetadata {
  // Splunk specific fields
  source?: string;
  sourcetype?: string;
  hostname?: string;
  // Elasticsearch specific fields
  _index?: string;
  // Datadog specific fields
  ddsource?: string;
  ddtags?: string;
  service?: string;
  // hostname is shared between Splunk and Datadog
}

export interface Destination {
  name: string;
  url?: string;
  url_endpoint?: string; // Frontend only - used for display/editing
  method?: string;
  skip_tls_verify?: boolean;
  headers?: Headers;
  template?: string | Template;
  emails?: string;
  type: "http" | "email" | "sns" | "action";
  action_id?: string;
  output_format?: "json" | "ndjson" | "nestedevent" | string | any; // string allows esbulk with dynamic index, any for stringseparated object
  destination_type?: string; // Frontend internal use
  destination_type_name?: string; // From backend
  esbulk_index?: string; // For esbulk format index name
  separator?: string; // For stringseparated format separator value
  metadata?: DestinationMetadata; // Destination-specific metadata as JSON object
}

export interface DestinationPayload {
  name: string;
  url?: string; // Full URL (merged with endpoint before sending)
  method?: string;
  skip_tls_verify?: boolean;
  headers?: Headers;
  template?: string; // Persisted/sent as the template name
  emails?: string[];
  type: "http" | "email" | "sns" | "action";
  action_id?: string;
  output_format?: "json" | "ndjson" | "nestedevent" | string | any; // string allows esbulk with dynamic index, any for stringseparated object
  destination_type?: string; // New field added
  separator?: string; // For stringseparated format separator value
  // Persisted on saved records (may arrive as a JSON string or parsed object);
  // used to restore prebuilt destination_type and credentials in edit mode.
  metadata?: string | DestinationMetadata;
}

// Destination object which is modified in frontend to display in table and form
export interface DestinationData extends Destination {
  "#"?: number | string;
}

/** One `key=value` pair of a multi-alert group's label set. */
export interface AlertGroupLabel {
  name: string;
  value: string;
}

/**
 * One tracked group of a multi-alert (alerts_2.md §5.4).
 *
 * `group_key` — not the rendered `group_labels` — is the identity: the labels
 * string is display-only and is ambiguous once a value contains a separator.
 */
export interface AlertGroup {
  group_key: string;
  group_labels?: string;
  labels?: AlertGroupLabel[];
  level?: string;
  level_since?: number;
  last_outcome?: string;
  last_outcome_at?: number;
  last_seen?: number;
  silenced_until?: number;
  last_notified_level?: string;
}

/**
 * Response of `GET /alerts/{id}/groups`.
 *
 * The counts are computed BEFORE the M-6 cap truncates, so they cannot be
 * re-derived from `list` — past the cap `list` is a truncated view. Each count
 * carries its own exactness marker because the two diverge: a full fetch page
 * that still reached healthy groups has seen every firing group, so
 * `groups_firing` stays exact while `groups_observed` does not.
 */
export interface AlertGroupsResponse {
  list: AlertGroup[];
  groups_observed?: number;
  groups_firing?: number;
  groups_observed_is_lower_bound?: boolean;
  groups_firing_is_lower_bound?: boolean;
  capped: boolean;
  group_cap: number;
}

/** One per-group level/outcome change (M-8's durable history source). */
export interface AlertGroupTransition {
  group_key: string;
  group_labels?: string;
  from_level?: string;
  to_level?: string;
  from_outcome?: string;
  to_outcome: string;
  at: number;
  /** Absent where nothing was observed — a vanished group has no reading, and
   *  rendering 0 would read as a real measurement. */
  value?: number;
}

export type StaleChildPolicy = "treat_as_false" | "treat_as_true" | "use_last_state";

export interface CompositeAlertCondition {
  expression: string;
  warning_counts_as_firing: boolean;
  stale_child_policy: StaleChildPolicy;
}

export interface CompositeAlertChildBase {
  alert_id: string;
  accessible: boolean;
}

export interface CompositeAlertReadableChild extends CompositeAlertChildBase {
  accessible: true;
  name: string;
  alert_type: string;
  folder_id: string;
  folder_name?: string;
  enabled: boolean;
  level?: string | null;
  last_outcome?: string | null;
  level_at?: number | null;
  effective_cadence_seconds?: number | null;
  stale_deadline?: number | null;
  stale?: boolean;
  stale_reason?: string;
  policy_decision?: string;
  truth?: boolean;
}

export interface CompositeAlertHiddenChild extends CompositeAlertChildBase {
  accessible: false;
}

export type CompositeAlertChild = CompositeAlertReadableChild | CompositeAlertHiddenChild;

export interface CompositeAlertEvaluation {
  result: boolean | null;
  level: string | null;
  evaluated_at: number | null;
}

export interface CompositeAlertDraft {
  id?: string;
  alert_type: "composite";
  name: string;
  description?: string;
  enabled: boolean;
  destinations: string[];
  template?: string;
  context_attributes?: Record<string, string> | Array<Record<string, unknown>>;
  trigger_condition: { silence: number };
  creates_incident?: boolean;
  workflows?: string[];
  priority?: number | null;
  tags?: string[];
  composite_condition: CompositeAlertCondition;
  children?: CompositeAlertChild[];
}

export interface CompositeAlertDetail extends Omit<CompositeAlertDraft, "destinations"> {
  id: string;
  destinations?: string[];
  scheduler_job_present: boolean;
  children: CompositeAlertChild[];
  evaluation?: CompositeAlertEvaluation | null;
  referenced_by_composite_count?: number;
}

export interface CompositeAlertListItem {
  alert_id: string;
  alert_type: "composite";
  name: string;
  enabled: boolean;
  condition: null;
  child_count: number;
  referenced_by_composite_count: number;
  expression_summary: string;
}

export interface CompositeAlertReference {
  alert_id: string;
  name: string;
  folder_id?: string;
}

export interface CompositeAlertReferenceResponse {
  references: CompositeAlertReference[];
  hidden_reference_count: number;
}

export interface CompositeAlertDiagnostic {
  code: string;
  message?: string;
  child_alert_id?: string;
}

export interface CompositeExpressionValidation {
  valid: boolean;
  used_child_ids: string[];
  unused_child_ids: string[];
  unknown_child_ids: string[];
}

export interface CompositeAlertValidationRequest {
  composite_condition: CompositeAlertCondition;
  composite_id?: string;
  folder_id?: string;
}

export interface CompositeAlertValidationResponse {
  valid: boolean;
  canonical_expression: string;
  children: CompositeAlertChild[];
  warnings: CompositeAlertDiagnostic[];
  errors: CompositeAlertDiagnostic[];
  result: boolean | null;
  result_level: string | null;
  stale_child_policy?: StaleChildPolicy;
  warning_counts_as_firing?: boolean;
}

/** One child-level change inside a composite status timeline window. */
export interface CompositeTimelineTransition {
  from_level?: string | null;
  to_level?: string | null;
  at: number;
}

/** A single status lane: one child (or the composite itself) over a window. */
export interface CompositeTimelineLane {
  alert_id: string;
  slot?: number | null;
  name?: string | null;
  accessible: boolean;
  current_level?: string | null;
  level_since?: number | null;
  transitions: CompositeTimelineTransition[];
}

/** Response of the composite status-timeline endpoint. */
export interface CompositeTimelineResponse {
  from: number;
  to: number;
  children: CompositeTimelineLane[];
  result: CompositeTimelineLane;
}
