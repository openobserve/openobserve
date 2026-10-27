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

import { computed, type MaybeRefOrGetter, toValue } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";

import { queryClient } from "@/composables/query/queryClient";
import { streamNameListQuery } from "@/services/stream.queries";
import { streamKeys } from "@/services/stream.querykeys";
import { USER_DATA_STREAM_TYPES, isUserDataStream } from "@/utils/internalStreams";

type ListedStream = { name?: string; stats?: { doc_num?: number; doc_time_max?: number } };

const userStreams = (list: ListedStream[] | undefined, type: string) =>
  (list ?? []).filter(
    (s) => isUserDataStream(s?.name ?? "", type) && !(s?.name ?? "").startsWith("synthetics_"),
  );
const hasRecords = (s: ListedStream) =>
  Number(s.stats?.doc_num ?? 0) > 0 || Number(s.stats?.doc_time_max ?? 0) > 0;

/**
 * Whether the org holds data the user sent: a logs, metrics or traces stream that O2 does not
 * write itself, that is not a synthetic-check result, and whose stats show records. `undefined`
 * while the lists load, or while its streams have no stats yet (stats count flushed files only).
 */
export function useOrgHasUserData(org: MaybeRefOrGetter<string>) {
  const client = useQueryClient();
  const cachedData = () =>
    USER_DATA_STREAM_TYPES.some((type) =>
      userStreams(client.getQueryData(streamKeys.nameList(toValue(org), type)), type).some(
        hasRecords,
      ),
    );
  const queries = USER_DATA_STREAM_TYPES.map((type) =>
    useQuery(() => {
      const options = streamNameListQuery(toValue(org), type);
      const usual = options.staleTime as number;
      // While the org has no data, every mount asks again: data can arrive with nothing in the app watching.
      return Object.assign(options, {
        enabled: !!toValue(org),
        staleTime: () => (cachedData() ? usual : 0),
      });
    }),
  );
  const hasUserData = computed<boolean | undefined>(() => {
    const lists = queries.map((q, i) => userStreams(q.data.value, USER_DATA_STREAM_TYPES[i]));
    if (lists.some((list) => list.some(hasRecords))) return true;
    if (lists.some((list) => list.length > 0)) return undefined;
    return queries.every((q) => q.isSuccess.value) ? false : undefined;
  });
  // a stale cached answer shows while it refetches; callers that decide once wait for this to clear
  const isFetching = computed(() => queries.some((q) => q.isFetching.value));
  return { hasUserData, isFetching };
}

/**
 * Marks the org's logs, metrics and traces stream lists stale, after onboarding sees the first
 * data. The lists were cached while the org was empty, and the first-data watch refreshes only the
 * type it detected, so a data page opened next would read "no streams" from the cache.
 */
export async function refreshUserStreamLists(org: string): Promise<void> {
  if (!org) return;
  await Promise.all([
    ...USER_DATA_STREAM_TYPES.map((type) =>
      queryClient.invalidateQueries({ queryKey: streamKeys.nameList(org, type), exact: true }),
    ),
    queryClient.invalidateQueries({ queryKey: streamKeys.pagesAll(org) }),
  ]);
}
