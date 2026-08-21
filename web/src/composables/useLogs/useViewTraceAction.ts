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

import { ref } from "vue";
import { useStore } from "vuex";
import type { TranslateFn } from "@/types/i18n";
import useStreams from "@/composables/useStreams";
import type { SearchObject } from "@/composables/useLogs/searchState";

/**
 * State behind the "View Trace" action — the traces-stream picker and the
 * button beside it.
 *
 * Lives in a composable because two components render the same action from the
 * same rules: `JsonPreview` shows it inline under an expanded log row, and
 * `DetailTable` shows it in the row-detail drawer's header. Copying the gate
 * into both is how `service_streams_enabled` ended up hand-rolled in three
 * files and drifted.
 *
 * Each caller gets its own refs. `searchObj` is injected rather than resolved
 * here so the picker writes the chosen stream back to the caller's own search
 * state — it is shared module state in the app, so the selection carries across
 * both renderings.
 */
export default function useViewTraceAction(t: TranslateFn, searchObj: SearchObject) {
  const store = useStore();
  const { getStreams } = useStreams(t);

  const tracesStreams = ref<string[]>([]);
  const filteredTracesStreamOptions = ref<string[]>([]);
  const isTracesStreamsLoading = ref(false);
  // Holds the trace-id value rather than a strict boolean: the gate below ends
  // in the record lookup, and callers only ever use it for truthiness.
  const showViewTraceBtn = ref<string | boolean | undefined>(false);
  // Latches once a fetch has completed, successfully or not. `filteredTraces-
  // StreamOptions.length` cannot serve as the guard: an org with no traces
  // streams leaves it empty forever, which would refetch on every record.
  const hasLoadedTracesStreams = ref(false);

  const getTracesStreams = async () => {
    isTracesStreamsLoading.value = true;
    try {
      // Awaited inside the try so a rejection lands in the catch below instead
      // of escaping as an unhandled rejection on a promise nobody holds.
      const res = (await getStreams("traces", false)) as { list: { name: string }[] };

      tracesStreams.value = (res?.list ?? []).map((option) => option.name);
      filteredTracesStreamOptions.value = [...tracesStreams.value];

      // Only default the selection when there is something to select —
      // assigning `undefined` here used to make the next call throw on
      // `selectedTraceStream.length`.
      if (!searchObj.meta.selectedTraceStream?.length && tracesStreams.value.length)
        searchObj.meta.selectedTraceStream = tracesStreams.value[0];
    } catch (err: unknown) {
      console.error("Failed to get traces streams", err);
    } finally {
      hasLoadedTracesStreams.value = true;
      isTracesStreamsLoading.value = false;
    }
  };

  /**
   * Decide whether the action is offered for `record`, and lazily load the
   * traces streams the picker needs the first time it is.
   */
  const setViewTraceBtn = (record: Record<string, unknown> | null | undefined) => {
    // Hide view traces button when service_streams_enabled is true
    const serviceStreamsEnabled = store.state.zoConfig.service_streams_enabled !== false;

    // `hiddenMenus` is seeded as an array and only replaced with a Set once
    // MainLayout has read `custom_hide_menus`, so accept either shape rather
    // than assuming `.has` exists.
    const hiddenMenus: Set<string> | string[] | undefined = store.state.hiddenMenus;
    const tracesMenuHidden = Array.isArray(hiddenMenus)
      ? hiddenMenus.includes("traces")
      : Boolean(hiddenMenus?.has("traces"));

    showViewTraceBtn.value =
      !tracesMenuHidden && // Check if traces menu is hidden
      !serviceStreamsEnabled && // Hide when service streams is enabled
      (record?.[store.state.organizationData?.organizationSettings?.trace_id_field_name] as
        string | undefined);

    if (showViewTraceBtn.value && !hasLoadedTracesStreams.value && !isTracesStreamsLoading.value)
      getTracesStreams();
  };

  const filterStreamFn = (val: string = "") => {
    filteredTracesStreamOptions.value = tracesStreams.value.filter((stream: string) => {
      return stream.toLowerCase().indexOf(val.toLowerCase()) > -1;
    });
  };

  return {
    tracesStreams,
    filteredTracesStreamOptions,
    isTracesStreamsLoading,
    showViewTraceBtn,
    getTracesStreams,
    setViewTraceBtn,
    filterStreamFn,
  };
}
