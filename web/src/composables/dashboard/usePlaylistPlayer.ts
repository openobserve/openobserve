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

import { computed, getCurrentInstance, onBeforeUnmount, reactive } from "vue";
import type { PlaylistFrameMessage, SlideHealthReport } from "@/utils/dashboard/playlist";

export type PlayerSlotStatus = "loading" | "ready" | "failed";

/** One iframe; a new key is a new frame, so a dropped slot frees its whole page. */
export interface PlayerSlot {
  key: number;
  index: number;
  status: PlayerSlotStatus;
  /** The app inside the frame has started and can talk to the player. */
  booted: boolean;
  /** The frame's document finished loading (readable); the app may still be starting. */
  loaded: boolean;
  createdAt: number;
}

export interface SlideRecord {
  title: string | null;
  health: SlideHealthReport | null;
  missing: "notFound" | "forbidden" | null;
  missingAt: number | null;
  loadFailed: boolean;
}

export type PlayerPhase = "starting" | "playing" | "empty";

export interface UsePlaylistPlayerOptions {
  count: number;
  intervalSeconds: number;
  startIndex: number;
  /** A new slide is on screen (used to keep `slide=` in the URL current). */
  onSlideShown?: (index: number) => void;
  /** Framing is blocked; the page continues with a full page load per slide. */
  onFallback?: (index: number) => void;
  /** Cheap backend liveness check, used to end a hold once the backend answers again. */
  probe?: () => Promise<boolean>;
  now?: () => number;
}

/** A booted slide still loading after this long is shown anyway, so a hung query cannot stall the loop. */
export const READY_CAP_MS = 60000;
/** A loaded document whose app never starts is reloaded after this long (doubling per attempt). */
export const BOOT_STALL_MS = 30000;
export const LOAD_RETRY_MS = 60000;
/** A prev/next target that is not ready after this long is reloaded (doubling per attempt) while its card stays up. */
export const JUMP_WATCHDOG_MS = 30000;
export const PROBE_MS = 10000;
/** A deleted or forbidden dashboard is skipped without loading until this long has passed. */
export const MISSING_RECHECK_MS = 300000;
const MIN_PRELOAD_LEAD_MS = 10000;
const MAX_STALL_MS = 300000;
const FADE_MS = 400;
const CLOCK_MS = 250;
const EMPTY_RETRY_MIN_MS = 30000;

export const usePlaylistPlayer = (options: UsePlaylistPlayerOptions) => {
  const now = options.now ?? (() => Date.now());
  const count = Math.max(1, options.count);
  const intervalMs = options.intervalSeconds * 1000;

  const state = reactive({
    phase: "starting" as PlayerPhase,
    shown: null as PlayerSlot | null,
    pending: null as PlayerSlot | null,
    leaving: null as PlayerSlot | null,
    slides: Array.from({ length: count }, (): SlideRecord => ({
      title: null,
      health: null,
      missing: null,
      missingAt: null,
      loadFailed: false,
    })),
    paused: false,
    pausedAt: null as number | null,
    dwellDue: false,
    /** A prev/next press: swap as soon as the target is ready, whatever holds rotation. */
    jump: false,
    /** The backend answered again while the shown slide still reports an outage. */
    recovered: false,
    /** The player itself saw the backend or the network go away (offline event or repeated failed pings). */
    backendDown: false,
    dwellElapsed: 0,
    dwellSince: null as number | null,
    clock: now(),
    fallback: false,
  });

  let seq = 0;
  let missStreak = 0;
  let stopped = false;
  let stallAttempt = 0;
  let probeMisses = 0;
  let watchdogAttempt = 0;
  // Direction of the last prev/next press, so a missing slide is skipped the way the user is going.
  let step = 1;
  // Learnt from real loads so the next slide is ready when its turn comes.
  let lastLoadMs = 0;
  let dwellTimer: ReturnType<typeof setTimeout> | null = null;
  let preloadTimer: ReturnType<typeof setTimeout> | null = null;
  let capTimer: ReturnType<typeof setTimeout> | null = null;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let fadeTimer: ReturnType<typeof setTimeout> | null = null;
  let probeTimer: ReturnType<typeof setInterval> | null = null;
  let clockTimer: ReturnType<typeof setInterval> | null = null;

  const clear = (timer: ReturnType<typeof setTimeout> | null) => {
    if (timer) clearTimeout(timer);
    return null;
  };

  const wrap = (index: number) => ((index % count) + count) % count;

  const knownMissing = (index: number) => {
    const slide = state.slides[index];
    return !!slide.missing && now() - (slide.missingAt ?? 0) < MISSING_RECHECK_MS;
  };

  /** The next slide in `step` direction that is not known to be gone. */
  const nextPlayable = (from: number, step: number) => {
    for (let i = 1; i <= count; i++) {
      const index = wrap(from + step * i);
      if (!knownMissing(index)) return index;
    }
    return wrap(from + step);
  };

  const outage = computed(() => {
    const index = state.shown?.index;
    return index !== undefined && state.slides[index].health?.outage === true;
  });

  const held = computed(() => (outage.value && !state.recovered) || state.backendDown);

  const elapsedMs = () =>
    state.dwellElapsed + (state.dwellSince !== null ? state.clock - state.dwellSince : 0);

  const progress = computed(() =>
    state.shown ? Math.min(1, Math.max(0, elapsedMs() / intervalMs)) : 0,
  );

  /** Epoch ms the dwell ends while running; null while paused or before the first slide. */
  const nextAt = computed(() =>
    state.shown && state.dwellSince !== null
      ? state.dwellSince + intervalMs - state.dwellElapsed
      : null,
  );

  const currentIndex = computed(
    () => state.shown?.index ?? state.pending?.index ?? options.startIndex,
  );

  /** Rotation is due but the next slide is still loading. */
  const waiting = computed(
    () => !!state.shown && (state.dwellDue || state.jump) && state.pending?.status !== "ready",
  );

  /** Slide a prev/next press is waiting for, while it loads. */
  const jumpTarget = computed(() =>
    state.shown && state.jump && state.pending && state.pending.status !== "ready"
      ? state.pending.index
      : null,
  );

  /** Slide the rotation moves to next: the one already loading, or the next one not known to be gone. */
  const nextIndex = computed(() => state.pending?.index ?? nextPlayable(currentIndex.value, 1));

  const leadMs = () => Math.min(intervalMs, Math.max(MIN_PRELOAD_LEAD_MS, lastLoadMs * 1.5 + 2000));

  const isRunning = () => !!state.shown && !state.paused;

  const fallBack = (index: number) => {
    if (state.fallback) return;
    state.fallback = true;
    stop();
    options.onFallback?.(index);
  };

  const armStall = (slot: PlayerSlot) => {
    stallTimer = clear(stallTimer);
    if (!slot.loaded || slot.booted) return;
    const delay = Math.min(MAX_STALL_MS, BOOT_STALL_MS * 2 ** stallAttempt);
    stallTimer = setTimeout(() => {
      stallTimer = null;
      if (state.pending !== slot || slot.booted) return;
      stallAttempt++;
      setPending(slot.index);
    }, delay);
  };

  function setPending(index: number) {
    watchdogTimer = clear(watchdogTimer);
    capTimer = clear(capTimer);
    stallTimer = clear(stallTimer);
    retryTimer = clear(retryTimer);
    state.pending = {
      key: ++seq,
      index,
      status: "loading",
      booted: false,
      loaded: false,
      createdAt: now(),
    };
    // Every replacement of a prev/next target keeps a watchdog, so its card can never outlive it.
    if (state.jump && state.shown) armWatchdog(state.pending);
  }

  const preloadNext = () => {
    preloadTimer = clear(preloadTimer);
    if (!state.shown || state.pending) return;
    setPending(nextPlayable(state.shown.index, 1));
  };

  const scheduleDwell = () => {
    dwellTimer = clear(dwellTimer);
    preloadTimer = clear(preloadTimer);
    // Paused, the next slide stays loaded (its frame refreshes itself) so a manual Next is instant.
    if (!isRunning()) {
      if (state.paused) preloadNext();
      return;
    }
    const remaining = intervalMs - elapsedMs();
    if (remaining <= 0) {
      state.dwellDue = true;
      tryAdvance();
      return;
    }
    dwellTimer = setTimeout(() => {
      dwellTimer = null;
      state.clock = now();
      state.dwellDue = true;
      tryAdvance();
    }, remaining);
    if (state.pending) return;
    const preloadIn = remaining - leadMs();
    if (preloadIn <= 0) preloadNext();
    else preloadTimer = setTimeout(preloadNext, preloadIn);
  };

  /** Freezes or resumes the dwell clock to match the pause state. */
  const syncRunning = () => {
    state.clock = now();
    if (isRunning()) {
      if (state.dwellSince === null) state.dwellSince = state.clock;
    } else if (state.dwellSince !== null) {
      state.dwellElapsed += state.clock - state.dwellSince;
      state.dwellSince = null;
    }
    scheduleDwell();
  };

  const stopProbing = () => {
    if (probeTimer) clearInterval(probeTimer);
    probeTimer = null;
  };

  const show = (slot: PlayerSlot) => {
    watchdogTimer = clear(watchdogTimer);
    watchdogAttempt = 0;
    capTimer = clear(capTimer);
    stallTimer = clear(stallTimer);
    fadeTimer = clear(fadeTimer);
    state.leaving = state.shown;
    state.shown = slot;
    state.pending = null;
    state.dwellDue = false;
    state.jump = false;
    state.recovered = false;
    state.dwellElapsed = 0;
    state.dwellSince = null;
    state.phase = "playing";
    missStreak = 0;
    if (state.leaving) {
      fadeTimer = setTimeout(() => {
        fadeTimer = null;
        state.leaving = null;
      }, FADE_MS);
    }
    syncRunning();
    syncProbing();
    options.onSlideShown?.(slot.index);
  };

  function tryAdvance() {
    if (stopped) return;
    const pending = state.pending;
    if (!pending) {
      if (state.dwellDue) preloadNext();
      return;
    }
    if (pending.status !== "ready") return;
    if (!state.shown) return show(pending);
    // A slide that came up during an outage has nothing to show; the current one keeps its last render.
    if (state.slides[pending.index].health?.outage) return;
    if (state.jump) return show(pending);
    if (!state.dwellDue || state.paused || held.value) return;
    show(pending);
  }

  const markReady = (slot: PlayerSlot) => {
    if (slot.status === "ready") return;
    slot.status = "ready";
    if (slot !== state.pending) return;
    capTimer = clear(capTimer);
    stallTimer = clear(stallTimer);
    stallAttempt = 0;
    lastLoadMs = Math.max(0, now() - slot.createdAt);
    tryAdvance();
  };

  const goEmpty = () => {
    state.phase = "empty";
    capTimer = clear(capTimer);
    stallTimer = clear(stallTimer);
    state.pending = null;
    retryTimer = clear(retryTimer);
    retryTimer = setTimeout(retry, Math.max(EMPTY_RETRY_MIN_MS, intervalMs));
  };

  const onMissing = (slot: PlayerSlot, reason: "notFound" | "forbidden") => {
    const record = state.slides[slot.index];
    record.missing = reason;
    record.missingAt = now();
    record.health = null;
    if (slot !== state.pending) return;
    missStreak++;
    if (missStreak >= count) return goEmpty();
    setPending(nextPlayable(slot.index, state.jump ? step : 1));
  };

  /** The slide could not load (network or server); keep it as pending and retry it, never skip it. */
  const onLoadError = (slot: PlayerSlot) => {
    state.slides[slot.index].loadFailed = true;
    if (slot !== state.pending) return;
    capTimer = clear(capTimer);
    stallTimer = clear(stallTimer);
    slot.status = "failed";
    retryTimer = clear(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (state.pending === slot) setPending(slot.index);
    }, LOAD_RETRY_MS);
    syncProbing();
  };

  const findSlot = (key: number) =>
    [state.shown, state.pending, state.leaving].find((slot) => slot?.key === key) ?? null;

  const markBooted = (slot: PlayerSlot) => {
    if (slot.booted) return;
    slot.booted = true;
    stallTimer = clear(stallTimer);
    if (slot === state.pending && slot.status === "loading") {
      capTimer = clear(capTimer);
      capTimer = setTimeout(() => {
        capTimer = null;
        markReady(slot);
      }, READY_CAP_MS);
    }
  };

  /** Feed a validated message from the frame with this key. */
  const onMessage = (key: number, message: PlaylistFrameMessage) => {
    if (stopped) return;
    const slot = findSlot(key);
    if (!slot) return;
    const record = state.slides[slot.index];
    switch (message.type) {
      case "hello":
        markBooted(slot);
        return;
      case "ready":
        markBooted(slot);
        record.title = message.title || record.title;
        record.missing = null;
        record.missingAt = null;
        record.loadFailed = false;
        markReady(slot);
        return;
      case "health":
        record.health = message.health;
        if (slot === state.shown && !message.health.outage) state.recovered = false;
        syncProbing();
        tryAdvance();
        return;
      case "missing":
        markBooted(slot);
        onMissing(slot, message.reason);
        return;
      case "error":
        markBooted(slot);
        onLoadError(slot);
        return;
    }
  };

  /** The frame's document loaded and is readable; its app should start shortly. */
  const onFrameLoaded = (key: number) => {
    const slot = findSlot(key);
    if (!slot || slot.loaded) return;
    slot.loaded = true;
    if (slot === state.pending) armStall(slot);
  };

  /** Response headers forbid framing: only then does the player give up on frames. */
  const onFrameBlocked = (key: number) => {
    const slot = findSlot(key);
    if (slot) fallBack(slot.index);
  };

  /** The frame shows a browser error page (offline, connection reset): retry it. */
  const onFrameFailed = (key: number) => {
    const slot = findSlot(key);
    if (slot && !slot.booted) onLoadError(slot);
  };

  /** Backend reachable again: end the hold, and replace frames that may have died while it was down. */
  const recover = (reloadLoading: boolean) => {
    if (stopped) return;
    probeMisses = 0;
    state.backendDown = false;
    const pending = state.pending;
    if (
      pending &&
      (pending.status === "failed" ||
        (reloadLoading && pending.status === "loading") ||
        state.slides[pending.index].health?.outage === true)
    ) {
      setPending(pending.index);
    }
    if (outage.value) state.recovered = true;
    syncProbing();
    tryAdvance();
  };

  const runProbe = async () => {
    if (!options.probe || stopped) return;
    const reachable = await options.probe().catch(() => false);
    if (stopped) return;
    if (reachable) {
      if (held.value) recover(false);
      else probeMisses = 0;
      syncProbing();
      return;
    }
    // Two misses in a row, so one slow answer never shows an outage.
    probeMisses++;
    if (probeMisses >= 2 && !state.backendDown) {
      state.backendDown = true;
      syncProbing();
    }
  };

  function syncProbing() {
    const needed = held.value || state.pending?.status === "failed";
    if (needed && options.probe) {
      if (!probeTimer) probeTimer = setInterval(() => void runProbe(), PROBE_MS);
    } else {
      stopProbing();
    }
  }

  /** The browser came back online: check the backend now rather than at the next retry. */
  const onOnline = () => {
    if (!options.probe) return recover(true);
    void options.probe().then((reachable) => {
      if (reachable) recover(true);
    });
  };

  /** The browser went offline: say so on screen and hold rotation until it is back. */
  const onOffline = () => {
    state.backendDown = true;
    syncProbing();
  };

  const armWatchdog = (slot: PlayerSlot) => {
    watchdogTimer = clear(watchdogTimer);
    const delay = Math.min(MAX_STALL_MS, JUMP_WATCHDOG_MS * 2 ** watchdogAttempt);
    watchdogTimer = setTimeout(() => {
      watchdogTimer = null;
      if (stopped || !state.jump || state.pending !== slot || slot.status === "ready") return;
      // A started app shows what it has; one that never started is loaded again.
      if (slot.booted) return markReady(slot);
      watchdogAttempt++;
      setPending(slot.index);
    }, delay);
  };

  /** Drops a prev/next that is no longer wanted, so its card cannot outlive it. */
  const cancelJump = () => {
    state.jump = false;
    watchdogTimer = clear(watchdogTimer);
    watchdogAttempt = 0;
    if (state.pending && state.pending.status !== "ready") {
      capTimer = clear(capTimer);
      stallTimer = clear(stallTimer);
      retryTimer = clear(retryTimer);
      state.pending = null;
    }
    syncRunning();
  };

  const jumpBy = (direction: number) => {
    if (state.phase === "empty") return retry();
    step = direction;
    const base = state.jump && state.pending ? state.pending.index : currentIndex.value;
    const target = nextPlayable(base, direction);
    // Back to the slide already on screen: nothing to load, the press just undoes the last one.
    if (state.shown && target === state.shown.index) return cancelJump();
    state.jump = true;
    if (state.pending?.index !== target || state.pending.status === "failed") {
      watchdogAttempt = 0;
      setPending(target);
    }
    const pending = state.pending;
    if (pending && pending.status !== "ready" && !watchdogTimer) armWatchdog(pending);
    tryAdvance();
  };

  const next = () => jumpBy(1);
  const prev = () => jumpBy(-1);

  const togglePause = () => {
    state.paused = !state.paused;
    state.pausedAt = state.paused ? now() : null;
    syncRunning();
  };

  function retry() {
    retryTimer = clear(retryTimer);
    missStreak = 0;
    state.slides.forEach((slide) => {
      slide.missing = null;
      slide.missingAt = null;
    });
    state.phase = state.shown ? "playing" : "starting";
    setPending(state.shown ? wrap(state.shown.index + 1) : options.startIndex);
  }

  function stop() {
    stopped = true;
    dwellTimer = clear(dwellTimer);
    preloadTimer = clear(preloadTimer);
    capTimer = clear(capTimer);
    stallTimer = clear(stallTimer);
    watchdogTimer = clear(watchdogTimer);
    retryTimer = clear(retryTimer);
    fadeTimer = clear(fadeTimer);
    stopProbing();
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = null;
  }

  const start = () => {
    stopped = false;
    setPending(wrap(options.startIndex));
    clockTimer = setInterval(() => {
      state.clock = now();
    }, CLOCK_MS);
  };

  if (getCurrentInstance()) onBeforeUnmount(stop);

  return {
    state,
    held,
    progress,
    currentIndex,
    waiting,
    jumpTarget,
    nextIndex,
    nextAt,
    start,
    stop,
    next,
    prev,
    togglePause,
    retry,
    onMessage,
    onFrameLoaded,
    onFrameBlocked,
    onFrameFailed,
    onOnline,
    onOffline,
  };
};

export type PlaylistPlayer = ReturnType<typeof usePlaylistPlayer>;

export default usePlaylistPlayer;
