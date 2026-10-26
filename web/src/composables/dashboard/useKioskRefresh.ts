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

import {
  computed,
  getCurrentInstance,
  onBeforeUnmount,
  reactive,
  ref,
  watch,
  type ComputedRef,
  type InjectionKey,
  type Ref,
} from "vue";
import { hungAfterMs, retryDelayMs, staleAfterMs } from "@/utils/dashboard/kiosk";

export interface KioskPanelError {
  message: string;
  code?: string | number | null;
}

/** Panels report into this so kiosk mode can count failures; absent outside the dashboard view. */
export interface KioskPanelHealthRegistry {
  register: (panelId: string) => void;
  unregister: (panelId: string) => void;
  report: (panelId: string, error: KioskPanelError | null) => void;
  /** True while the screen is known to be out of date (backend unreachable or nothing refreshed). */
  outage: ComputedRef<boolean>;
}

export const KIOSK_PANEL_HEALTH_KEY: InjectionKey<KioskPanelHealthRegistry> =
  Symbol("kiosk-panel-health");

export type KioskHealth =
  | { level: "ok" }
  | { level: "paused" }
  | { level: "warn"; kind: "hung" }
  | { level: "warn"; kind: "failing"; count: number }
  | { level: "bad"; kind: "stale"; since: number }
  | { level: "bad"; kind: "unreachable"; retryInSeconds: number };

/** Time left until the next automatic load, for the strip's countdown ring. */
export interface KioskCountdown {
  remainingMs: number;
  totalMs: number;
  /** Epoch ms of the next load. */
  at: number;
  /** True while the next load is the backoff retry after an outage. */
  retrying: boolean;
}

export interface UseKioskRefreshOptions {
  enabled: Ref<boolean>;
  intervalSeconds: Ref<number>;
  isLoading: Ref<boolean>;
  /** Starts a refresh without the "panels still loading" guard. */
  refresh: () => unknown;
  cancel: () => unknown;
  /** Cheap liveness check; when it fails no refresh is fired, so panels keep their last render. */
  probe?: () => Promise<boolean>;
  now?: () => number;
}

export interface UseKioskRefresh {
  registry: KioskPanelHealthRegistry;
  onTick: () => void;
  health: ComputedRef<KioskHealth>;
  failingCount: ComputedRef<number>;
  lastSuccessAt: Ref<number | null>;
  /** Null while auto-refresh is off or the tab is hidden. */
  countdown: ComputedRef<KioskCountdown | null>;
  stop: () => void;
}

// Lets the panels' error emits land before the finished cycle is judged.
const SETTLE_DELAY_MS = 250;
// A refresh served entirely from cache never flips the loading flag, so the cycle is closed by this instead.
const NO_LOAD_FALLBACK_MS = 2000;
// Panels restored from the browser cache never flip the loading flag, so the first cycle forces a real load after this.
const INITIAL_LOAD_FALLBACK_MS = 3000;
const CLOCK_MS = 1000;
// One slow health check (a page still loading its own assets) must not read as an outage, so a miss is asked again.
const PROBE_CONFIRM_MS = 2000;

const isClientError = (error: KioskPanelError) => String(error.code ?? "").startsWith("4");

export const useKioskRefresh = (options: UseKioskRefreshOptions): UseKioskRefresh => {
  const now = options.now ?? (() => Date.now());

  const panels = reactive(new Map<string, KioskPanelError | null>());

  const failingCount = computed(() => {
    let count = 0;
    panels.forEach((error) => {
      if (error) count++;
    });
    return count;
  });

  const clock = ref(now());
  const enabledAt = ref(now());
  const lastSuccessAt = ref<number | null>(null);
  const consecutiveFailures = ref(0);
  const nextRetryAt = ref<number | null>(null);
  const retryWindowMs = ref(0);
  const nextTickAt = ref<number | null>(null);
  const hungForced = ref(false);
  const paused = ref(false);

  let cycleOpen = false;
  let initialCycle = false;
  let sawLoading = false;
  let probing = false;
  // Bumped on stop so a probe that answers after kiosk was left is ignored.
  let epoch = 0;
  let cycleForced = false;
  let cycleStartedAt = 0;
  let missedWhileHidden = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let clockTimer: ReturnType<typeof setInterval> | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;

  const clearTimer = (timer: ReturnType<typeof setTimeout> | null) => {
    if (timer) clearTimeout(timer);
    return null;
  };

  const isHidden = () => typeof document !== "undefined" && document.hidden === true;
  const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

  const isUnreachable = () => {
    if (isOffline()) return true;
    const errors = [...panels.values()];
    if (!errors.length || errors.some((error) => !error)) return false;
    return errors.every((error) => error && !isClientError(error));
  };

  const confirmReachable = async () => {
    if (!options.probe) return true;
    if (await options.probe()) return true;
    if (isOffline()) return false;
    await new Promise((resolve) => setTimeout(resolve, PROBE_CONFIRM_MS));
    return options.probe();
  };

  const scheduleRetry = () => {
    retryTimer = clearTimer(retryTimer);
    const delay = retryDelayMs(consecutiveFailures.value, options.intervalSeconds.value);
    clock.value = now();
    retryWindowMs.value = delay;
    nextRetryAt.value = clock.value + delay;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (isHidden()) {
        missedWhileHidden = true;
        return;
      }
      startCycle(false);
    }, delay);
  };

  const recordOutage = () => {
    cycleOpen = false;
    fallbackTimer = clearTimer(fallbackTimer);
    consecutiveFailures.value++;
    scheduleRetry();
  };

  const recordSuccess = () => {
    consecutiveFailures.value = 0;
    nextRetryAt.value = null;
    retryTimer = clearTimer(retryTimer);
    hungForced.value = cycleForced;
    lastSuccessAt.value = now();
  };

  const judgeCycle = async () => {
    if (isUnreachable()) return recordOutage();
    if (options.probe) {
      const started = epoch;
      const reachable = await confirmReachable();
      if (started !== epoch) return;
      if (!reachable) return recordOutage();
    }
    recordSuccess();
  };

  const finishCycle = () => {
    if (!cycleOpen || options.isLoading.value) return;
    fallbackTimer = clearTimer(fallbackTimer);
    if (initialCycle && !sawLoading) {
      initialCycle = false;
      startCycle(false);
      return;
    }
    initialCycle = false;
    cycleOpen = false;
    void judgeCycle();
  };

  const settleSoon = () => {
    settleTimer = clearTimer(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      finishCycle();
    }, SETTLE_DELAY_MS);
  };

  const openCycle = (forced: boolean, fallbackMs: number) => {
    cycleOpen = true;
    sawLoading = options.isLoading.value;
    cycleForced = forced;
    cycleStartedAt = now();
    if (forced) hungForced.value = true;
    fallbackTimer = clearTimer(fallbackTimer);
    fallbackTimer = setTimeout(() => {
      fallbackTimer = null;
      if (!options.isLoading.value) settleSoon();
    }, fallbackMs);
  };

  const runCycle = (forced: boolean) => {
    openCycle(forced, NO_LOAD_FALLBACK_MS);
    options.refresh();
  };

  // Checking first means an outage never wipes the panels with a failed refresh.
  function startCycle(forced: boolean) {
    if (isOffline()) return recordOutage();
    if (!options.probe) return runCycle(forced);
    const started = epoch;
    probing = true;
    void confirmReachable().then((reachable) => {
      probing = false;
      if (started !== epoch) return;
      if (reachable) runCycle(forced);
      else recordOutage();
    });
  }

  const onTick = () => {
    if (!options.enabled.value) return;
    if (isHidden()) {
      missedWhileHidden = true;
      return;
    }
    // The retry timer owns refreshes until the backend answers again.
    if (consecutiveFailures.value > 0 || probing) return;
    if (options.isLoading.value) {
      if (cycleStartedAt && now() - cycleStartedAt >= hungAfterMs(options.intervalSeconds.value)) {
        options.cancel();
        startCycle(true);
      }
      return;
    }
    startCycle(false);
  };

  const refreshNow = () => {
    retryTimer = clearTimer(retryTimer);
    nextRetryAt.value = null;
    startCycle(false);
  };

  const onVisibilityChange = () => {
    paused.value = isHidden();
    if (!paused.value && missedWhileHidden) {
      missedWhileHidden = false;
      refreshNow();
    }
  };

  const onOnline = () => {
    if (consecutiveFailures.value > 0) refreshNow();
  };

  const restartTicker = () => {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
    nextTickAt.value = null;
    const seconds = options.intervalSeconds.value;
    if (!options.enabled.value || seconds <= 0) return;
    nextTickAt.value = now() + seconds * 1000;
    tickTimer = setInterval(() => {
      nextTickAt.value = now() + seconds * 1000;
      onTick();
    }, seconds * 1000);
  };

  const start = () => {
    enabledAt.value = now();
    clock.value = now();
    paused.value = isHidden();
    // The mount (or the entry into kiosk) is itself a load, so the first finished cycle counts as a success.
    initialCycle = true;
    openCycle(false, INITIAL_LOAD_FALLBACK_MS);
    clockTimer = setInterval(() => {
      clock.value = now();
    }, CLOCK_MS);
    restartTicker();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);
  };

  const stop = () => {
    epoch++;
    probing = false;
    initialCycle = false;
    retryTimer = clearTimer(retryTimer);
    settleTimer = clearTimer(settleTimer);
    fallbackTimer = clearTimer(fallbackTimer);
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = null;
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
    cycleOpen = false;
    cycleStartedAt = 0;
    missedWhileHidden = false;
    consecutiveFailures.value = 0;
    nextRetryAt.value = null;
    retryWindowMs.value = 0;
    nextTickAt.value = null;
    hungForced.value = false;
    paused.value = false;
    lastSuccessAt.value = null;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
    if (typeof window !== "undefined") window.removeEventListener("online", onOnline);
  };

  watch(
    options.enabled,
    (enabled) => {
      stop();
      if (enabled) start();
    },
    { immediate: true },
  );

  watch(options.intervalSeconds, () => {
    if (options.enabled.value) restartTicker();
  });

  watch(options.isLoading, (loading) => {
    if (!options.enabled.value) return;
    if (loading) {
      if (cycleOpen) sawLoading = true;
      return;
    }
    settleSoon();
  });

  const health = computed<KioskHealth>(() => {
    if (!options.enabled.value) return { level: "ok" };
    if (paused.value) return { level: "paused" };
    if (consecutiveFailures.value > 0) {
      const remaining = Math.max(0, (nextRetryAt.value ?? clock.value) - clock.value);
      return { level: "bad", kind: "unreachable", retryInSeconds: Math.ceil(remaining / 1000) };
    }
    const interval = options.intervalSeconds.value;
    const since = lastSuccessAt.value ?? enabledAt.value;
    if (interval > 0 && clock.value - since > staleAfterMs(interval)) {
      return { level: "bad", kind: "stale", since };
    }
    if (hungForced.value) return { level: "warn", kind: "hung" };
    if (failingCount.value > 0)
      return { level: "warn", kind: "failing", count: failingCount.value };
    return { level: "ok" };
  });

  const countdown = computed<KioskCountdown | null>(() => {
    if (!options.enabled.value || paused.value) return null;
    const retrying = consecutiveFailures.value > 0 && nextRetryAt.value !== null;
    const target = retrying ? nextRetryAt.value : nextTickAt.value;
    const totalMs = retrying ? retryWindowMs.value : options.intervalSeconds.value * 1000;
    if (target === null || !(totalMs > 0)) return null;
    const remainingMs = Math.min(totalMs, Math.max(0, target - clock.value));
    return { remainingMs, totalMs, at: target, retrying };
  });

  const registry: KioskPanelHealthRegistry = {
    register: (id) => {
      if (!panels.has(id)) panels.set(id, null);
    },
    unregister: (id) => {
      panels.delete(id);
    },
    report: (id, error) => {
      panels.set(id, error?.message ? error : null);
    },
    outage: computed(() => health.value.level === "bad"),
  };

  if (getCurrentInstance()) onBeforeUnmount(stop);

  return { registry, onTick, health, failingCount, lastSuccessAt, countdown, stop };
};

export default useKioskRefresh;
