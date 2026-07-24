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

// Builds the sample payload an Incident-Event trigger emits to downstream steps.
//
// For now the payload is JUST a `meta` block (no `data[]` rows) — the fields are
// the ones surfaced on an incident row in IncidentList.vue (the `Incident`
// interface in services/incidents.ts): name/title, status, severity, id, and a
// couple of counters. This is intentionally minimal; the exact field set will be
// finalised once the backend incident-event contract lands.
//
// All values are STRINGS to mirror the Alert-Trigger `meta` block (a string:string
// map), so downstream Conditions/Functions see a consistent shape across trigger
// kinds.

const SAMPLE_TS = 1700000000000000; // microsecond epoch, matches alert timestamps

export const buildIncidentSample = (): unknown => {
  const meta: Record<string, string> = {
    incident_id: "in_8f3a12c9",
    incident_name: "High Error Rate on checkout-service",
    status: "open",
    severity: "P1",
    alert_count: "12",
    first_alert_at: String(SAMPLE_TS),
    last_alert_at: String(SAMPLE_TS + 600000000),
  };
  return { meta };
};
