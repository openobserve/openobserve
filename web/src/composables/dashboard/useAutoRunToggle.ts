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

import { computed, getCurrentInstance, onActivated, onBeforeUnmount, onMounted, ref } from "vue";
import { useStore } from "vuex";

// Shared with logs and traces, so one choice applies everywhere.
export const AUTO_RUN_STORAGE_KEY = "oo_toggle_auto_run";

const readStoredAutoRun = (): boolean => {
  try {
    const saved = localStorage.getItem(AUTO_RUN_STORAGE_KEY);
    return saved === null ? true : saved === "true";
  } catch {
    return true;
  }
};

// One ref per tab, because the browser fires `storage` only in other tabs.
const stored = ref(readStoredAutoRun());

/** Auto Run state for dashboard surfaces, gated by zoConfig.auto_query_enabled. */
export const useAutoRunToggle = () => {
  const store = useStore();

  const isAutoRunAvailable = computed(() => store?.state?.zoConfig?.auto_query_enabled === true);
  const isAutoRunOn = computed(() => isAutoRunAvailable.value && stored.value);

  const syncAutoRun = () => {
    stored.value = readStoredAutoRun();
  };

  const toggleAutoRun = () => {
    stored.value = !stored.value;
    try {
      localStorage.setItem(AUTO_RUN_STORAGE_KEY, String(stored.value));
    } catch {
      /* storage unavailable: the in-memory choice still applies to this view */
    }
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === AUTO_RUN_STORAGE_KEY) syncAutoRun();
  };

  if (getCurrentInstance()) {
    onMounted(() => {
      syncAutoRun();
      window.addEventListener("storage", onStorage);
    });
    onActivated(syncAutoRun);
    onBeforeUnmount(() => window.removeEventListener("storage", onStorage));
  }

  return { isAutoRunAvailable, isAutoRunOn, toggleAutoRun, syncAutoRun };
};
