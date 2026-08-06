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

/**
 * Org-level metadata read by the app shell: the org's own settings, the list
 * of orgs for the header selector, and the cluster node list.
 */

import organizationsService from "@/services/organizations";
import commonService from "@/services/common";
import licenseServer from "@/services/license_server";
import { GLOBAL_SCOPE, qk } from "../queryKeys";
import { tierOptions } from "../tiers";
import { queryClient } from "../queryClient";

/** Every consumer asks for the whole list and pages it in the browser. */
const ALL = 100000;

// ── Org settings ────────────────────────────────────────────────────────────
// Re-read on every org switch by MainLayout, and again by the settings pages.

const orgSettingsOptions = (org: string) => ({
  queryKey: qk.organizations.settings(org),
  queryFn: async (): Promise<any> =>
    (await organizationsService.get_organization_settings(org)).data,
  ...tierOptions("ORG_CONFIG"),
});

export const fetchOrgSettings = (org: string): Promise<any> =>
  queryClient.fetchQuery(orgSettingsOptions(org));

export const refetchOrgSettings = (org: string): Promise<any> =>
  queryClient.fetchQuery({ ...orgSettingsOptions(org), staleTime: 0 });

export const invalidateOrgSettings = (org: string) =>
  queryClient.invalidateQueries({ queryKey: qk.organizations.settings(org) });

// ── Organization list (header selector) ─────────────────────────────────────
// Keyed under the *requesting* org so the org-switch purge can find it, but the
// payload is the user's whole org list.

const orgListOptions = (org: string) => ({
  queryKey: qk.organizations.list(org),
  queryFn: async (): Promise<any[]> =>
    (await organizationsService.os_list(0, ALL, "id", false, "", org)).data?.data ?? [],
  ...tierOptions("ORG_CONFIG"),
});

export const fetchOrgList = (org: string): Promise<any[]> =>
  queryClient.fetchQuery(orgListOptions(org));

export const refetchOrgList = (org: string): Promise<any[]> =>
  queryClient.fetchQuery({ ...orgListOptions(org), staleTime: 0 });

export const invalidateOrgList = (org: string) =>
  queryClient.invalidateQueries({ queryKey: qk.organizations.root(org) });

// ── Cluster nodes ───────────────────────────────────────────────────────────

const nodesOptions = (org: string) => ({
  queryKey: qk.settings.nodes(org),
  queryFn: async (): Promise<any> => (await commonService.list_nodes(org)).data,
  // Topology is stable within a session but not worth persisting — it is a
  // single settings page, and stale cluster state is more confusing than a
  // second of loading.
  ...tierOptions("ORG_CONFIG", { persist: "none" }),
});

export const fetchNodes = (org: string): Promise<any> => queryClient.fetchQuery(nodesOptions(org));

export const refetchNodes = (org: string): Promise<any> =>
  queryClient.fetchQuery({ ...nodesOptions(org), staleTime: 0 });

// ── License ─────────────────────────────────────────────────────────────────
// Read by the settings page and the upgrade dialog.
//
// VOLATILE, not SESSION_STATIC as the inventory first proposed: the payload
// carries live ingestion-usage counters, and the key can be replaced from the
// settings page. Anything longer than staleTime 0 would freeze the usage bars
// and show the old entitlement straight after an update. At this tier the win
// is in-flight dedup between the two callers, which is all that was on offer.
const licenseOptions = () => ({
  queryKey: [...qk.org(GLOBAL_SCOPE), "license"] as const,
  queryFn: async (): Promise<any> => (await licenseServer.get_license()).data,
  ...tierOptions("VOLATILE"),
});

export const fetchLicense = (): Promise<any> => queryClient.fetchQuery(licenseOptions());

export const refetchLicense = (): Promise<any> =>
  queryClient.fetchQuery({ ...licenseOptions(), staleTime: 0 });
