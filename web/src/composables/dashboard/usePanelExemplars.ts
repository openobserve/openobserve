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

import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";
import { useStore } from "vuex";
import searchService from "@/services/search";
import { parseSearchError } from "@/utils/query/searchError";
import {
  exemplarQueryIndexes,
  type ExemplarPanelLike,
} from "@/utils/dashboard/exemplars/exemplarEligibility";
import { buildExemplarMarkers } from "@/utils/dashboard/exemplars/buildExemplarMarkers";
import type {
  ExemplarMarker,
  ExemplarQueryResult,
  ExemplarRequestMeta,
  ExemplarStatus,
  InjectedExemplars,
} from "@/ts/interfaces/exemplars";

interface QueryMetadata {
  query?: string;
  startTime?: number | string;
  endTime?: number | string;
}

interface PanelExemplarsArgs {
  panelSchema: Ref<ExemplarPanelLike | null | undefined>;
  metadata: Ref<{ queries?: QueryMetadata[] } | null | undefined>;
  enabled: Ref<boolean>;
  hiddenQueries: Ref<number[]>;
  injected: Ref<InjectedExemplars | undefined>;
  meta: Ref<ExemplarRequestMeta>;
}

interface FetchPlan {
  index: number;
  query: string;
  startUs: number;
  endUs: number;
}

/** Fetches, filters and dedupes a panel's exemplars; it never touches the series request. */
export function usePanelExemplars(args: PanelExemplarsArgs) {
  const { panelSchema, metadata, enabled, hiddenQueries, injected, meta } = args;
  const store = useStore();

  const status = ref<ExemplarStatus>("off");
  const markers = shallowRef<ExemplarMarker[]>([]);
  const errorMessage = ref("");
  let controller: AbortController | null = null;
  let generation = 0;

  // Null means "not ready": the executor fills metadata per query, and a partial plan would send a request twice.
  const plan = computed<FetchPlan[] | null>(() => {
    if (injected.value !== undefined || !enabled.value) return null;
    const indexes = exemplarQueryIndexes(panelSchema.value, hiddenQueries.value);
    if (!indexes.length) return null;
    const queries = metadata.value?.queries ?? [];
    const out: FetchPlan[] = [];
    for (const index of indexes) {
      const entry = queries[index];
      const startUs = Number(entry?.startTime);
      const endUs = Number(entry?.endTime);
      if (!entry?.query || !Number.isFinite(startUs) || !Number.isFinite(endUs)) return null;
      out.push({ index, query: entry.query, startUs, endUs });
    }
    return out;
  });

  const signature = computed(() => {
    if (injected.value !== undefined) return "injected";
    if (!enabled.value) return "off";
    return plan.value ? JSON.stringify(plan.value) : "off";
  });

  const abort = () => {
    generation++;
    controller?.abort();
    controller = null;
  };

  const fetchPlan = async (entries: FetchPlan[]) => {
    abort();
    const current = generation;
    const ctrl = new AbortController();
    controller = ctrl;
    markers.value = [];
    errorMessage.value = "";
    status.value = "loading";
    const org = store.state.selectedOrganization?.identifier;
    const settled = await Promise.allSettled(
      entries.map((entry) =>
        searchService
          .metrics_query_exemplars({
            org_identifier: org,
            query: entry.query,
            start_time: entry.startUs,
            end_time: entry.endUs,
            ...meta.value,
            signal: ctrl.signal,
          })
          .then((res): ExemplarQueryResult => ({
            queryIndex: entry.index,
            query: entry.query,
            response: res.data,
          })),
      ),
    );
    if (current !== generation) return;
    controller = null;
    const ok: ExemplarQueryResult[] = [];
    let firstError: unknown = null;
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") ok.push(outcome.value);
      else if (firstError === null) firstError = outcome.reason;
    }
    const startMs = Math.min(...entries.map((e) => e.startUs)) / 1000;
    const endMs = Math.max(...entries.map((e) => e.endUs)) / 1000;
    markers.value = buildExemplarMarkers(ok, { startMs, endMs });
    if (firstError !== null) {
      errorMessage.value = parseSearchError(firstError).message;
      status.value = "error";
      return;
    }
    status.value = markers.value.length ? "ready" : "empty";
  };

  const reset = (next: ExemplarStatus) => {
    abort();
    markers.value = [];
    errorMessage.value = "";
    status.value = next;
  };

  const sync = () => {
    const sig = signature.value;
    if (sig === "injected") {
      abort();
      const value = injected.value;
      markers.value = value?.markers ?? [];
      errorMessage.value = value?.errorMessage ?? "";
      status.value = value?.status ?? "off";
      return;
    }
    if (sig === "off" || !plan.value) return reset("off");
    void fetchPlan(plan.value);
  };

  watch(signature, sync, { immediate: true });
  watch(injected, () => signature.value === "injected" && sync(), { deep: true });

  const retry = () => {
    if (plan.value) void fetchPlan(plan.value);
  };

  onScopeDispose(abort);

  return { status, markers, errorMessage, retry };
}
