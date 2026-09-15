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

export interface ProfileFilter {
  key: string;
  op: "=";
  value: string;
}

export interface ProfileTypeMeta {
  type: string;
  unit: string;
}

export interface ProfilesMetaResponse {
  data_sources: string[];
  services: string[];
  profile_types: ProfileTypeMeta[];
  label_names: string[];
  took: number;
}

export interface ProfilesSeriesPoint {
  timestamp: number;
  value: number;
}

export interface ProfilesSeriesResponse {
  unit: string;
  profile_type: string;
  step_secs: number;
  series: ProfilesSeriesPoint[];
  took: number;
}

export interface ProfilesTreeNode {
  name: string;
  self: number;
  total: number;
  children?: ProfilesTreeNode[];
}

export interface ProfilesTopRow {
  name: string;
  self: number;
  total: number;
}

export interface ProfilesMergeResponse {
  unit: string;
  profile_type: string;
  total: number;
  merged_total: number;
  truncated: boolean;
  root: ProfilesTreeNode;
  top: ProfilesTopRow[];
  took: number;
}

export interface ProfilesQueryBody {
  start_time: number;
  end_time: number;
  data_source?: string;
  service_name?: string;
  profile_type?: string;
  profile_unit?: string;
  filters?: ProfileFilter[];
  step?: string;
  max_nodes?: number;
  timeout?: number;
}

const appendProfilesQuery = (
  query: URLSearchParams,
  payload: Omit<ProfilesQueryBody, "filters" | "step" | "max_nodes"> & {
    filters?: ProfileFilter[];
    tag?: string;
  },
) => {
  query.set("start_time", String(payload.start_time));
  query.set("end_time", String(payload.end_time));
  if (payload.data_source) query.set("data_source", payload.data_source);
  if (payload.service_name) query.set("service_name", payload.service_name);
  if (payload.profile_type) query.set("profile_type", payload.profile_type);
  if (payload.profile_unit) query.set("profile_unit", payload.profile_unit);
  if (payload.tag) query.set("tag", payload.tag);
  if (payload.filters?.length) {
    const filters = payload.filters
      .filter((f) => f.key && f.value && f.op === "=")
      .map((f) => `${f.key}=${f.value}`)
      .join(",");
    if (filters) query.set("filters", filters);
  }
};

const profiles = {
  meta: (
    orgIdentifier: string,
    streamName: string,
    payload: Pick<ProfilesQueryBody, "start_time" | "end_time" | "timeout">,
  ) => {
    const query = new URLSearchParams();
    appendProfilesQuery(query, payload);
    if (payload.timeout) query.set("timeout", String(payload.timeout));
    return http().get<ProfilesMetaResponse>(
      `/api/${orgIdentifier}/${encodeURIComponent(streamName)}/profiles/meta?${query.toString()}`,
    );
  },

  series: (orgIdentifier: string, streamName: string, payload: ProfilesQueryBody) =>
    http().post<ProfilesSeriesResponse>(
      `/api/${orgIdentifier}/${encodeURIComponent(streamName)}/profiles/series`,
      payload,
    ),

  merge: (orgIdentifier: string, streamName: string, payload: ProfilesQueryBody) =>
    http().post<ProfilesMergeResponse>(
      `/api/${orgIdentifier}/${encodeURIComponent(streamName)}/profiles/merge`,
      payload,
    ),

  tagValues: (
    orgIdentifier: string,
    streamName: string,
    payload: Omit<ProfilesQueryBody, "step" | "max_nodes"> & { tag: string },
  ) => {
    const query = new URLSearchParams();
    appendProfilesQuery(query, payload);
    return http().get<{ tag: string; values: string[]; took: number }>(
      `/api/${orgIdentifier}/${encodeURIComponent(streamName)}/profiles/tag_values?${query.toString()}`,
    );
  },
};

export default profiles;
