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

import { raw, type I18nKey, I18nText } from "@/types/i18n";

// Fields available to a workflow Condition. A workflow has no upstream stream
// node (unlike a pipeline), so conditions branch on the fired-alert payload.
// The backend flattens the `{ meta: {...} }` envelope, so the alert fields are
// exposed to conditions as `meta_<field>` (e.g. `meta.alert_name` → the column
// `meta_alert_name`) — confirmed with the backend. The Condition form passes
// these to FilterGroup as suggestions with `allow-custom-columns`, so users can
// still type any other flattened field the payload carries (e.g. a `data[]` row
// column).

export interface WorkflowFieldOption {
  label: I18nText;
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
  descKey: I18nKey;
  /** For enum fields — the literal values, rendered like `"a" | "b"`. */
  enumValues?: string[];
}

// The emitted `meta` block is a MIXED-type map: text fields are strings, but the
// numeric alert fields (period, threshold, count) and the microsecond-epoch
// timestamps (start/end time) are real numbers — the backend now types them
// (e.g. `"alert_count": 3`, `"alert_start_time": 1785493175167770`). Types below
// match that payload so a Condition author reads the right type. Confirmed
// against a live alert firing.
export const TRIGGER_META_VARS: TriggerOutputVar[] = [
  { ref: "meta.org_id", type: "string", descKey: "workflow.triggerMeta.orgId" },
  { ref: "meta.stream_type", type: "string", descKey: "workflow.triggerMeta.streamType" },
  { ref: "meta.stream_name", type: "string", descKey: "workflow.triggerMeta.streamName" },
  { ref: "meta.alert_name", type: "string", descKey: "workflow.triggerMeta.alertName" },
  {
    ref: "meta.alert_type",
    type: "string",
    descKey: "workflow.triggerMeta.alertType",
    enumValues: ["realtime", "scheduled"],
  },
  { ref: "meta.alert_period", type: "int", descKey: "workflow.triggerMeta.alertPeriod" },
  { ref: "meta.alert_operator", type: "string", descKey: "workflow.triggerMeta.alertOperator" },
  { ref: "meta.alert_threshold", type: "int", descKey: "workflow.triggerMeta.alertThreshold" },
  { ref: "meta.alert_count", type: "int", descKey: "workflow.triggerMeta.alertCount" },
  { ref: "meta.alert_start_time", type: "int", descKey: "workflow.triggerMeta.alertStartTime" },
  { ref: "meta.alert_end_time", type: "int", descKey: "workflow.triggerMeta.alertEndTime" },
];

// All fields are `Utf8` for now — the flattened `meta` block is a string:string
// map at this stage, so even numeric-looking fields (threshold/count/period,
// timestamps) are exposed as strings. Revisit once the backend types the columns.
export const ALERT_PAYLOAD_FIELDS: WorkflowFieldOption[] = [
  { label: raw("meta.alert_name"), value: "meta_alert_name", type: "Utf8" },
  { label: raw("meta.alert_type"), value: "meta_alert_type", type: "Utf8" },
  { label: raw("meta.alert_operator"), value: "meta_alert_operator", type: "Utf8" },
  { label: raw("meta.alert_threshold"), value: "meta_alert_threshold", type: "Utf8" },
  { label: raw("meta.alert_count"), value: "meta_alert_count", type: "Utf8" },
  { label: raw("meta.alert_period"), value: "meta_alert_period", type: "Utf8" },
  { label: raw("meta.stream_name"), value: "meta_stream_name", type: "Utf8" },
  { label: raw("meta.stream_type"), value: "meta_stream_type", type: "Utf8" },
  { label: raw("meta.org_id"), value: "meta_org_id", type: "Utf8" },
  { label: raw("meta.alert_start_time"), value: "meta_alert_start_time", type: "Utf8" },
  { label: raw("meta.alert_end_time"), value: "meta_alert_end_time", type: "Utf8" },
  { label: raw("meta.alert_trigger_time"), value: "meta_alert_trigger_time", type: "Utf8" },
  { label: raw("meta.alert_url"), value: "meta_alert_url", type: "Utf8" },
];
