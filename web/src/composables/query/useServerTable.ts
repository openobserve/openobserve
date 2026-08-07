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

import { computed, onScopeDispose, ref, watch } from "vue";
import type { Ref } from "vue";
import { keepPreviousData, useQuery } from "@tanstack/vue-query";
import { queryClient } from "./queryClient";
import { tierOptions } from "./tiers";
import type { TierName } from "./tiers";
import { useOrgId } from "./useOrgId";

/** The page/sort/filter state a server-paginated endpoint is keyed on. */
export interface ServerTableParams {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  filter?: string;
  [key: string]: unknown;
}

/**
 * Debounced mirror of `source`. Local rather than from a utility library
 * because the only consumer is the server-filter box below.
 */
const useDebounced = <T>(source: Ref<T>, delayMs: number): Ref<T> => {
  const debounced = ref(source.value) as Ref<T>;
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(source, (value) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      debounced.value = value;
    }, delayMs);
  });
  onScopeDispose(() => {
    if (timer) clearTimeout(timer);
  });
  return debounced;
};

export interface ServerTableResult<T> {
  rows: T[];
  total: number;
}

export interface ServerTableOptions<T> {
  key: (org: string, params: ServerTableParams) => readonly unknown[];
  fetch: (org: string, params: ServerTableParams) => Promise<ServerTableResult<T>>;
  tier?: TierName;
  initialPage?: number;
  initialPageSize?: number;
  initialSort?: { by: string; order: "asc" | "desc" };
  /** Applied to the text filter only, before it enters the key. */
  debounceMs?: number;
  /** Extra server-applied params (status tabs, time range) merged into the key. */
  extraParams?: () => Record<string, unknown>;
  enabled?: () => boolean;
  /** Off for endpoints where an extra request per page is too expensive. */
  prefetchNext?: boolean;
}

/**
 * Server pagination + server filter + server sort, bound straight onto
 * `OTable`'s server props. `keepPreviousData` is not optional here — it is the
 * fix for the table blanking on every page change.
 */
export function useServerTable<T>(opts: ServerTableOptions<T>) {
  const org = useOrgId();

  const page = ref(opts.initialPage ?? 1);
  const pageSize = ref(opts.initialPageSize ?? 25);
  const filter = ref("");
  const sortBy = ref(opts.initialSort?.by ?? "");
  const sortOrder = ref<"asc" | "desc">(opts.initialSort?.order ?? "desc");

  const debouncedFilter = useDebounced(filter, opts.debounceMs ?? 300);

  const paramsFor = (pageNum: number): ServerTableParams => ({
    page: pageNum,
    pageSize: pageSize.value,
    filter: debouncedFilter.value || undefined,
    sortBy: sortBy.value || undefined,
    sortOrder: sortBy.value ? sortOrder.value : undefined,
    ...(opts.extraParams?.() ?? {}),
  });

  const params = computed(() => paramsFor(page.value));

  const query = useQuery(
    {
      queryKey: computed(() => opts.key(org.value, params.value)),
      queryFn: () => opts.fetch(org.value, params.value),
      enabled: computed(() => !!org.value && (opts.enabled?.() ?? true)),
      placeholderData: keepPreviousData,
      ...tierOptions(opts.tier ?? "ENTITY_LIST"),
    },
    queryClient,
  );

  const total = computed(() => query.data.value?.total ?? 0);
  const rows = computed<T[]>(() => query.data.value?.rows ?? []);
  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

  // Warm page N+1 once the current page has settled, so paging forward is a
  // cache hit rather than a request.
  if (opts.prefetchNext !== false) {
    watch(
      () => [query.isFetching.value, page.value, total.value] as const,
      ([fetching]) => {
        if (fetching || !org.value) return;
        if (page.value >= pageCount.value) return;
        const nextParams = paramsFor(page.value + 1);
        void queryClient.prefetchQuery({
          queryKey: opts.key(org.value, nextParams),
          queryFn: () => opts.fetch(org.value, nextParams),
          ...tierOptions(opts.tier ?? "ENTITY_LIST"),
        });
      },
    );
  }

  // Any change to what the server is filtering or sorting on invalidates the
  // current page number.
  watch([debouncedFilter, pageSize, sortBy, sortOrder], () => {
    page.value = 1;
  });

  return {
    page,
    pageSize,
    filter,
    sortBy,
    sortOrder,
    rows,
    total,
    pageCount,
    ...query,
  };
}

export default useServerTable;
