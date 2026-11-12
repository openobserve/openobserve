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

export type ProfileFilterOp = "=" | "!=" | "=~" | "!~" | "in" | "not_in";

export interface ProfileFilter {
  key: string;
  op: ProfileFilterOp;
  value: string;
  /** The list for `in` / `not_in`. */
  values?: string[];
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
  /** Value per second of profiled time; absent when the profiles carry no covered time (memory, older data). */
  rate?: number | null;
}

export interface ProfilesSeriesGroup {
  value: string;
  total: number;
  /** The values past `group_limit`, summed into one line. */
  others: boolean;
  series: ProfilesSeriesPoint[];
}

export interface ProfilesSeriesResponse {
  unit: string;
  profile_type: string;
  step_secs: number;
  series: ProfilesSeriesPoint[];
  /** One line per value of `group_by`, heaviest first. */
  groups?: ProfilesSeriesGroup[] | null;
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
  /** The server folded small call paths into "other" to keep the tree under max_nodes. */
  tree_truncated?: boolean;
  root: ProfilesTreeNode;
  top: ProfilesTopRow[];
  took: number;
}

export interface ProfilesDiffNode {
  name: string;
  /** Comparison side. */
  total: number;
  self: number;
  before_total: number;
  before_self: number;
  children?: ProfilesDiffNode[];
}

export interface ProfilesDiffTopRow {
  name: string;
  before_self: number;
  before_total: number;
  after_self: number;
  after_total: number;
}

export interface ProfilesDiffResponse {
  unit: string;
  profile_type: string;
  baseline_total: number;
  comparison_total: number;
  truncated: boolean;
  tree_truncated?: boolean;
  root: ProfilesDiffNode;
  top: ProfilesDiffTopRow[];
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
  /** A label to draw one series per value of. */
  group_by?: string;
  group_limit?: number;
}

const decodeFilterPart = (part: string) => {
  try {
    return decodeURIComponent(part);
  } catch {
    // Matches the backend, which keeps a malformed escape verbatim.
    return part;
  }
};

/** Encodes the equality filters as the backend's GET `k=v,k2=v2`, which has no other operator; each side is percent-encoded. */
export const encodeProfileFilters = (filters: ProfileFilter[]): string =>
  filters
    .filter((f) => f.key && f.value && f.op === "=")
    .map((f) => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value)}`)
    .join(",");

const ROUTE_OPS: Record<string, ProfileFilterOp> = {
  neq: "!=",
  re: "=~",
  nre: "!~",
  in: "in",
  nin: "not_in",
};

/** The page URL's filters: `k=v` for equality, `op:k=v` otherwise, a list's items joined with `|`; `:` and `|` are percent-encoded inside each part. */
export const encodeProfileRouteFilters = (filters: ProfileFilter[]): string =>
  filters
    .map((f) => {
      const prefix = Object.keys(ROUTE_OPS).find((k) => ROUTE_OPS[k] === f.op);
      const value = f.values?.length
        ? f.values.map(encodeURIComponent).join("|")
        : encodeURIComponent(f.value);
      if (!f.key || !value) return "";
      return `${prefix ? `${prefix}:` : ""}${encodeURIComponent(f.key)}=${value}`;
    })
    .filter(Boolean)
    .join(",");

export const parseProfileFilters = (raw: string): ProfileFilter[] =>
  raw
    .split(",")
    .map((pair) => {
      const [head = "", value = ""] = pair.split("=");
      const colon = head.indexOf(":");
      const prefixed = colon > 0 ? ROUTE_OPS[head.slice(0, colon)] : undefined;
      // Older links carry an unencoded `:` inside the key (k8s:pod=x), so an unknown prefix is part of it.
      if (!prefixed) return { key: head, op: "=" as ProfileFilterOp, value };
      return { key: head.slice(colon + 1), op: prefixed, value };
    })
    .filter(({ key, op, value }) => key && op && value)
    .map(({ key, op, value }): ProfileFilter => {
      if (op === "in" || op === "not_in") {
        const values = value.split("|").map(decodeFilterPart).filter(Boolean);
        return { key: decodeFilterPart(key), op, value: "", values };
      }
      return { key: decodeFilterPart(key), op, value: decodeFilterPart(value) };
    });

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
    const filters = encodeProfileFilters(payload.filters);
    if (filters) query.set("filters", filters);
  }
};

const profiles = {
  meta: (
    orgIdentifier: string,
    streamName: string,
    payload: Pick<ProfilesQueryBody, "start_time" | "end_time" | "timeout" | "service_name">,
  ) => {
    const query = new URLSearchParams();
    appendProfilesQuery(query, payload);
    if (payload.timeout) query.set("timeout", String(payload.timeout));
    return http().get<ProfilesMetaResponse>(
      `/api/${orgIdentifier}/${encodeURIComponent(streamName)}/profiles/meta?${query.toString()}`,
    );
  },

  series: (
    orgIdentifier: string,
    streamName: string,
    payload: ProfilesQueryBody,
    options: { signal?: AbortSignal } = {},
  ) =>
    http().post<ProfilesSeriesResponse>(
      `/api/${orgIdentifier}/${encodeURIComponent(streamName)}/profiles/series`,
      payload,
      options,
    ),

  merge: (
    orgIdentifier: string,
    streamName: string,
    payload: ProfilesQueryBody,
    options: { signal?: AbortSignal } = {},
  ) =>
    http().post<ProfilesMergeResponse>(
      `/api/${orgIdentifier}/${encodeURIComponent(streamName)}/profiles/merge`,
      payload,
      options,
    ),

  diff: (
    orgIdentifier: string,
    streamName: string,
    payload: { baseline: ProfilesQueryBody; comparison: ProfilesQueryBody; max_nodes?: number },
    options: { signal?: AbortSignal } = {},
  ) =>
    http().post<ProfilesDiffResponse>(
      `/api/${orgIdentifier}/${encodeURIComponent(streamName)}/profiles/diff`,
      payload,
      options,
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
