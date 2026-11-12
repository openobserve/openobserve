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

import { ref, watch, type Ref } from "vue";
import { useStore } from "vuex";
import useStreams from "@/composables/useStreams";
import { inheritedRetentionDays } from "@/utils/dataRetention";

export interface StreamRef {
  name: string;
  type: string;
}

/** A listed stream's settings; null while it is not known. */
export type StreamLimitEntry = {
  type: string;
  settings?: { data_retention?: number; max_query_range?: number } | null;
} | null;

export interface StreamTimeLimits {
  /** Days the longest-kept stream keeps data; undefined when unknown or kept forever, so nothing greys. */
  retentionDays: number | undefined;
  /** Smallest query-range limit (hours) of the streams; 0 when none has one. */
  queryRangeRestrictionInHour: number;
}

/** The picker limits a page's streams put together; an unknown stream leaves retention unknown. */
export const combineStreamTimeLimits = (
  entries: StreamLimitEntry[],
  state: any,
): StreamTimeLimits => {
  const known = entries.filter((entry): entry is NonNullable<StreamLimitEntry> => !!entry);
  const globalLimit = Number(state?.zoConfig?.max_query_range ?? 0);
  const limits = known
    .map((entry) => Number(entry.settings?.max_query_range ?? 0) || globalLimit)
    .filter((hours) => hours > 0);
  const queryRangeRestrictionInHour = limits.length ? Math.min(...limits) : 0;
  if (!entries.length || known.length < entries.length) {
    return { retentionDays: undefined, queryRangeRestrictionInHour };
  }
  const days = known.map(
    (entry) =>
      Number(entry.settings?.data_retention ?? 0) || inheritedRetentionDays(state, entry.type),
  );
  const retentionDays = days.some((d) => !(d > 0)) ? undefined : Math.max(...days);
  return { retentionDays, queryRangeRestrictionInHour };
};

/** Reads the streams' settings from the stream cache and keeps their combined limits current. */
export const useStreamTimeLimits = (streams: () => StreamRef[]): Ref<StreamTimeLimits> => {
  const store = useStore();
  const { getStream } = useStreams();
  const limits = ref<StreamTimeLimits>({
    retentionDays: undefined,
    queryRangeRestrictionInHour: 0,
  });
  let request = 0;

  const load = async (list: StreamRef[]) => {
    const current = ++request;
    const entries = await Promise.all(
      list.map(async ({ name, type }): Promise<StreamLimitEntry> => {
        try {
          const stream = await getStream(name, type, false);
          return stream ? { type, settings: stream.settings } : null;
        } catch {
          return null;
        }
      }),
    );
    if (current !== request) return;
    limits.value = combineStreamTimeLimits(entries, store.state);
  };

  watch(
    () => JSON.stringify(streams().filter((item) => item.name && item.type)),
    (key) => void load(JSON.parse(key)),
    { immediate: true },
  );

  return limits;
};
