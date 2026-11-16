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
import { useStore } from "vuex";
import { useQuery } from "@tanstack/vue-query";
import { LIVE_STALE_TIME } from "@/composables/query/cachePolicy";
import { autoobserveKeys } from "@/services/autoobserve.querykeys";
import autoobserveVolume, { VOLUME_MAX_IDS } from "@/services/autoobserveVolume";
import { baselineStates, volumeId, type IssueBaselineState } from "./issueBaseline";
import type { IssueStream, IssueWindow } from "./issueSeries";

// A server without the route answers 404 or 405 for good, so that answer is cached as "no usual level".
const UNAVAILABLE = [404, 405];

const statusOf = (error: unknown): number | null =>
  (error as { response?: { status?: number } } | null)?.response?.status ?? null;

/** The engine's usual level for up to 50 streams over one incident window, in one request. */
export const useAoVolumeSeries = (
  streams: MaybeRefOrGetter<IssueStream[]>,
  window: MaybeRefOrGetter<IssueWindow | null>,
) => {
  const store = useStore();
  const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
  const asked = computed(() => toValue(streams).slice(0, VOLUME_MAX_IDS));
  const ids = computed(() => asked.value.map(volumeId));
  const query = useQuery(() => {
    const w = toValue(window);
    return {
      queryKey: autoobserveKeys.volumeSeries(
        org.value,
        ids.value.join(","),
        w?.startMs ?? 0,
        w?.endMs ?? 0,
      ),
      queryFn: async () => {
        try {
          return (
            await autoobserveVolume.streams(
              org.value,
              ids.value,
              w!.startMs * 1000,
              w!.endMs * 1000,
            )
          ).data;
        } catch (e) {
          if (UNAVAILABLE.includes(statusOf(e) ?? 0)) return null;
          throw e;
        }
      },
      enabled: !!org.value && !!w && ids.value.length > 0,
      staleTime: w?.fixed ? Infinity : LIVE_STALE_TIME,
      retry: false,
    };
  });

  const states = computed(() => {
    const out = new Map<string, IssueBaselineState>();
    if (!toValue(window) || !asked.value.length) return out;
    if (query.isError.value) {
      const kind = statusOf(query.error.value) === 403 ? "denied" : "failed";
      for (const id of ids.value) out.set(id, { kind });
      return out;
    }
    const data = query.data.value;
    if (data === null) {
      for (const id of ids.value) out.set(id, { kind: "unavailable" });
      return out;
    }
    if (!data) {
      for (const id of ids.value) out.set(id, { kind: "loading" });
      return out;
    }
    return baselineStates(asked.value, data);
  });

  return {
    stateOf: (s: IssueStream | null): IssueBaselineState =>
      (s && states.value.get(volumeId(s))) || { kind: "unavailable" },
    retry: () => void query.refetch(),
  };
};
