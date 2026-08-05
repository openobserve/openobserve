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

import { computed, toValue } from "vue";
import type { MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { queryClient } from "./queryClient";
import { useStore } from "vuex";
import { tierOptions } from "./tiers";
import type { TierName, TierOverrides } from "./tiers";

/** The active organization identifier, as a computed the query keys can track. */
export const useOrgId = () => {
  const store = useStore();
  return computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
};

export interface OrgQueryOptions<TData, TSelected = TData> {
  /** Built from `qk.*` — never an inline array literal. */
  key: (org: string) => readonly unknown[];
  fetch: (org: string) => Promise<TData>;
  tier: TierName;
  /** Extra gate on top of "an org is selected". */
  enabled?: MaybeRefOrGetter<boolean>;
  select?: (data: TData) => TSelected;
  /** Poll interval in ms — replaces hand-rolled `setInterval` fetch loops. */
  refetchInterval?: MaybeRefOrGetter<number | false>;
  placeholderData?: unknown;
  /** Force persistence off (secrets) or on. Defaults to the tier's policy. */
  persist?: TierOverrides["persist"];
}

/**
 * The standard org-scoped read. Replaces the fetch-on-mount + `loading` ref +
 * try/catch + hand-rolled Vuex cache + post-await race guard pattern: the org
 * and any server-applied filter live in the key, so switching either switches
 * the cache entry instead of racing.
 */
export function useOrgQuery<TData, TSelected = TData>(opts: OrgQueryOptions<TData, TSelected>) {
  const org = useOrgId();

  return useQuery(
    {
      queryKey: computed(() => opts.key(org.value)),
      queryFn: () => opts.fetch(org.value),
      enabled: computed(() => !!org.value && (toValue(opts.enabled) ?? true)),
      select: opts.select,
      refetchInterval: opts.refetchInterval as never,
      placeholderData: opts.placeholderData as never,
      ...tierOptions(opts.tier, { persist: opts.persist }),
      // Passed explicitly rather than injected: the app has one client, and this
      // keeps component tests working without installing the plugin per spec.
    },
    queryClient,
  );
}

export default useOrgQuery;
