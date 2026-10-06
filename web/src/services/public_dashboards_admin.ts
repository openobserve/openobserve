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
  "live" | "paused" | "preparing" | "needs_attention" | "expired" | "dashboard_deleted";

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
  rebuild_secs: number;
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
  rebuild_secs: number;
  last_rebuilt_at: number | null;
  rebuild_state: number;
  expires_at: number | null;
  published_by: string;
  updated_by: string | null;
  created_at: number;
  updated_at: number;
}

const linksPath = (org: string, dashboardId: string) =>
  `/api/${org}/dashboards/${dashboardId}/public_links`;

const public_dashboards_admin = {
  listOrg: (org: string) => http().get<{ list: PublicLink[] }>(`/api/${org}/public_dashboards`),
  list: (org: string, dashboardId: string) =>
    http().get<{ list: PublicLink[] }>(linksPath(org, dashboardId)),
  create: (org: string, dashboardId: string, config: PublicLinkConfig) =>
    http().post<PublicLink>(linksPath(org, dashboardId), config),
  update: (org: string, dashboardId: string, linkId: string, config: PublicLinkConfig) =>
    http().put<PublicLink>(`${linksPath(org, dashboardId)}/${linkId}`, config),
  pause: (org: string, dashboardId: string, linkId: string) =>
    http().post<PublicLink>(`${linksPath(org, dashboardId)}/${linkId}/pause`),
  resume: (org: string, dashboardId: string, linkId: string) =>
    http().post<PublicLink>(`${linksPath(org, dashboardId)}/${linkId}/resume`),
  rebuild: (org: string, dashboardId: string, linkId: string) =>
    http().post<PublicLink>(`${linksPath(org, dashboardId)}/${linkId}/rebuild`),
  revoke: (org: string, dashboardId: string, linkId: string) =>
    http().delete(`${linksPath(org, dashboardId)}/${linkId}`),
};

export default public_dashboards_admin;
