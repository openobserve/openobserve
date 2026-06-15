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

// useSpanDetect — drives the "waiting for the first span" status bar with real,
// bounded polling.
//
// states: idle → listening → connected | stalled   ·   recheck() re-arms.
//
// Detection is a two-stage gate per poll:
//   1. Existence — the target stream isn't created until the first span lands,
//      so we first check the cheap streams-list ("stream stats") API. While the
//      stream is absent we just wait, instead of hammering _search and getting
//      404 "stream not found" back every tick.
//   2. Confirm — once the stream exists, a COUNT over a window that starts at
//      listen-time (so time-partition pruning scans only the newest file(s),
//      tiny size, no rows materialized) confirms it carries THIS provider's
//      spans; >0 → connected.
// Plus ~3s backoff, a hard timeout → "stalled", and polling pauses while the
// tab is hidden. So it only works during an active, visible setup and stops on
// the first hit / unmount.
//
// The stream is whatever the install command writes to: when the card declares
// a `stream_input`, the user's value drives BOTH the command's {stream}
// placeholder and this `streamName` (see AIRichSetupCard.vue), else it falls
// back to the SDK default. TODO(detect): confirm each provider's stored span
// attribute on the ingest side so the `filter` matches on day one.

import { onUnmounted, ref, computed } from "vue";
import searchService from "@/services/search";
import streamService from "@/services/stream";

export type DetectState = "idle" | "listening" | "connected" | "stalled";

export interface SpanDetectConfig {
  orgId: string;
  streamType: "traces" | "logs";
  /** Stream to count over. Falls back to "default" until configured. */
  streamName?: string;
  /** SQL WHERE fragment, e.g. "gen_ai_system = 'Anthropic'". */
  filter: string;
  /** Poll cadence (ms). Default 3000. */
  pollMs?: number;
  /** Give up after this long → "stalled". Default 60000. */
  timeoutMs?: number;
  /** Count spans from this long BEFORE listen-start, so a span that arrived
   *  during setup still counts. Default 60000. */
  lookbackMs?: number;
}

export interface UseSpanDetectOptions {
  /** Reactive config getter (org/stream/filter may resolve asynchronously). */
  config: () => SpanDetectConfig;
  /** Fired once on a successful connect (e.g. confetti). */
  onConnect?: () => void;
}

export function prefersReducedMotion(): boolean {
  return !!(
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const nowMs = () => new Date().getTime();

export function useSpanDetect(opts: UseSpanDetectOptions) {
  const state = ref<DetectState>("idle");
  const count = ref(0);
  const timers: ReturnType<typeof setTimeout>[] = [];
  let listenStartMs = 0;
  let visibilityBound = false;
  // Once the stream is seen to exist we skip the existence probe (streams don't
  // vanish mid-setup) and go straight to the COUNT confirm. Re-armed if the
  // target stream name changes (e.g. the user edits the stream-name input).
  let streamSeen = false;
  let lastStream = "";

  const clearTimers = () => {
    timers.forEach((t) => clearTimeout(t));
    timers.length = 0;
  };

  const succeed = (n = 1) => {
    state.value = "connected";
    count.value = Math.max(1, n);
    if (opts.onConnect && !prefersReducedMotion()) opts.onConnect();
  };

  // Window start (micros): a little before listen-start so a span that landed
  // during setup still counts. Narrow window → only the newest file(s) scanned.
  const windowStartMicros = (cfg: SpanDetectConfig) =>
    (listenStartMs - (cfg.lookbackMs ?? 60000)) * 1000;

  // One cheap COUNT over [windowStart, now]. >0 matches → connected.
  const countSql = (cfg: SpanDetectConfig) => {
    // Stream comes from the md `detect.stream` (authored next to the install
    // command so they match); "default" is the SDK's default if unset.
    const stream = cfg.streamName || "default";
    return `SELECT COUNT(*) as zo_count FROM "${stream}" WHERE (${cfg.filter}) AND _timestamp >= ${windowStartMicros(cfg)}`;
  };

  // Stage 1 — does the target stream exist yet? Uses the streams-list ("stream
  // stats") API, which returns 200 with an empty/filtered list (no 404) until
  // the first span creates the stream.
  const streamExists = async (cfg: SpanDetectConfig): Promise<boolean> => {
    const stream = cfg.streamName || "default";
    try {
      const res = await streamService.nameList(
        cfg.orgId,
        cfg.streamType,
        false,
        -1,
        -1,
        stream,
      );
      const list: any[] = res?.data?.list ?? [];
      // keyword is a substring match → require the exact stream name.
      return list.some((s) => s?.name === stream);
    } catch {
      return false;
    }
  };

  const poll = async () => {
    if (state.value !== "listening") return;
    const cfg = opts.config();
    const timeoutMs = cfg.timeoutMs ?? 60000;
    if (nowMs() - listenStartMs > timeoutMs) {
      state.value = "stalled";
      return;
    }
    // Pause polling while the tab is hidden — resumed by the visibility handler.
    if (typeof document !== "undefined" && document.hidden) {
      scheduleNextPoll(cfg);
      return;
    }
    // Re-arm the existence probe if the target stream changed mid-listen.
    const stream = cfg.streamName || "default";
    if (stream !== lastStream) {
      lastStream = stream;
      streamSeen = false;
    }
    // Stage 1 — wait for the stream to exist before touching _search.
    if (!streamSeen) {
      streamSeen = await streamExists(cfg);
      if (state.value !== "listening") return;
      if (!streamSeen) {
        scheduleNextPoll(cfg);
        return;
      }
    }
    // Stage 2 — stream exists: confirm it carries this provider's spans.
    try {
      const res = await searchService.search(
        {
          org_identifier: cfg.orgId,
          // NOTE: the service expects the query DOUBLE-nested (query.query.sql).
          query: {
            query: {
              sql: countSql(cfg),
              start_time: windowStartMicros(cfg),
              end_time: nowMs() * 1000,
              from: 0,
              size: 10,
            },
          },
          page_type: cfg.streamType,
        },
        "ui",
      );
      if (state.value !== "listening") return;
      const n = Number(res?.data?.hits?.[0]?.zo_count ?? 0);
      if (n > 0) {
        succeed(n);
        return;
      }
    } catch {
      // Stream may not exist yet (no spans), or a transient error — keep polling
      // until the timeout, treating "no data" the same as a zero count.
    }
    scheduleNextPoll(cfg);
  };

  const scheduleNextPoll = (cfg: SpanDetectConfig) => {
    if (state.value !== "listening") return;
    timers.push(setTimeout(poll, cfg.pollMs ?? 3000));
  };

  const onVisible = () => {
    if (state.value === "listening" && !document.hidden) {
      clearTimers();
      poll();
    }
  };

  const start = () => {
    clearTimers();
    state.value = "listening";
    count.value = 0;
    streamSeen = false;
    listenStartMs = nowMs();
    if (!visibilityBound && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
      visibilityBound = true;
    }
    poll();
  };

  // Stop polling and return to idle — no further API calls until restarted.
  const reset = () => {
    clearTimers();
    state.value = "idle";
    count.value = 0;
    streamSeen = false;
  };

  // "I fixed it" — re-arm from now.
  const recheck = () => start();

  onUnmounted(() => {
    clearTimers();
    if (visibilityBound && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisible);
    }
  });

  return {
    state,
    count,
    start,
    reset,
    /** Manual "Stop listening" — alias for reset; halts all polling. */
    stop: reset,
    recheck,
    idle: computed(() => state.value === "idle"),
    listening: computed(() => state.value === "listening"),
    connected: computed(() => state.value === "connected"),
    stalled: computed(() => state.value === "stalled"),
  };
}
