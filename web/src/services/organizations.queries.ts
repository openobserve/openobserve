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

import { mutationOptions, queryOptions } from "@tanstack/vue-query";
import organizations from "./organizations";
import { organizationKeys } from "./organizations.querykeys";
import { CONFIG_STALE_TIME, LONG_GC_TIME } from "@/composables/query/cachePolicy";

// Memory only: settings pages post this object back whole, so a disk copy could overwrite newer server values.
export const orgSettingsQuery = (org: string) =>
  queryOptions({
    queryKey: organizationKeys.settings(org),
    queryFn: async () => (await organizations.get_organization_settings(org)).data,
    staleTime: CONFIG_STALE_TIME,
    gcTime: LONG_GC_TIME,
  });

export const orgSummaryQuery = (org: string) =>
  queryOptions({
    queryKey: organizationKeys.summary(org),
    queryFn: async () => (await organizations.get_organization_summary(org)).data,
    refetchOnWindowFocus: true,
  });

// `metaOrg` is the org that serves the endpoint, not the one being cleaned up — it is deployment-configurable, so the caller reads it from config.
export const cleanupTasksQuery = (org: string, targetOrg: string, metaOrg = "_meta") =>
  queryOptions({
    queryKey: organizationKeys.cleanupTasks(org, targetOrg),
    // A failed poll must not surface an error; the next tick retries.
    queryFn: (): Promise<any[]> =>
      organizations
        .get_cleanup_tasks(metaOrg, targetOrg)
        .then((res: any) => res.data ?? [])
        .catch(() => []),
    staleTime: 0,
    gcTime: 60_000,
    refetchOnWindowFocus: true,
  });

export const ingestionTokensQuery = (org: string) =>
  queryOptions({
    queryKey: organizationKeys.ingestionTokens(org),
    queryFn: async () => (await organizations.list_org_ingestion_tokens(org)).data,
    refetchOnWindowFocus: true,
  });

export const orgPasscodeQuery = (org: string) =>
  queryOptions({
    queryKey: organizationKeys.passcode(org),
    queryFn: async () => (await organizations.get_organization_passcode(org)).data,
    refetchOnWindowFocus: true,
  });

// ── Writes ──────────────────────────────────────────────────────────────────

export const createIngestionTokenMutation = (org: string) =>
  mutationOptions({
    mutationFn: (data: { name: string; description?: string }) =>
      organizations.create_org_ingestion_token(org, data),
    meta: { invalidates: [organizationKeys.ingestionTokens(org)], silentError: true },
  });

export const setIngestionTokenEnabledMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { name: string; enabled: boolean }) =>
      organizations.enable_disable_org_ingestion_token(org, vars.name, vars.enabled),
    meta: { invalidates: [organizationKeys.ingestionTokens(org)], silentError: true },
  });

export const resetPasscodeMutation = (org: string) =>
  mutationOptions({
    mutationFn: () => organizations.update_organization_passcode(org),
    meta: { invalidates: [organizationKeys.passcode(org)], silentError: true },
  });

/** Four call sites write this, and MainLayout re-reads the scope on every org switch. */
export const updateOrgSettingsMutation = (org: string) =>
  mutationOptions({
    // Not the selected org: domain management writes the meta org.
    mutationFn: (payload: any) => organizations.post_organization_settings(org, payload),
    // Every call site renders its own success and failure toasts.
    meta: { invalidates: [organizationKeys.settings(org)], silentError: true },
  });
