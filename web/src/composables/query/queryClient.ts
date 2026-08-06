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

import { QueryClient } from "@tanstack/vue-query";
import { purgeAllPersisted, purgePersistedOrg } from "./persisters";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Defaults exist only so a query without a tier is not wildly wrong —
      // every real query picks a tier from `tiers.ts`.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: (failureCount: number, err: any) => {
        const status = err?.response?.status;
        // 4xx are the caller's fault; retrying just multiplies the error toast.
        if (status === 400 || status === 401 || status === 403 || status === 404) return false;
        return failureCount < 2;
      },
      // Off by default: this console is often left open on a wall display and
      // several endpoints are expensive. Cheap volatile lists opt back in via
      // their tier.
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: { retry: false },
  },
});

/**
 * Called on org switch with the org being left. Drops that org's *persisted*
 * entries only — the in-memory ones stay.
 *
 * Keeping memory is safe because every key is rooted at ["org", id], so one
 * org's data can never be served to another, and gcTime collects it anyway.
 * The payoff is that switching back to a recent org inside its staleTime costs
 * no requests at all.
 *
 * Disk is different: localStorage is a ~5 MB budget shared with the whole app,
 * so persisting every org visited would eventually hit quota (silently — the
 * storage wrapper swallows it), and the previous tenant's stream, folder and
 * function names would sit on a possibly shared machine.
 */
export const purgeOrgQueries = (org: string): void => {
  if (!org) return;
  void purgePersistedOrg(org);
};

/** Called on logout: nothing from the previous session may survive. */
export const purgeAllQueries = (): void => {
  queryClient.clear();
  void purgeAllPersisted();
};
