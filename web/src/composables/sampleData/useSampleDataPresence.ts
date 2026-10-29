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
import { useQuery } from "@tanstack/vue-query";
import { streamNameListQuery } from "@/services/stream.queries";
import { USER_DATA_STREAM_TYPES, userDataStreams } from "@/utils/internalStreams";
import { isSampleStreamName } from "@/utils/sampleData/catalog";

/** Whether an org holds sample streams, streams of its own, or both. */
export const useSampleDataPresence = (
  org: Ref<string>,
  enabled: Ref<boolean> = computed(() => true),
) => {
  const lists = USER_DATA_STREAM_TYPES.map((type) =>
    useQuery(
      computed(() => ({
        ...streamNameListQuery(org.value, type),
        enabled: !!org.value && enabled.value,
      })),
    ),
  );

  const names = computed(() =>
    lists.flatMap((q, i) =>
      userDataStreams(
        (q.data.value ?? []).map((s: { name?: string; stream_type?: string }) => ({
          name: s?.name ?? "",
          stream_type: s?.stream_type ?? USER_DATA_STREAM_TYPES[i],
        })),
      ).map((s) => s.name),
    ),
  );

  return {
    ready: computed(() => lists.every((q) => q.isSuccess.value)),
    hasSample: computed(() => names.value.some(isSampleStreamName)),
    hasRealData: computed(() => names.value.some((n) => !isSampleStreamName(n))),
  };
};
