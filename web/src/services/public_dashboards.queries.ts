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
import admin, { type PublicLink, type PublicLinkConfig } from "./public_dashboards_admin";
import { publicLinkKeys } from "./public_dashboards.querykeys";
import { NORMAL_STALE_TIME } from "@/composables/query/cachePolicy";

export const publicLinksForDashboardQuery = (org: string, dashboardId: string) =>
  queryOptions({
    queryKey: publicLinkKeys.byDashboard(org, dashboardId),
    queryFn: async (): Promise<PublicLink[]> =>
      (await admin.list(org, dashboardId)).data?.list ?? [],
    staleTime: NORMAL_STALE_TIME,
  });

export const publicLinksListQuery = (org: string) =>
  queryOptions({
    queryKey: publicLinkKeys.org(org),
    queryFn: async (): Promise<PublicLink[]> => (await admin.listOrg(org)).data?.list ?? [],
    staleTime: NORMAL_STALE_TIME,
  });

// ── Writes ──────────────────────────────────────────────────────────────────
// Every write drops both the dashboard's list and the org-wide list; callers compose their own toasts.

export const savePublicLinkMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (vars: {
      dashboardId: string;
      linkId?: string;
      config: PublicLinkConfig;
    }): Promise<PublicLink> =>
      (vars.linkId
        ? await admin.update(org, vars.dashboardId, vars.linkId, vars.config)
        : await admin.create(org, vars.dashboardId, vars.config)
      ).data,
    meta: { invalidates: [publicLinkKeys.all(org)], silentError: true },
  });

export const setPublicLinkPausedMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (vars: { link: PublicLink; paused: boolean }): Promise<PublicLink> =>
      (vars.paused
        ? await admin.pause(org, vars.link.dashboard_id, vars.link.id)
        : await admin.resume(org, vars.link.dashboard_id, vars.link.id)
      ).data,
    meta: { invalidates: [publicLinkKeys.all(org)], silentError: true },
  });

export const rebuildPublicLinkMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (link: PublicLink): Promise<PublicLink> =>
      (await admin.rebuild(org, link.dashboard_id, link.id)).data,
    meta: { invalidates: [publicLinkKeys.all(org)], silentError: true },
  });

export const revokePublicLinkMutation = (org: string) =>
  mutationOptions({
    mutationFn: (link: PublicLink) => admin.revoke(org, link.dashboard_id, link.id),
    meta: { invalidates: [publicLinkKeys.all(org)], silentError: true },
  });
