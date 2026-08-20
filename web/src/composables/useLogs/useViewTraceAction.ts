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
export default function useViewTraceAction(t: TranslateFn, searchObj: any) {
  const store = useStore();
  const { getStreams } = useStreams(t);

  const tracesStreams: any = ref([]);
  const filteredTracesStreamOptions: any = ref([]);
  const isTracesStreamsLoading = ref(false);
  const showViewTraceBtn: any = ref(false);

  const getTracesStreams = async () => {
    isTracesStreamsLoading.value = true;
    try {
      getStreams("traces", false)
        .then((res: any) => {
          tracesStreams.value = res.list.map((option: any) => option.name);
          filteredTracesStreamOptions.value = JSON.parse(JSON.stringify(tracesStreams.value));

          if (!searchObj.meta.selectedTraceStream.length)
            searchObj.meta.selectedTraceStream = tracesStreams.value[0];
        })
        .catch(() => Promise.reject())
        .finally(() => {
          isTracesStreamsLoading.value = false;
        });
    } catch (err: any) {
      isTracesStreamsLoading.value = false;
      console.error("Failed to get traces streams", err);
    }
  };

  /**
   * Decide whether the action is offered for `record`, and lazily load the
   * traces streams the picker needs the first time it is.
   */
  const setViewTraceBtn = (record: any) => {
    // Hide view traces button when service_streams_enabled is true
    const serviceStreamsEnabled = store.state.zoConfig.service_streams_enabled !== false;

    // `hiddenMenus` is seeded as an array and only replaced with a Set once
    // MainLayout has read `custom_hide_menus`, so accept either shape rather
    // than assuming `.has` exists.
    const hiddenMenus: any = store.state.hiddenMenus;
    const tracesMenuHidden =
      typeof hiddenMenus?.has === "function"
        ? hiddenMenus.has("traces")
        : Array.isArray(hiddenMenus) && hiddenMenus.includes("traces");

    showViewTraceBtn.value =
      !tracesMenuHidden && // Check if traces menu is hidden
      !serviceStreamsEnabled && // Hide when service streams is enabled
      record?.[store.state.organizationData?.organizationSettings?.trace_id_field_name];

    if (showViewTraceBtn.value && !filteredTracesStreamOptions.value.length) getTracesStreams();
  };

  const filterStreamFn = (val: any = "") => {
    filteredTracesStreamOptions.value = tracesStreams.value.filter((stream: any) => {
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
