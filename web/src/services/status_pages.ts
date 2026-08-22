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

// visibility: 0 = draft, 1 = public, 2 = password
export type StatusPageVisibility = 0 | 1 | 2;

export type StatusPageHealth =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage"
  | "maintenance"
  | "no_data"
  | null;

export interface StatusPageListItem {
  id: string;
  name: string;
  slug: string;
  description: string;
  visibility: StatusPageVisibility;
  password_set: boolean;
  noindex: boolean;
  show_uptime_percent: boolean;
  show_timeline_bars: boolean;
  show_response_time: boolean;
  confirm_failures: number;
  confirm_recovery: number;
  confirm_after_secs: number;
  brand_name: string;
  accent_color: string;
  display_tz: string;
  tracking_since: number;
  owner: string;
  created_at: number;
  updated_at: number;
  health: StatusPageHealth;
  component_count: number;
}

export interface StatusPageComponent {
  id?: string;
  name: string;
  description?: string;
  check_ids: string[];
}

const statusPagesService = {
  list: (orgIdentifier: string) => http().get(`/api/${orgIdentifier}/status_pages`),

  get: (orgIdentifier: string, id: string) =>
    http().get(`/api/${orgIdentifier}/status_pages/${id}`),

  create: (orgIdentifier: string, payload: { name: string; description?: string }) =>
    http().post(`/api/${orgIdentifier}/status_pages`, payload),

  // PUT accepts a partial page — only the keys present are updated.
  update: (orgIdentifier: string, id: string, payload: Record<string, unknown>) =>
    http().put(`/api/${orgIdentifier}/status_pages/${id}`, payload),

  delete: (orgIdentifier: string, id: string) =>
    http().delete(`/api/${orgIdentifier}/status_pages/${id}`),

  updateComponents: (orgIdentifier: string, id: string, components: StatusPageComponent[]) =>
    http().put(`/api/${orgIdentifier}/status_pages/${id}/components`, { components }),

  rotateSlug: (orgIdentifier: string, id: string) =>
    http().post(`/api/${orgIdentifier}/status_pages/${id}/rotate_slug`, {}),
};

export default statusPagesService;
