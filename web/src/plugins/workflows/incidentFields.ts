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

// Fields a workflow Condition can branch on when the trigger is an Incident
// Event. Like the alert fields, the backend flattens the `{ meta: {...} }`
// envelope, so each field is exposed to conditions as `meta_<field>`. The
// Condition form passes these to FilterGroup with `allow-custom-columns`, so a
// user can still type any field not listed here.
//
// An incident event's `meta` has two layers (see the incident lifecycle
// contract): COMMON fields present on every event, plus EVENT-SPECIFIC fields
// that only appear for certain `event_type`s. Both are offered as suggestions —
// filtering on an event-specific field naturally only matches its own events
// (e.g. `meta_new_severity` is set only on severity_upgrade/override).

import { raw } from "@/types/i18n";

import type { WorkflowFieldOption } from "./alertFields";

// Timestamps arrive as i64 epochs (real numbers, unlike the alert meta block
// which is stringified); scalar text fields are Utf8. Arrays (alert_names,
// alert_ids) aren't offered as filterable columns — a scalar comparison over an
// array is ill-defined — but remain typeable via allow-custom-columns.
export const INCIDENT_PAYLOAD_FIELDS: WorkflowFieldOption[] = [
  // ── Common — present on every lifecycle event ──
  { label: raw("meta.event_type"), value: "meta_event_type", type: "Utf8" },
  { label: raw("meta.incident_id"), value: "meta_incident_id", type: "Utf8" },
  { label: raw("meta.title"), value: "meta_title", type: "Utf8" },
  { label: raw("meta.status"), value: "meta_status", type: "Utf8" },
  { label: raw("meta.severity"), value: "meta_severity", type: "Utf8" },
  { label: raw("meta.org_id"), value: "meta_org_id", type: "Utf8" },
  { label: raw("meta.user_id"), value: "meta_user_id", type: "Utf8" },
  { label: raw("meta.created_at"), value: "meta_created_at", type: "Int64" },
  { label: raw("meta.updated_at"), value: "meta_updated_at", type: "Int64" },
  { label: raw("meta.first_alert_at"), value: "meta_first_alert_at", type: "Int64" },
  { label: raw("meta.last_alert_at"), value: "meta_last_alert_at", type: "Int64" },
  // ── Event-specific — set only for certain event_types ──
  { label: raw("meta.alert_name"), value: "meta_alert_name", type: "Utf8" }, // alert
  { label: raw("meta.alert_id"), value: "meta_alert_id", type: "Utf8" }, // alert
  { label: raw("meta.alert_count"), value: "meta_alert_count", type: "Int64" }, // alert
  { label: raw("meta.old_severity"), value: "meta_old_severity", type: "Utf8" }, // severity_*
  { label: raw("meta.new_severity"), value: "meta_new_severity", type: "Utf8" }, // severity_*
  { label: raw("meta.old_title"), value: "meta_old_title", type: "Utf8" }, // title_changed
  { label: raw("meta.new_title"), value: "meta_new_title", type: "Utf8" }, // title_changed
  { label: raw("meta.from_user"), value: "meta_from_user", type: "Utf8" }, // assignment_changed
  { label: raw("meta.to_user"), value: "meta_to_user", type: "Utf8" }, // assignment_changed
  { label: raw("meta.from_key"), value: "meta_from_key", type: "Utf8" }, // dimension_upgraded
  { label: raw("meta.to_key"), value: "meta_to_key", type: "Utf8" }, // dimension_upgraded
  { label: raw("meta.reason"), value: "meta_reason", type: "Utf8" }, // severity_upgrade/reopened/ai_failed
  { label: raw("meta.comment"), value: "meta_comment", type: "Utf8" }, // comment
  { label: raw("meta.analysis_trigger_type"), value: "meta_analysis_trigger_type", type: "Utf8" }, // ai_analysis_failed
  { label: raw("meta.error_details"), value: "meta_error_details", type: "Utf8" }, // ai_analysis_failed
];
