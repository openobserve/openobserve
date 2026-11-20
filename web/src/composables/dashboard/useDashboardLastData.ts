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
import { queryClient } from "@/composables/query/queryClient";
import { streamNameListQuery } from "@/services/stream.queries";

export interface DashboardStreamRef {
  name: string;
  type: string;
}

const FIFTEEN_MINS_US = 15 * 60 * 1_000_000;
// The backend end bound is exclusive, so the record at doc_time_max needs one more second.
const END_NUDGE_US = 1_000_000;

/** Streams the panels query, de-duplicated; custom and promql panels without a stream are skipped. */
export const collectDashboardStreams = (tabs: any[] | undefined): DashboardStreamRef[] => {
  const seen = new Map<string, DashboardStreamRef>();
  for (const tab of tabs ?? []) {
    for (const panel of tab?.panels ?? []) {
      for (const query of panel?.queries ?? []) {
        const name = query?.fields?.stream;
        if (!name) continue;
        const type = query?.fields?.stream_type || "logs";
        seen.set(`${type}/${name}`, { name, type });
      }
    }
  }
  return [...seen.values()];
};

/** The latest record time (µs) across the given streams, from the cached stream lists. */
export const fetchLatestDataTime = async (
  org: string,
  streams: DashboardStreamRef[],
): Promise<number | null> => {
  const types = [...new Set(streams.map((s) => s.type))];
  const lists = await Promise.all(
    types.map((type) =>
      queryClient
        .fetchQuery(streamNameListQuery(org, type))
        .then((list) => [type, list] as const)
        .catch(() => [type, [] as any[]] as const),
    ),
  );
  const byType = new Map(lists);
  let latest = 0;
  for (const { name, type } of streams) {
    const row = (byType.get(type) ?? []).find((s: any) => s.name === name);
    latest = Math.max(latest, Number(row?.stats?.doc_time_max ?? 0));
  }
  return latest > 0 ? latest : null;
};

/** The 15 minutes ending at the latest record, as picker bounds. */
export const latestDataWindow = (latestUs: number) => ({
  startTime: latestUs - FIFTEEN_MINS_US,
  endTime: latestUs + END_NUDGE_US,
});

/** Looks up the latest data time only while `enabled` is true, so a populated dashboard pays nothing. */
export const useDashboardLastData = (
  org: () => string,
  streams: () => DashboardStreamRef[],
  enabled: () => boolean,
): Ref<number | null> => {
  const latestUs = ref<number | null>(null);
  watch(
    enabled,
    async (on) => {
      if (!on) return;
      latestUs.value = await fetchLatestDataTime(org(), streams());
    },
    { immediate: true },
  );
  return latestUs;
};
