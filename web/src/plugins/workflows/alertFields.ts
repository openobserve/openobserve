/* Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

// Fields available to a workflow Condition. A workflow has no upstream stream
// node (unlike a pipeline), so conditions branch on the fired-alert payload.
// These mirror the canonical alert template variables
// (see composables/alerts/useTemplatePreview.ts). The Condition form passes
// them to FilterGroup as suggestions with `allow-custom-columns`, so users can
// still type any field the payload carries (e.g. a stream field or label).

export interface WorkflowFieldOption {
  label: string;
  value: string;
  type: string;
}

// Schema of the fixed `meta` block the Alert Trigger emits per firing, shown
// read-only on the trigger's drawer as a reference. Each entry carries a type
// and a human description (its meaning) — no example values, since a fired
// alert's real values only exist at runtime. These map 1:1 to the alert
// template variables the backend substitutes in `process_dest_template`
// (service/alerts/alert.rs). The dynamic `data[]` array isn't listed here: its
// columns come from the linked alert's query, so they're only known at runtime.
// Downstream steps reference these as `meta.*` (and row columns as `data[].*`).
export interface TriggerOutputVar {
  ref: string;
  type: string;
  /** i18n key for the field's description. */
  descKey: string;
  /** For enum fields — the literal values, rendered like `"a" | "b"`. */
  enumValues?: string[];
}

export const TRIGGER_META_VARS: TriggerOutputVar[] = [
  { ref: "meta.org_name", type: "string", descKey: "workflow.triggerMeta.orgName" },
  { ref: "meta.stream_type", type: "string", descKey: "workflow.triggerMeta.streamType" },
  { ref: "meta.stream_name", type: "string", descKey: "workflow.triggerMeta.streamName" },
  { ref: "meta.alert_name", type: "string", descKey: "workflow.triggerMeta.alertName" },
  {
    ref: "meta.alert_type",
    type: "string",
    descKey: "workflow.triggerMeta.alertType",
    enumValues: ["realtime", "scheduled"],
  },
  { ref: "meta.alert_period", type: "number", descKey: "workflow.triggerMeta.alertPeriod" },
  { ref: "meta.alert_operator", type: "string", descKey: "workflow.triggerMeta.alertOperator" },
  { ref: "meta.alert_threshold", type: "number", descKey: "workflow.triggerMeta.alertThreshold" },
  { ref: "meta.alert_count", type: "number", descKey: "workflow.triggerMeta.alertCount" },
  { ref: "meta.alert_start_time", type: "datetime", descKey: "workflow.triggerMeta.alertStartTime" },
  { ref: "meta.alert_end_time", type: "datetime", descKey: "workflow.triggerMeta.alertEndTime" },
];

export const ALERT_PAYLOAD_FIELDS: WorkflowFieldOption[] = [
  { label: "alert_name", value: "alert_name", type: "Utf8" },
  { label: "alert_type", value: "alert_type", type: "Utf8" },
  { label: "alert_operator", value: "alert_operator", type: "Utf8" },
  { label: "alert_threshold", value: "alert_threshold", type: "Int64" },
  { label: "alert_count", value: "alert_count", type: "Int64" },
  { label: "alert_period", value: "alert_period", type: "Int64" },
  { label: "stream_name", value: "stream_name", type: "Utf8" },
  { label: "stream_type", value: "stream_type", type: "Utf8" },
  { label: "org_name", value: "org_name", type: "Utf8" },
  { label: "alert_start_time", value: "alert_start_time", type: "Utf8" },
  { label: "alert_end_time", value: "alert_end_time", type: "Utf8" },
  { label: "alert_trigger_time", value: "alert_trigger_time", type: "Utf8" },
  { label: "alert_url", value: "alert_url", type: "Utf8" },
];
