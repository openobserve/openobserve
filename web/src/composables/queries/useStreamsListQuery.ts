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

import { computed, type Ref } from "vue";
import { useQuery, keepPreviousData } from "@tanstack/vue-query";
import { useStore } from "vuex";
import StreamService from "@/services/stream";
import { streamKeys } from "./streamKeys";

export interface StreamListParams {
  type: Ref<string>;
  offset: Ref<number>;
  limit: Ref<number>;
  keyword: Ref<string>;
  sort: Ref<string>;
  asc: Ref<boolean>;
}

export interface StreamListResult {
  list: any[];
  total: number;
}

/**
 * Server-paginated streams list backed by TanStack Query.
 *
 * The query key is reactive: when any param ref changes (page, size, sort,
 * filter, stream type, or org) the query re-runs and caches the result for
 * that exact combination. Revisiting a cached combo within `staleTime` is
 * instant; a stale combo serves cache immediately and refetches in the
 * background (stale-while-revalidate).
 */
export function useStreamsListQuery(params: StreamListParams) {
  const store = useStore();

  const org = computed(
    () => store.state.selectedOrganization?.identifier as string,
  );

  const queryKey = computed(() =>
    streamKeys.list(org.value, {
      type: params.type.value,
      offset: params.offset.value,
      limit: params.limit.value,
      keyword: params.keyword.value,
      sort: params.sort.value,
      asc: params.asc.value,
    }),
  );

  return useQuery<StreamListResult>({
    queryKey,
    queryFn: async () => {
      const res: any = await StreamService.nameList(
        org.value,
        // The list never fetches "all" as a single request — it always
        // targets a concrete type. Guard the "all" sentinel just in case.
        params.type.value === "all" ? "" : params.type.value,
        false, // schema — never fetched in the list view
        params.offset.value,
        params.limit.value,
        params.keyword.value,
        params.sort.value,
        params.asc.value,
      );
      return {
        list: res.data.list ?? [],
        total: res.data.total ?? 0,
      };
    },
    // Don't fire until an org is selected.
    enabled: computed(() => !!org.value),
    staleTime: 30_000,
    // Keep the previous page's rows visible while the next page loads.
    placeholderData: keepPreviousData,
  });
}

export default useStreamsListQuery;
