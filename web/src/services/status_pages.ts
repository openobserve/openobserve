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
import analytics from "./product_analytics";

// visibility: 0 = draft, 1 = public, 2 = password
export type StatusPageVisibility = 0 | 1 | 2;

export type StatusPageHealth =
  "operational" | "degraded" | "partial_outage" | "major_outage" | "maintenance" | "no_data" | null;

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
  favicon_img: string;
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
  /** Set when an owner marked this auto-incident as a false alarm. */
  false_alarm?: { by: string; at: number; reason: string } | null;
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

// Exactly one record is present: the TXT pair in proxy mode, the CNAME target with built-in TLS.
export interface CreateDomainResponse {
  id: string;
  domain: string;
  txt_name: string | null;
  txt_value: string | null;
  cname_target: string | null;
}

// 0 pending, 1 verified, 2 failed.
export type DomainVerificationState = 0 | 1 | 2;
// TXT proof: 0 record missing, 1 value mismatch. CNAME proof: 5 points at the app host, 6 no
// CNAME, 7 CNAME elsewhere. Both: 2 DNS lookup failed, 3 held by another organization, 4 proof lost.
export type DomainFailureReason = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | null;

// What a custom domain is shown as. In proxy mode and while custom domains are off the server
// sends only `pending`, `verified`, `not_serving` and `expired`.
export type DomainServingState =
  | "pending"
  | "verified"
  | "waiting_for_dns"
  | "setting_up"
  | "ready"
  | "serving"
  | "delayed"
  | "not_serving"
  | "expired";

// When each fact behind a domain's state was last seen, in microseconds.
export interface DomainEvidence {
  proof_checked_at: number | null;
  proof_failed_since: number | null;
  dns_checked_at: number | null;
  probe_checked_at: number | null;
  ca_validated_at: number | null;
  probe_mode: string | null;
}

// Times are microseconds.
export interface StatusPageDomain {
  id: string;
  domain: string;
  verification_state: DomainVerificationState;
  verification_failure_reason: DomainFailureReason;
  verified_at: number | null;
  last_checked_at: number | null;
  created_at: number;
  // Proxy mode only: the record is `<txt_name> TXT <verification_token>`.
  txt_name: string | null;
  verification_token: string | null;
  // Built-in TLS only: the record is `<domain> CNAME <cname_target>`.
  cname_target: string | null;
  // Built-in TLS only: the app's own host, which the CNAME must not name.
  app_host: string | null;
  is_holder: boolean;
  serving_state: DomainServingState;
  // Why the claim is in `serving_state`; null before the first check.
  reason: string | null;
  warning: string | null;
  // The earliest time the warning's consequence can happen.
  warning_at: number | null;
  expires_at: number | null;
  released_at: number | null;
  certificate_expires_at: number | null;
  next_action_at: number | null;
  state_computed_at: number | null;
  evidence: DomainEvidence;
  can_check_again: boolean;
  acts: "customer" | "operator" | null;
}

export interface DomainInstallationListener {
  node: string;
  address: string;
  last_seen_at: number;
  certs_loaded: number;
  last_sync_at: number | null;
  private_peers_only: boolean;
}

// Root only. One shape in every state: unless `enabled` with `tls: "built_in"`, every other
// field is null and `listeners` is empty. Times are microseconds.
export interface DomainInstallation {
  enabled: boolean;
  tls: "built_in" | "proxy";
  target: string | null;
  not_ready_reason: string | null;
  target_resolves: boolean | null;
  wildcard_resolves: boolean | null;
  target_certificate_expires_at: number | null;
  key_check: "ok" | "missing" | "mismatch" | null;
  epoch: { configured: number; stored: number | null } | null;
  listeners: DomainInstallationListener[];
  lease: { owner: string | null; expires_at: number | null } | null;
  last_validation_at: number | null;
  last_ca_error: { at: number; message: string } | null;
  visitor_addresses_visible: boolean | null;
  probe_mode: string | null;
  next_check_at: number | null;
}

const statusPagesService = {
  list: (orgIdentifier: string) => http().get(`/api/${orgIdentifier}/status_pages`),

  get: (orgIdentifier: string, id: string) =>
    http().get(`/api/${orgIdentifier}/status_pages/${id}`),

  create: (orgIdentifier: string, payload: { name: string; description?: string }) =>
    http()
      .post(`/api/${orgIdentifier}/status_pages`, payload)
      .then((res) => {
        analytics.track("status_page_created");
        return res;
      }),

  // PUT accepts a partial page — only the keys present are updated.
  update: (orgIdentifier: string, id: string, payload: Record<string, unknown>) =>
    http().put(`/api/${orgIdentifier}/status_pages/${id}`, payload),

  delete: (orgIdentifier: string, id: string) =>
    http()
      .delete(`/api/${orgIdentifier}/status_pages/${id}`)
      .then((res) => {
        analytics.track("status_page_deleted");
        return res;
      }),

  updateComponents: (orgIdentifier: string, id: string, components: StatusPageComponent[]) =>
    http().put(`/api/${orgIdentifier}/status_pages/${id}/components`, { components }),

  rotateSlug: (orgIdentifier: string, id: string) =>
    http()
      .post(`/api/${orgIdentifier}/status_pages/${id}/rotate_slug`, {})
      .then((res) => {
        analytics.track("status_page_slug_rotated");
        return res;
      }),

  preview: (orgIdentifier: string, id: string) =>
    http().get(`/api/${orgIdentifier}/status_pages/${id}/preview`),

  listNotices: (orgIdentifier: string, id: string) =>
    http().get(`/api/${orgIdentifier}/status_pages/${id}/notices`),

  createNotice: (orgIdentifier: string, id: string, payload: CreateNoticePayload) =>
    http()
      .post(`/api/${orgIdentifier}/status_pages/${id}/notices`, payload)
      .then((res) => {
        analytics.track("status_page_notice_created", {
          kind: (["incident", "maintenance", "info"] as const)[payload.kind],
          impact: payload.impact,
        });
        return res;
      }),

  deleteNotice: (orgIdentifier: string, noticeId: string) =>
    http()
      .delete(`/api/${orgIdentifier}/status_pages/notices/${noticeId}`)
      .then((res) => {
        analytics.track("status_page_notice_deleted");
        return res;
      }),

  listNoticeUpdates: (orgIdentifier: string, noticeId: string) =>
    http().get(`/api/${orgIdentifier}/status_pages/notices/${noticeId}/updates`),

  // No snooze: the server holds only the failure the incident was marked on.
  markFalsePositive: (orgIdentifier: string, noticeId: string, reason: string) =>
    http()
      .post(`/api/${orgIdentifier}/status_pages/notices/${noticeId}/mark_false_positive`, {
        reason,
      })
      .then((res) => {
        analytics.track("status_page_notice_marked_false_positive");
        return res;
      }),

  // Restores a false alarm: it returns to the public history and its downtime counts again.
  undoFalsePositive: (orgIdentifier: string, noticeId: string) =>
    http().delete(`/api/${orgIdentifier}/status_pages/notices/${noticeId}/mark_false_positive`),

  // Widens impact (never narrows it — see UpdateNoticePayload) on the existing incident.
  updateNotice: (orgIdentifier: string, noticeId: string, payload: UpdateNoticePayload) =>
    http().put(`/api/${orgIdentifier}/status_pages/notices/${noticeId}`, payload),

  addNoticeUpdate: (orgIdentifier: string, noticeId: string, body: string) =>
    http().post(`/api/${orgIdentifier}/status_pages/notices/${noticeId}/updates`, { body }),

  listDomains: (orgIdentifier: string, id: string, options?: { silentForbidden: boolean }) =>
    http().get<StatusPageDomain[]>(`/api/${orgIdentifier}/status_pages/${id}/domains`, options),

  createDomain: (orgIdentifier: string, id: string, domain: string) =>
    http()
      .post<CreateDomainResponse>(`/api/${orgIdentifier}/status_pages/${id}/domains`, { domain })
      .then((res) => {
        analytics.track("status_page_domain_added");
        return res;
      }),

  deleteDomain: (orgIdentifier: string, domainId: string) =>
    http()
      .delete(`/api/${orgIdentifier}/status_pages/domains/${domainId}`)
      .then((res) => {
        analytics.track("status_page_domain_deleted");
        return res;
      }),

  verifyDomain: (orgIdentifier: string, domainId: string) =>
    http()
      .post(`/api/${orgIdentifier}/status_pages/domains/${domainId}/verify`, {})
      .then((res) => {
        analytics.track("status_page_domain_verification_checked");
        return res;
      }),

  // "Check again": the server recomputes the view, and with built-in TLS retries the order.
  checkDomain: (orgIdentifier: string, domainId: string) =>
    http()
      .post<StatusPageDomain>(`/api/${orgIdentifier}/status_pages/domains/${domainId}/check`, {})
      .then((res) => {
        analytics.track("status_page_domain_checked_again");
        return res;
      }),

  // Root only: the 403 every other user gets is the answer, not an access refusal to report.
  getDomainInstallation: (orgIdentifier: string) =>
    http().get<DomainInstallation>(`/api/${orgIdentifier}/status_pages/domains/installation`, {
      silentForbidden: true,
    }),

  checkDomainInstallation: (orgIdentifier: string) =>
    http()
      .post<DomainInstallation>(`/api/${orgIdentifier}/status_pages/domains/installation/check`, {})
      .then((res) => {
        analytics.track("status_page_domain_installation_checked");
        return res;
      }),
};

export default statusPagesService;
