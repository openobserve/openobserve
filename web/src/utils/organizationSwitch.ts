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

import { isNavigationFailure, type RouteLocationRaw, type Router } from "vue-router";
import type { Store } from "vuex";
import { orgSwitchListRoute, orgSwitchPending } from "@/utils/orgScopedRoutes";
import { useLocalOrganization } from "@/utils/zincutils";

export interface OrganizationSwitchContext {
  store: Store<any>;
  router: Router;
  /** `resetStreams` of the caller's `useStreams`. */
  resetStreams: () => void;
}

/**
 * Selects `org` and goes to `target`, or to the list of a page whose id belongs to the organization being left.
 * Resolves false when nothing changed. Every switch control calls this, so none can keep the old organization's cached data.
 */
export async function switchOrganization(
  { store, router, resetStreams }: OrganizationSwitchContext,
  org: { identifier?: string; [key: string]: unknown },
  target: RouteLocationRaw,
): Promise<boolean> {
  const { name, query } = router.currentRoute.value;
  const listRoute = orgSwitchListRoute(name, query);
  if (listRoute) {
    if (org.identifier === store.state.selectedOrganization?.identifier) return false;
    // Left before anything resets: the page's id is org-scoped and would fail to load in the new organization.
    orgSwitchPending.value = true;
    const failure = await router
      .replace({ name: listRoute, query: { org_identifier: org.identifier } })
      .finally(() => {
        orgSwitchPending.value = false;
      });
    // A page that refused the leave, such as a declined unsaved-changes prompt, keeps the user where they are.
    if (isNavigationFailure(failure)) return false;
  }
  resetStreams();
  store.dispatch("logs/resetLogs");
  store.dispatch("setIsDataIngested", false);
  if (!listRoute) void router.push(target);
  useLocalOrganization(org);
  store.dispatch("setSelectedOrganization", { ...org });
  return true;
}
