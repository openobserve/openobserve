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

import { ref, onBeforeUnmount, type Ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";

interface AutoRefreshOptions {
  interval: Ref<number>;
  onRefresh: () => Promise<void>;
  minInterval?: number;
  enabledKey?: string;
  activeRouteName?: string;
}

const useAutoRefresh = (options: AutoRefreshOptions) => {
  const store = useStore();
  const router = useRouter();
  const $q = useQuasar();

  const isLiveMode = ref(
    localStorage.getItem(options.enabledKey ?? "oo_toggle_auto_run") === "true",
  );
  const isRefreshing = ref(false);
  let refreshTimerId: ReturnType<typeof setInterval> | null = null;

  const minInterval = (): number => {
    if (options.minInterval !== undefined) return options.minInterval;
    return Number(store.state?.zoConfig?.min_auto_refresh_interval) || 0;
  };

  const isEnabled = (): boolean => {
    const routeName = options.activeRouteName ?? "logs";
    return (
      isLiveMode.value &&
      router.currentRoute.value.name === routeName &&
      options.interval.value > 0 &&
      options.interval.value >= minInterval()
    );
  };

  const start = (): void => {
    stop();
    if (!isEnabled()) return;

    refreshTimerId = setInterval(async () => {
      if (isRefreshing.value) return;
      isRefreshing.value = true;
      try {
        await options.onRefresh();
      } catch (e) {
        console.error("[useAutoRefresh] refresh error:", e);
      } finally {
        isRefreshing.value = false;
      }
    }, options.interval.value * 1000);
  };

  const stop = (): void => {
    if (refreshTimerId !== null) {
      clearInterval(refreshTimerId);
      refreshTimerId = null;
    }
  };

  const toggle = (): void => {
    isLiveMode.value = !isLiveMode.value;
    localStorage.setItem(
      options.enabledKey ?? "oo_toggle_auto_run",
      String(isLiveMode.value),
    );

    if (isLiveMode.value) {
      start();
      $q.notify({
        message: "Live mode is enabled.",
        color: "positive",
        position: "top",
        timeout: 1000,
      });
    } else {
      stop();
    }
  };

  const syncFromStorage = (): void => {
    isLiveMode.value =
      localStorage.getItem(
        options.enabledKey ?? "oo_toggle_auto_run",
      ) === "true";
  };

  // Callers must call start() explicitly when interval changes.
  // This avoids watchers — the component that changes the interval
  // is responsible for restarting auto-refresh.

  onBeforeUnmount(() => {
    stop();
  });

  return {
    isLiveMode,
    isRefreshing,
    start,
    stop,
    toggle,
    syncFromStorage,
  };
};

export default useAutoRefresh;
