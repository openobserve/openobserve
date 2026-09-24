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
export type DowntimeStatus = "scheduled" | "active" | "ended" | "cancelled";
export type Repeat = "none" | "daily" | "weekly";
export type LogicalOp = "and" | "or";
export type PairOperator = "=" | "!=";
export type SloCorrectionMode = "exclude" | "count_as_good";

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
}

export interface DowntimeRequest {
  folder_id: string;
  name?: string;
  reason?: string;
  condition?: DimensionCondition;
  targets: DowntimeTarget[];
  schedule: DowntimeSchedule;
  show_banner: boolean;
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

export interface ActiveDowntime {
  id: string;
  name: string;
  ends_at: number;
}

export interface CorrectionRef {
  downtime_id: string;
  name: string;
  status: DowntimeStatus;
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
};

export default downtimes;
