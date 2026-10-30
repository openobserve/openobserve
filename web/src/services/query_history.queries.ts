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

import { infiniteQueryOptions, mutationOptions, queryOptions } from "@tanstack/vue-query";
import queryHistory, {
  type QueryHistoryClearParams,
  type QueryHistoryEntry,
  type QueryHistoryListParams,
  type QueryHistoryRecordBody,
} from "./query_history";
import { queryHistoryKeys } from "./query_history.querykeys";
import { LIVE_STALE_TIME, MEDIUM_STALE_TIME } from "@/composables/query/cachePolicy";
import { queryClient } from "@/composables/query/queryClient";
import { POPOVER_ROWS } from "@/utils/queryHistory/recentSearches";

export const QUERY_HISTORY_PAGE_SIZE = 50;
/** The quick list holds its successful rows plus the newest run, which is pinned when it failed. */
const RECENT_SEARCHES_CACHED_ROWS = POPOVER_ROWS + 1;

const rowsOf = (data: unknown): QueryHistoryEntry[] =>
  Array.isArray(data) ? (data as QueryHistoryEntry[]) : [];

export const queryHistoryQuery = (org: string, filters: QueryHistoryListParams) =>
  infiniteQueryOptions({
    queryKey: queryHistoryKeys.list(org, filters),
    queryFn: async ({ pageParam }): Promise<QueryHistoryEntry[]> => {
      const res = await queryHistory.list(org, {
        ...filters,
        limit: QUERY_HISTORY_PAGE_SIZE,
        offset: pageParam,
      });
      return rowsOf(res.data);
    },
    initialPageParam: 0,
    // A short page is the last one.
    getNextPageParam: (last, pages) =>
      last.length < QUERY_HISTORY_PAGE_SIZE ? undefined : pages.length * QUERY_HISTORY_PAGE_SIZE,
    staleTime: MEDIUM_STALE_TIME,
  });

// Only the rows the list shows: each entry carries its context, up to 64 KB.
export const recentSearchesQuery = (org: string, source: string) =>
  queryOptions({
    queryKey: queryHistoryKeys.recent(org, source),
    queryFn: async (): Promise<QueryHistoryEntry[]> => {
      const [ok, newest] = await Promise.all([
        queryHistory.list(org, { source, status: "ok", limit: POPOVER_ROWS }),
        queryHistory.list(org, { source, limit: 1 }),
      ]);
      const rows = [...rowsOf(newest.data), ...rowsOf(ok.data)];
      return rows.filter((row, i) => rows.findIndex((r) => r.id === row.id) === i);
    },
    staleTime: LIVE_STALE_TIME,
  });

/** Failed runs of one page, for the quick list's "N failed" link. */
export const recentFailedCountQuery = (org: string, source: string) =>
  queryOptions({
    queryKey: queryHistoryKeys.list(org, { source, status: "error", count_only: true }),
    queryFn: async (): Promise<number> => {
      const res = await queryHistory.count(org, { source, status: "error" });
      return Number(res.data?.count ?? 0);
    },
    staleTime: LIVE_STALE_TIME,
  });

/** How many entries a clear would delete, counted by the server. */
export const queryHistoryCountQuery = (org: string, source: string, starred: boolean) =>
  queryOptions({
    queryKey: queryHistoryKeys.list(org, { source, starred, count_only: true }),
    queryFn: async (): Promise<number> => {
      const res = await queryHistory.count(org, { source, starred });
      return Number(res.data?.count ?? 0);
    },
    staleTime: 0,
  });

const isEntry = (data: unknown): data is QueryHistoryEntry =>
  !!data && typeof data === "object" && typeof (data as QueryHistoryEntry).id === "string";

// Never toasted: a failed record must not disturb the run it belongs to.
export const recordQueryHistoryMutation = (org: string) =>
  mutationOptions({
    mutationFn: (body: QueryHistoryRecordBody) => queryHistory.record(org, body),
    // The editor's autocomplete keeps its list loaded, so the stored run goes straight into it instead of a refetch.
    onSuccess: (res) => {
      const entry: unknown = res?.data;
      if (!isEntry(entry)) return;
      queryClient.setQueryData<QueryHistoryEntry[]>(
        queryHistoryKeys.recent(org, entry.source),
        (rows) =>
          rows &&
          [entry, ...rows.filter((r) => r.id !== entry.id)].slice(0, RECENT_SEARCHES_CACHED_ROWS),
      );
    },
    // Marked stale, not refetched: a list in use refetches when it next opens, not on every run.
    meta: { stales: [queryHistoryKeys.all(org)], silentError: true },
  });

export const starQueryHistoryMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { id: string; starred: boolean }) =>
      queryHistory.star(org, vars.id, vars.starred),
    meta: { invalidates: [queryHistoryKeys.all(org)] },
  });

// The org travels with the call: an Undo-able delete commits after the user may have switched org.
export const deleteQueryHistoryMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { org: string; id: string }) => queryHistory.remove(vars.org, vars.id),
    meta: { invalidates: [queryHistoryKeys.all(org)] },
  });

export const clearQueryHistoryMutation = (org: string) =>
  mutationOptions({
    mutationFn: (params: QueryHistoryClearParams) => queryHistory.clear(org, params),
    meta: { invalidates: [queryHistoryKeys.all(org)] },
  });
