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
  logo_img: string;
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

// kind: 0 incident, 1 maintenance, 2 info. impact: 0 none, 1 degraded, 2 partial_outage, 3 major_outage.
export interface CreateNoticePayload {
  kind: 0 | 1 | 2;
  impact: 0 | 1 | 2 | 3;
  title: string;
  body: string;
  component_ids?: string[];
  starts_at?: number;
}

export interface UpdateNoticePayload {
  impact?: 0 | 1 | 2 | 3;
  title?: string;
  body?: string;
  component_ids?: string[];
  state?: 0 | 1 | 2;
}

export interface StatusPageNotice {
  id: string;
  kind: 0 | 1 | 2;
  impact: 0 | 1 | 2 | 3;
  source: 0 | 1;
  title: string;
  body: string;
  state: 0 | 1 | 2;
  starts_at: number;
  resolved_at: number | null;
  excluded_from_uptime: boolean;
  component_ids: string[];
  created_at: number;
  updated_at: number;
}

export interface StatusPageNoticeUpdate {
  id: string;
  body: string;
  owner: string | null;
  created_at: number;
}

// The subset of the preview response the acting-user optimistic-refresh
// needs — just enough to patch the list row's health without waiting for
// the rebuilder's next tick to overwrite the cached snapshot it reads from.
export interface PreviewResponse {
  current: {
    overall: Exclude<StatusPageHealth, null>;
  };
}

export interface CreateDomainResponse {
  id: string;
  domain: string;
  txt_name: string;
  txt_value: string;
}

// 0 pending, 1 verified, 2 failed.
export type DomainVerificationState = 0 | 1 | 2;
// 0 record-missing, 1 value-mismatch, 2 dns-resolution-failed.
export type DomainFailureReason = 0 | 1 | 2 | null;

export interface StatusPageDomain {
  id: string;
  domain: string;
  verification_state: DomainVerificationState;
  verification_failure_reason: DomainFailureReason;
  verified_at: number | null;
  last_checked_at: number | null;
  created_at: number;
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

  preview: (orgIdentifier: string, id: string) =>
    http().get(`/api/${orgIdentifier}/status_pages/${id}/preview`),

  listNotices: (orgIdentifier: string, id: string) =>
    http().get(`/api/${orgIdentifier}/status_pages/${id}/notices`),

  createNotice: (orgIdentifier: string, id: string, payload: CreateNoticePayload) =>
    http().post(`/api/${orgIdentifier}/status_pages/${id}/notices`, payload),

  deleteNotice: (orgIdentifier: string, noticeId: string) =>
    http().delete(`/api/${orgIdentifier}/status_pages/notices/${noticeId}`),

  listNoticeUpdates: (orgIdentifier: string, noticeId: string) =>
    http().get(`/api/${orgIdentifier}/status_pages/notices/${noticeId}/updates`),

  markFalsePositive: (orgIdentifier: string, noticeId: string, snoozeHours = 6) =>
    http().post(
      `/api/${orgIdentifier}/status_pages/notices/${noticeId}/mark_false_positive`,
      { snooze_hours: snoozeHours },
    ),

  // Widens impact (never narrows it — see UpdateNoticePayload) on the existing incident.
  updateNotice: (orgIdentifier: string, noticeId: string, payload: UpdateNoticePayload) =>
    http().put(`/api/${orgIdentifier}/status_pages/notices/${noticeId}`, payload),

  addNoticeUpdate: (orgIdentifier: string, noticeId: string, body: string) =>
    http().post(`/api/${orgIdentifier}/status_pages/notices/${noticeId}/updates`, { body }),

  listDomains: (orgIdentifier: string, id: string) =>
    http().get(`/api/${orgIdentifier}/status_pages/${id}/domains`),

  createDomain: (orgIdentifier: string, id: string, domain: string) =>
    http().post(`/api/${orgIdentifier}/status_pages/${id}/domains`, { domain }),

  deleteDomain: (orgIdentifier: string, domainId: string) =>
    http().delete(`/api/${orgIdentifier}/status_pages/domains/${domainId}`),

  verifyDomain: (orgIdentifier: string, domainId: string) =>
    http().post(`/api/${orgIdentifier}/status_pages/domains/${domainId}/verify`, {}),
};

export default statusPagesService;
