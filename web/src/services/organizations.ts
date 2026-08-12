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
import { defineQuery } from "@/composables/query/queryClient";
import { CONFIG_STALE_TIME, LONG_GC_TIME } from "@/composables/query/cachePolicy";
import { localStoragePersister } from "@/composables/query/persisters";

const organizations = {
  os_list: (
    page_num: number,
    page_size: number,
    sort_by: string,
    desc: boolean,
    name: string,
    _org_identifier: string,
  ) => {
    return http().get(
      `/api/organizations?page_num=${page_num}&page_size=${page_size}&sort_by=${sort_by}&desc=${desc}&name=${name}`,
    );
  },
  list: (page_num: number, page_size: number, sort_by: string, desc: boolean, name: string) => {
    return http().get(
      `/api/organizations?page_num=${page_num}&page_size=${page_size}&sort_by=${sort_by}&desc=${desc}&name=${name}`,
    );
  },
  create: (data: any) => {
    return http().post("/api/organizations", data);
  },
  add_members: (data: any, orgIdentifier: string) => {
    return http().post(`api/${orgIdentifier}/invites`, data);
  },
  revoke_invite: (orgIdentifier: string, token: string) => {
    return http().delete(`api/${orgIdentifier}/invites/${token}`);
  },
  process_subscription: (s: string, action: string, orgIdentifier: string) => {
    return http().put(`api/${orgIdentifier}/member_subscription/${s}?action=${action}`, {});
  },
  decline_subscription: (s: string) => {
    return http().delete(`api/invites/${s}`, {});
  },
  get_associated_members: (orgIdentifier: string) => {
    return http().get(`api/${orgIdentifier}/organizations/associated_members`);
  },
  update_member_role: (data: any, orgIdentifier: string) => {
    return http().put(`api/${orgIdentifier}/users/${data.email}`, data);
  },
  verify_identifier: (name: string) => {
    return http().get(`api/organizations/verify_identifier/${name}`);
  },
  get_organization_passcode: (orgIdentifier: string) => {
    return http().get(`/api/${orgIdentifier}/passcode`);
  },
  update_organization_passcode: (orgIdentifier: string) => {
    return http().put(`api/${orgIdentifier}/passcode`, {});
  },
  get_organization_summary: (orgIdentifier: string) => {
    return http().get(`/api/${orgIdentifier}/summary`);
  },
  get_organization_settings: (orgIdentifier: string) => {
    return http().get(`/api/${orgIdentifier}/settings`);
  },
  post_organization_settings: (orgIdentifier: string, data: any) => {
    return http().post(`/api/${orgIdentifier}/settings`, data);
  },
  get_admin_org: (orgIdentifier: string) => {
    return http().get(`/api/${orgIdentifier}/organizations?page_size=1000000`);
  },
  extend_trial_period: (orgIdentifier: string, data: any) => {
    return http().put(`/api/${orgIdentifier}/extend_trial_period`, data);
  },
  set_ai_usage_limit: (orgIdentifier: string, data: { org_id: string; credits_limit: number }) => {
    return http().put(`/api/${orgIdentifier}/ai/usage_limit`, data);
  },
  rename_organization: (orgIdentifier: string, newOrgName: string) => {
    return http().put(`/api/${orgIdentifier}/rename`, {
      new_name: newOrgName,
    });
  },
  create_external_contract: (orgIdentifier: string, data: any) => {
    return http().post(`/api/${orgIdentifier}/external_contract`, data);
  },
  extend_external_contract: (orgIdentifier: string, data: any) => {
    return http().put(`/api/${orgIdentifier}/external_contract`, data);
  },
  revoke_external_contract: (orgIdentifier: string, targetOrgId: string) => {
    return http().delete(`/api/${orgIdentifier}/external_contract/${targetOrgId}`);
  },

  get_cleanup_tasks: (targetOrgId: string) => {
    return http().get(`/api/_meta/org_cleanup_tasks/${targetOrgId}`);
  },
  delete_org: (orgIdentifier: string) => {
    return http().delete(`/api/${orgIdentifier}/organizations`);
  },
  resurrect_org: (metaOrg: string, targetOrg: string) => {
    return http().post(`/api/${metaOrg}/organizations/${targetOrg}/resurrect`);
  },

  // Org ingestion tokens
  list_org_ingestion_tokens: (orgIdentifier: string) => {
    return http().get(`/api/${orgIdentifier}/ingestion-tokens`);
  },
  create_org_ingestion_token: (
    orgIdentifier: string,
    data: { name: string; description?: string },
  ) => {
    return http().post(`/api/${orgIdentifier}/ingestion-tokens`, data);
  },
  enable_disable_org_ingestion_token: (orgIdentifier: string, name: string, enabled: boolean) => {
    return http().patch(`/api/${orgIdentifier}/ingestion-tokens/${encodeURIComponent(name)}`, {
      enabled,
    });
  },
};

export default organizations;

const ALL_ORGS = 100000;

/** Re-read on every org switch by MainLayout, and again by the settings pages. */
export const orgSettingsQuery = defineQuery<[], any>({
  key: ["organizations", "settings"],
  fetch: async (org) => (await organizations.get_organization_settings(org)).data,
  staleTime: CONFIG_STALE_TIME,
  gcTime: LONG_GC_TIME,
  persister: localStoragePersister,
  scope: ["organizations", "settings"],
});

export const orgListQuery = defineQuery<[], any[]>({
  key: ["organizations", "list"],
  fetch: async (org) =>
    (await organizations.os_list(0, ALL_ORGS, "id", false, "", org)).data?.data ?? [],
  staleTime: CONFIG_STALE_TIME,
  gcTime: LONG_GC_TIME,
  persister: localStoragePersister,
  scope: ["organizations", "list"],
});

/** Shared by the Usage tab and the route guard, which runs on every navigation. */
export const orgSummaryQuery = defineQuery<[], any>({
  key: ["organizations", "summary"],
  fetch: async (org) => (await organizations.get_organization_summary(org)).data,
  refetchOnWindowFocus: true,
  scope: ["organizations", "summary"],
});

export const cleanupTasksQuery = defineQuery<[targetOrg: string], any[]>({
  key: (targetOrg) => ["organizations", "cleanupTasks", targetOrg],
  // A failed poll must not surface an error; the next tick retries.
  fetch: (_org, targetOrg) =>
    organizations
      .get_cleanup_tasks(targetOrg)
      .then((res: any) => res.data ?? [])
      .catch(() => []),
  staleTime: 0,
  gcTime: 60_000,
  refetchOnWindowFocus: true,
  scope: ["organizations", "cleanupTasks"],
});

// ── Credentials: persistence pinned off on the query itself ─────────────────
// These are org configuration by shape and would otherwise reach localStorage.
// The override is what keeps a token off disk, so it must survive a re-tiering.

export const ingestionTokensQuery = defineQuery<[], any>({
  key: ["organizations", "ingestionTokens"],
  fetch: async (org) => (await organizations.list_org_ingestion_tokens(org)).data,
  refetchOnWindowFocus: true,
  scope: ["organizations", "ingestionTokens"],
});

export const orgPasscodeQuery = defineQuery<[], any>({
  key: ["organizations", "passcode"],
  fetch: async (org) => (await organizations.get_organization_passcode(org)).data,
  refetchOnWindowFocus: true,
  scope: ["organizations", "passcode"],
});
