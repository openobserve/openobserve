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

export type TargetModule = "alerts" | "anomaly_detections" | "synthetics" | "slos";
export type DowntimeStatus = "scheduled" | "active" | "ended" | "cancelled" | "ended_early";
export type Repeat = "none" | "daily" | "weekly";
export type LogicalOp = "and" | "or";
export type PairOperator = "=" | "!=";
export type SloCorrectionMode = "exclude" | "count_as_good";
export type IncidentMode = "muted" | "none";

export type TargetFolders = { kind: "all" } | { kind: "some"; folder_ids: string[] };

export type DimensionCondition =
  | { type: "group"; op: LogicalOp; items: DimensionCondition[] }
  | { type: "pair"; key: string; operator: PairOperator; value: string };

export interface DowntimeTarget {
  module: TargetModule;
  folders: TargetFolders;
  tags?: string[];
  ids?: string[];
  slo_mode?: SloCorrectionMode;
  /** Alerts only; absent reads as `muted`. */
  incident_mode?: IncidentMode;
}

export interface DowntimeSchedule {
  repeat: Repeat;
  /** Microseconds UTC. */
  starts_at: number;
  ends_at?: number | null;
  timezone: string;
  /** `HH:MM` in `timezone`, recurring rows only. */
  start_time_local?: string | null;
  duration_secs: number;
  /** ISO weekdays, 1 is Monday. */
  weekdays: number[];
}

export type NotificationEvent = "started" | "ending_soon" | "ended" | "cancelled" | "extended";

export type NotificationEvents = Record<NotificationEvent, boolean>;

export interface DowntimeNotifications {
  destinations: string[];
  events: NotificationEvents;
  ending_soon_lead_secs: number;
  /** Set by the server on an extension follow-up: the id of the downtime it continues. */
  continues?: string;
}

export interface DowntimeNotificationLogEntry {
  window_start: number;
  event: NotificationEvent;
  sent_at: number;
  destinations: string[];
  result?: string;
}

export interface Downtime {
  id: string;
  org: string;
  folder_id: string;
  name: string;
  reason?: string;
  condition?: DimensionCondition;
  targets: DowntimeTarget[];
  schedule: DowntimeSchedule;
  cancelled_at?: number;
  cancelled_by?: string;
  show_banner: boolean;
  notifications?: DowntimeNotifications;
  origin_region?: string;
  created_by: string;
  created_at: number;
  updated_by: string;
  updated_at: number;
}

export interface DowntimeWindow {
  start: number;
  end: number;
}

export interface DowntimeListItem extends Downtime {
  status: DowntimeStatus;
  current_window: DowntimeWindow | null;
  next_window: DowntimeWindow | null;
  matched_alerts: number;
  matched_anomalies: number;
  matched_synthetics: number;
  matched_slos: number;
}

export interface DowntimeCounts {
  active: number;
  scheduled: number;
  recurring: number;
  ended: number;
  cancelled: number;
  ended_early: number;
}

export interface DowntimeListResponse {
  items: DowntimeListItem[];
  total: number;
  counts: DowntimeCounts;
}

export interface PreviewMatch {
  id: string;
  name: string;
  folder_id: string;
  matched_by?: string;
  missing?: string;
}

export interface DowntimeAffected {
  alerts: PreviewMatch[];
  anomalies: PreviewMatch[];
  synthetics: PreviewMatch[];
  slos: PreviewMatch[];
}

export interface DowntimeDetail extends DowntimeListItem {
  affected: DowntimeAffected;
  notification_log?: DowntimeNotificationLogEntry[];
}

export interface DowntimeRequest {
  folder_id: string;
  name?: string;
  reason?: string;
  condition?: DimensionCondition;
  targets: DowntimeTarget[];
  schedule: DowntimeSchedule;
  show_banner: boolean;
  notifications?: DowntimeNotifications;
}

/** Exactly one of the two. */
export type ExtendDowntimeRequest = { by_secs: number } | { until: number };

/** The row that now ends later; for a recurring row, the one-time follow-up it created. */
export interface ExtendDowntimeResponse extends Downtime {
  created_id?: string;
}

export interface PreviewRequest {
  condition?: DimensionCondition;
  targets: DowntimeTarget[];
}

export interface PreviewResponse {
  alerts: PreviewMatch[];
  resolved_at_fire_time: PreviewMatch[];
  anomalies: PreviewMatch[];
  synthetics: PreviewMatch[];
  slos: PreviewMatch[];
  alerts_total: number;
  anomalies_total: number;
  synthetics_total: number;
  slos_total: number;
  undecidable?: Record<string, PreviewMatch[]>;
}

export interface ResourcesRequest {
  condition: DimensionCondition;
  refine_by: string;
}

export interface ResourceValue {
  value: string;
  last_seen: number;
  streams: string[];
}

export interface ResourcesResponse {
  dimension: string;
  values: ResourceValue[];
  total: number;
  source: "registry" | "search" | string;
}

export interface ValuesRequest {
  /** A semantic group id. */
  key: string;
  /** Case-insensitive prefix; empty lists the top values. */
  prefix: string;
  condition?: DimensionCondition | null;
}

export interface ValueSuggestion {
  value: string;
  source: "inventory" | "registry" | "search";
  /** Alerts, anomaly detections and SLOs whose identity carries this value. */
  items: number;
  last_seen?: number;
}

export interface ValuesResponse {
  values: ValueSuggestion[];
  /** A source timed out; the list is what answered in time. */
  partial: boolean;
}

export interface ActiveDowntime {
  id: string;
  name: string;
  ends_at: number;
}

export interface CorrectionRef {
  downtime_id: string;
  name: string;
  status: DowntimeStatus;
  /** `false` when the window is shorter than the SLO's slice and corrects no minutes. */
  applies?: boolean;
}

export interface DowntimeListParams {
  folder_id?: string;
  status?: DowntimeStatus;
  repeat?: Repeat;
  search?: string;
  alert_id?: string;
  page?: number;
  page_size?: number;
}

const base = (org: string) => `/api/v2/${encodeURIComponent(org)}/downtimes`;
const one = (org: string, id: string) => `${base(org)}/${encodeURIComponent(id)}`;

// The route permission check reads the downtime folder from `?folder=`, so every call names it.
const inFolder = (folder?: string) => (folder ? { params: { folder } } : {});

const downtimes = {
  list: (org: string, params: DowntimeListParams = {}) =>
    http().get<DowntimeListResponse>(base(org), { params }),
  get: (org: string, id: string, folder?: string) =>
    http().get<DowntimeDetail>(one(org, id), inFolder(folder)),
  create: (org: string, body: DowntimeRequest) =>
    http().post<{ id: string }>(base(org), body, inFolder(body.folder_id)),
  update: (org: string, id: string, body: DowntimeRequest) =>
    http().put(one(org, id), body, inFolder(body.folder_id)),
  cancel: (org: string, id: string, folder?: string) =>
    http().post(`${one(org, id)}/cancel`, undefined, inFolder(folder)),
  extend: (org: string, id: string, body: ExtendDowntimeRequest, folder?: string) =>
    http().post<ExtendDowntimeResponse>(`${one(org, id)}/extend`, body, inFolder(folder)),
  remove: (org: string, id: string, folder?: string) =>
    http().delete(one(org, id), inFolder(folder)),
  move: (org: string, downtimeIds: string[], dstFolderId: string, folder?: string) =>
    http().patch(
      `${base(org)}/move`,
      { downtime_ids: downtimeIds, dst_folder_id: dstFolderId },
      inFolder(folder),
    ),
  preview: (org: string, body: PreviewRequest, folder?: string) =>
    http().post<PreviewResponse>(`${base(org)}/preview`, body, inFolder(folder)),
  resources: (org: string, body: ResourcesRequest, folder?: string) =>
    http().post<ResourcesResponse>(`${base(org)}/resources`, body, inFolder(folder)),
  values: (org: string, body: ValuesRequest, folder?: string) =>
    http().post<ValuesResponse>(`${base(org)}/values`, body, inFolder(folder)),
};

export default downtimes;
