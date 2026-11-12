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
import { queryOptions, useQuery } from "@tanstack/vue-query";
import { queryClient } from "@/composables/query/queryClient";
import { streamNameListQuery } from "@/services/stream.queries";
import { streamKeys } from "@/services/stream.querykeys";
import {
  USER_DATA_STREAM_TYPES,
  isUserDataStream,
  type StreamOwnership,
} from "@/utils/internalStreams";
import { isSampleStreamName } from "@/utils/sampleData/catalog";

/** A stream the user or the sample load made: not written by O2 itself, and not a synthetic-check result. */
export const isOwnedStream = (stream: StreamOwnership, type: string) =>
  isUserDataStream(stream, type) && !(stream.name ?? "").startsWith("synthetics_");

// its own cache entry: the header reads on every page load, and that list must not stand in for a page's list later
const probeQuery = (org: string, type: string) =>
  queryOptions({ ...streamNameListQuery(org, type), queryKey: streamKeys.hasDataProbe(org, type) });

const userStreamNames = (list: StreamOwnership[] | undefined, type: string) =>
  (list ?? []).filter((s) => isOwnedStream(s, type)).map((s) => s.name ?? "");

/** True when the org has any logs, metrics or traces stream that O2 does not write itself. */
export const fetchHasUserStreams = async (org: string): Promise<boolean> => {
  const lists = await Promise.all(
    USER_DATA_STREAM_TYPES.map((type) => queryClient.fetchQuery(probeQuery(org, type))),
  );
  return lists.some((list, i) => userStreamNames(list, USER_DATA_STREAM_TYPES[i]).length > 0);
};

/** Whether an org holds sample streams, streams of its own, or both. */
export const useSampleDataPresence = (
  org: Ref<string>,
  enabled: Ref<boolean> = computed(() => true),
) => {
  const lists = USER_DATA_STREAM_TYPES.map((type) =>
    useQuery(
      computed(() =>
        Object.assign(probeQuery(org.value, type), {
          enabled: !!org.value && enabled.value,
        }),
      ),
    ),
  );

  const names = computed(() =>
    lists.flatMap((q, i) => userStreamNames(q.data.value, USER_DATA_STREAM_TYPES[i])),
  );

  return {
    ready: computed(() => lists.every((q) => q.isSuccess.value)),
    hasSample: computed(() => names.value.some(isSampleStreamName)),
    hasRealData: computed(() => names.value.some((n) => !isSampleStreamName(n))),
  };
};
