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

import { detectedStream } from "@/composables/firstEvent/useFirstDataNotice";
import { EMPTY_LIST_STALE_TIME } from "@/composables/query/cachePolicy";
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
const userDataIn = (lists: (ListedStream[] | undefined)[], settled: boolean, org: string) => {
  const users = lists.map((list, i) => userStreams(list, USER_DATA_STREAM_TYPES[i]));
  if (users.some((list) => list.some(hasRecords))) return true;
  // stats wait for the first flush, so a stream a setup page saw its first record reach settles it sooner, while it is listed
  const seen = detectedStream(org);
  const seenListed = users.some(
    (list, i) => USER_DATA_STREAM_TYPES[i] === seen?.type && list.some((s) => s.name === seen.name),
  );
  if (seenListed) return true;
  if (users.some((list) => list.length > 0)) return undefined;
  return settled ? false : undefined;
};

/**
 * Whether the org holds data the user sent: a logs, metrics or traces stream that O2 does not
 * write itself, that is not a synthetic-check result, and whose stats show records, or whose first
 * record a setup page saw arrive. `undefined` while the lists load, or while its streams have no
 * stats yet (stats count flushed files only).
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
      // While the org has no data a later mount asks again, as data can arrive with nothing watching.
      return Object.assign(options, {
        enabled: !!toValue(org),
        staleTime: () => (cachedData() ? usual : EMPTY_LIST_STALE_TIME),
      });
    }),
  );
  const hasUserData = computed<boolean | undefined>(() =>
    userDataIn(
      queries.map((q) => q.data.value),
      queries.every((q) => q.isSuccess.value),
      toValue(org),
    ),
  );
  // Any stream at all, O2's own and synthetics included: an org with one has something to search.
  const hasStreams = (picked: typeof queries) =>
    computed<boolean | undefined>(() => {
      if (picked.some((q) => (q.data.value ?? []).length > 0)) return true;
      return picked.every((q) => q.isSuccess.value) ? false : undefined;
    });
  // a stale cached answer shows while it refetches; callers that decide once wait for this to clear
  const isFetching = computed(() => queries.some((q) => q.isFetching.value));
  return {
    hasUserData,
    isFetching,
    hasAnyStream: hasStreams(queries),
    hasLogsStream: hasStreams([queries[USER_DATA_STREAM_TYPES.indexOf("logs")]]),
  };
}

/** `useOrgHasUserData`'s answer, read once outside a component; undefined when a list fails. */
export async function orgHasUserData(org: string | undefined): Promise<boolean | undefined> {
  if (!org) return undefined;
  try {
    const lists = await Promise.all(
      USER_DATA_STREAM_TYPES.map((type) => queryClient.fetchQuery(streamNameListQuery(org, type))),
    );
    return userDataIn(lists, true, org);
  } catch {
    return undefined;
  }
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
