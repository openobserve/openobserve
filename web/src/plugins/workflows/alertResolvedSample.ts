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

// The payload one recovered firing hands downstream steps.
//
// No `data` rows: the query that produced them no longer matches. `episode_id` is
// the key the firing sent to PagerDuty, so a workflow can join the two runs.

import { raw } from "@/types/i18n";

import type { WorkflowFieldOption } from "./alertFields";

const OPENED_AT = 1784895060000000; // microsecond epoch, matches alert timestamps
const RECOVERED_AT = OPENED_AT + 1080000000; // 18 minutes later

export const buildAlertResolvedSample = (): unknown[] => [
  {
    meta: {
      org_id: "default",
      stream_type: "logs",
      stream_name: "app_logs",
      alert_name: "payments-5xx-p1",
      alert_status: "resolved",
      episode_id: "3JLwioOY5B3cetkY3RT6p7CE7L3",
      alert_start_time: OPENED_AT,
      alert_end_time: RECOVERED_AT,
    },
    data: [],
  },
];

export const ALERT_RESOLVED_PAYLOAD_FIELDS: WorkflowFieldOption[] = [
  { label: raw("meta.alert_name"), value: "meta_alert_name", type: "Utf8" },
  { label: raw("meta.alert_status"), value: "meta_alert_status", type: "Utf8" },
  { label: raw("meta.episode_id"), value: "meta_episode_id", type: "Utf8" },
  { label: raw("meta.org_id"), value: "meta_org_id", type: "Utf8" },
  { label: raw("meta.stream_name"), value: "meta_stream_name", type: "Utf8" },
  { label: raw("meta.stream_type"), value: "meta_stream_type", type: "Utf8" },
  { label: raw("meta.alert_start_time"), value: "meta_alert_start_time", type: "Int64" },
  { label: raw("meta.alert_end_time"), value: "meta_alert_end_time", type: "Int64" },
];
