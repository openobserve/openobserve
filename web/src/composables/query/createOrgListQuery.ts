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
 * Every client-paginated list page in the app is the same query: one org-scoped
 * GET returning the whole list. This turns that shape into one declaration —
 * a `use*` composable for setup contexts, and an imperative `fetch*` /
 * `refetch*` / `invalidate*` trio for the loaders that are not in one.
 */

import { queryClient } from "./queryClient";
import { tierOptions } from "./tiers";
import type { TierName, TierOverrides } from "./tiers";
import { useOrgQuery } from "./useOrgQuery";

export interface OrgListQueryConfig<TRow, TArgs extends unknown[]> {
  /** Built from `qk.*`. */
  key: (org: string, ...args: TArgs) => readonly unknown[];
  fetch: (org: string, ...args: TArgs) => Promise<TRow[]>;
  tier: TierName;
  /** Prefix invalidated by the mutation helpers — defaults to this list's key. */
  root?: (org: string) => readonly unknown[];
  persist?: TierOverrides["persist"];
}

export function createOrgListQuery<TRow, TArgs extends unknown[] = []>(
  config: OrgListQueryConfig<TRow, TArgs>,
) {
  const options = (org: string, ...args: TArgs) => ({
    queryKey: config.key(org, ...args),
    queryFn: () => config.fetch(org, ...args),
    ...tierOptions(config.tier, { persist: config.persist }),
  });

  /** Cached read: a hit inside the tier's staleTime issues no request. */
  const fetchList = (org: string, ...args: TArgs): Promise<TRow[]> =>
    queryClient.fetchQuery(options(org, ...args));

  /** Bypasses staleTime — for an explicit "Refresh" button. */
  const refetchList = (org: string, ...args: TArgs): Promise<TRow[]> =>
    queryClient.fetchQuery({ ...options(org, ...args), staleTime: 0 });

  /** Call after any write; the next read then goes to the server. */
  const invalidateList = (org: string) =>
    queryClient.invalidateQueries({ queryKey: (config.root ?? config.key)(org) });

  /**
   * Drop inactive entries outright. Use after a delete: invalidation alone
   * leaves the deleted entity cached and ready to serve the next reader.
   */
  const removeList = (org: string) =>
    queryClient.removeQueries({
      queryKey: (config.root ?? config.key)(org),
      type: "inactive",
    });

  const useList = (...args: TArgs) =>
    useOrgQuery<TRow[]>({
      key: (org) => config.key(org, ...args),
      fetch: (org) => config.fetch(org, ...args),
      tier: config.tier,
      persist: config.persist,
    });

  return { options, fetchList, refetchList, invalidateList, removeList, useList };
}

export default createOrgListQuery;
