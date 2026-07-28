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

// Sample payloads an Incident-Event trigger hands downstream steps, one per
// lifecycle event_type. Shape matches a real event (verified against live
// payloads): a one-element array of `{ meta, data }`, where `data` is always
// empty (incidents carry no query rows) and `meta` = COMMON fields (present on
// every event) + EVENT-SPECIFIC fields keyed by `event_type`.
//
// The trigger drawer lets the user preview each event_type via a dropdown, so
// they can see exactly which fields a "resolved" vs "severity_upgrade" (etc.)
// event carries. Values are illustrative; timestamps are i64 epochs and
// alert_names/alert_ids are arrays (incident meta keeps native types, unlike the
// stringified Alert-Trigger meta).

const SAMPLE_TS = 1784895060000000; // microsecond epoch, matches incident timestamps

// COMMON block — present on every lifecycle event.
const commonMeta = (eventType: string, status: string, severity: string) => ({
  org_id: "default",
  incident_id: "3Gwug6FUzL6ckQwqYnwYwL6kljc",
  event_type: eventType,
  title: "High Error Rate on checkout-service",
  status,
  severity,
  alert_names: ["High Error Rate", "5xx Spike"],
  alert_ids: ["3Gwu6RwL8UVofCfTCSsDeRaLS8e", "3Gx1p2Qk9ZbWtN4mLcR7yTvD0f"],
  first_alert_at: SAMPLE_TS,
  last_alert_at: SAMPLE_TS + 180000000,
  created_at: SAMPLE_TS,
  updated_at: SAMPLE_TS + 200000000,
  _timestamp: SAMPLE_TS + 200000000,
});

interface IncidentEventDef {
  /** The `event_type` value (also the condition/filter value users match on). */
  type: string;
  /** `status` this event leaves the incident in. */
  status: string;
  /** `severity` shown on the event (post-change where relevant). */
  severity: string;
  /** Fields that appear ONLY for this event_type. */
  extras: Record<string, unknown>;
}

// Ordered per the incident lifecycle contract. The first entry is the default
// sample (used where no specific event is chosen — e.g. the Function node seed).
export const INCIDENT_EVENTS: IncidentEventDef[] = [
  { type: "created", status: "open", severity: "P1", extras: {} },
  {
    type: "alert",
    status: "open",
    severity: "P1",
    extras: {
      alert_name: "High Error Rate",
      alert_id: "3Gwu6RwL8UVofCfTCSsDeRaLS8e",
      alert_count: 137,
    },
  },
  {
    type: "severity_upgrade",
    status: "open",
    severity: "P1",
    extras: {
      old_severity: "P2",
      new_severity: "P1",
      reason: "Error rate crossed the critical threshold",
    },
  },
  {
    type: "severity_override",
    status: "open",
    severity: "P1",
    extras: {
      old_severity: "P2",
      new_severity: "P1",
      user_id: "root@example.com",
    },
  },
  {
    type: "acknowledged",
    status: "acknowledged",
    severity: "P1",
    extras: { user_id: "root@example.com" },
  },
  {
    type: "resolved",
    status: "resolved",
    severity: "P1",
    extras: { user_id: "root@example.com" },
  },
  {
    type: "reopened",
    status: "open",
    severity: "P1",
    extras: {
      user_id: "root@example.com",
      reason: "Recurred after the latest deploy",
    },
  },
  {
    type: "dimension_upgraded",
    status: "open",
    severity: "P1",
    extras: {
      from_key: "service:checkout",
      to_key: "service:checkout,region:us-east-1",
    },
  },
  {
    type: "title_changed",
    status: "open",
    severity: "P1",
    extras: {
      old_title: "High Error Rate",
      new_title: "High Error Rate on checkout-service",
      user_id: "root@example.com",
    },
  },
  {
    type: "assignment_changed",
    status: "open",
    severity: "P1",
    extras: { from_user: "unassigned", to_user: "root@example.com" },
  },
  {
    type: "comment",
    status: "acknowledged",
    severity: "P1",
    extras: {
      user_id: "root@example.com",
      comment: "Investigating the upstream dependency.",
    },
  },
  { type: "ai_analysis_begin", status: "open", severity: "P1", extras: {} },
  { type: "ai_analysis_complete", status: "open", severity: "P1", extras: {} },
  {
    type: "ai_analysis_failed",
    status: "open",
    severity: "P1",
    extras: {
      reason: "model_error",
      analysis_trigger_type: "auto",
      error_details: "Timed out contacting the model.",
    },
  },
];

export const DEFAULT_INCIDENT_EVENT = INCIDENT_EVENTS[0].type;

// The `meta` keys present on EVERY event (the common block), in display order —
// lets the trigger drawer split a sample into "common" vs "event-specific".
// Mirrors commonMeta() above; keep in sync.
export const INCIDENT_COMMON_KEYS = [
  "org_id",
  "incident_id",
  "event_type",
  "title",
  "status",
  "severity",
  "alert_names",
  "alert_ids",
  "first_alert_at",
  "last_alert_at",
  "created_at",
  "updated_at",
  "_timestamp",
];

// The event_type values, in order — feeds the trigger drawer's preview dropdown.
export const INCIDENT_EVENT_TYPES = INCIDENT_EVENTS.map((e) => e.type);

// Sample payload for one event_type (defaults to the first event). Unknown types
// fall back to the default so callers never get an empty payload.
export const buildIncidentSample = (eventType: string = DEFAULT_INCIDENT_EVENT): unknown[] => {
  const def = INCIDENT_EVENTS.find((e) => e.type === eventType) ?? INCIDENT_EVENTS[0];
  const meta = { ...commonMeta(def.type, def.status, def.severity), ...def.extras };
  return [{ meta, data: [] }];
};
