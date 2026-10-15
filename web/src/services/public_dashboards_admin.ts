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

export type PublicLinkStatus =
  "live" | "paused" | "not_viewed" | "needs_attention" | "expired" | "dashboard_deleted";

/** A rolling window rebuilt every refresh, or a fixed one (UTC micros) built once. */
export type PublicLinkRange =
  { type: "relative"; secs: number } | { type: "absolute"; start: number; end: number };

export interface PublicLinkTimeRange {
  ranges: PublicLinkRange[];
  default: PublicLinkRange;
}

/** The settings a link is created or edited with. */
export interface PublicLinkConfig {
  name: string;
  visibility: "public";
  time_range: PublicLinkTimeRange;
  frozen_variables: Record<string, unknown>;
  refresh_secs: number;
  expires_at?: number | null;
}

/** One public link as the admin API returns it; `slug` is the link's bearer secret. */
export interface PublicLink {
  id: string;
  name: string;
  slug: string;
  dashboard_id: string;
  dashboard_title: string | null;
  folder_id: string | null;
  folder_name: string | null;
  status: PublicLinkStatus;
  enabled: boolean;
  time_range: PublicLinkTimeRange;
  frozen_variables: Record<string, unknown>;
  refresh_secs: number;
  expires_at: number | null;
  published_by: string;
  updated_by: string | null;
  created_at: number;
  updated_at: number;
  last_accessed_at: number | null;
  access_count: number;
}

/** A range's result on the querier that owns the link; best effort, so a fail-over reads as not cached. */
export type PublicLinkRangeState = "cached" | "not_cached" | "building" | "needs_attention";

export interface PublicLinkRangeStatus {
  key: string;
  state: PublicLinkRangeState;
  built_at: number | null;
  withheld_panels: Array<{ panel_id: string; reason: string }>;
  unavailable_count: number;
  incomplete_count: number;
  last_error: string | null;
  sources?: Record<string, Array<[string, string]>>;
}

export interface PublicLinkStatusReport {
  link_id: string;
  ranges: PublicLinkRangeStatus[];
  access_count: number;
  last_accessed_at: number | null;
}

const linksPath = (org: string, dashboardId: string) =>
  `/api/${org}/dashboards/${dashboardId}/public_links`;

// Every public-links screen shows its own message for a 403, so the global toast would repeat it.
const silent = { silentForbidden: true };

const public_dashboards_admin = {
  listOrg: (org: string) =>
    http().get<{ list: PublicLink[] }>(`/api/${org}/public_dashboards`, silent),
  list: (org: string, dashboardId: string) =>
    http().get<{ list: PublicLink[] }>(linksPath(org, dashboardId), silent),
  create: (org: string, dashboardId: string, config: PublicLinkConfig) =>
    http().post<PublicLink>(linksPath(org, dashboardId), config, silent),
  update: (org: string, dashboardId: string, linkId: string, config: PublicLinkConfig) =>
    http().put<PublicLink>(`${linksPath(org, dashboardId)}/${linkId}`, config, silent),
  pause: (org: string, dashboardId: string, linkId: string) =>
    http().post<PublicLink>(`${linksPath(org, dashboardId)}/${linkId}/pause`, undefined, silent),
  resume: (org: string, dashboardId: string, linkId: string) =>
    http().post<PublicLink>(`${linksPath(org, dashboardId)}/${linkId}/resume`, undefined, silent),
  refresh: (org: string, dashboardId: string, linkId: string) =>
    http().post<PublicLink>(`${linksPath(org, dashboardId)}/${linkId}/refresh`, undefined, silent),
  status: (org: string, dashboardId: string, linkId: string) =>
    http().get<PublicLinkStatusReport>(`${linksPath(org, dashboardId)}/${linkId}/status`, silent),
  statusBatch: (org: string, ids: string[]) =>
    http().get<{ list: PublicLinkStatusReport[] }>(`/api/${org}/public_dashboards/status`, {
      ...silent,
      params: { ids: ids.join(",") },
    }),
  revoke: (org: string, dashboardId: string, linkId: string) =>
    http().delete(`${linksPath(org, dashboardId)}/${linkId}`, silent),
};

export default public_dashboards_admin;
