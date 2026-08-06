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

// useSpanDetect — backs the "have my spans arrived?" status bar with a single,
// user-triggered check (no background polling).
//
// states: idle → checking → connected | stalled   ·   check() runs one probe.
//
// The user runs their app, then clicks "Test". Each check is a two-stage gate:
//   1. Existence — the target stream isn't created until the first span lands,
//      so we first hit the cheap streams-list ("stream stats") API. If the
//      stream is absent we report "not found yet" (no _search, so no 404 noise).
//   2. Confirm — once the stream exists, a COUNT over a recent window (so
//      time-partition pruning scans only the newest file(s); tiny size, no rows
//      materialized) confirms it carries THIS provider's spans; >0 → connected.
// One check per click — nothing runs in the background, nothing to time out.
//
// The stream is whatever the install command writes to: when the card declares
// a `stream_input`, the user's value drives BOTH the command's {stream}
// placeholder and this `streamName` (see AIRichSetupCard.vue), else it falls
// back to the SDK default. TODO(detect): confirm each provider's stored span
// attribute on the ingest side so the `filter` matches on day one.

import { ref, computed } from "vue";
import searchService from "@/services/search";
import streamService from "@/services/stream";

export type DetectState = "idle" | "checking" | "connected" | "stalled";

export interface SpanDetectConfig {
  orgId: string;
  streamType: "traces" | "logs" | "metrics";
  /** Stream to count over. Falls back to "default" until configured. */
  streamName?: string;
  /**
   * How `streamName` is matched against existing streams:
   *  - "exact" (default): the stream must be named exactly `streamName`, then a
   *    COUNT confirms it carries matching rows.
   *  - "keyword": `streamName` is a substring; ANY stream whose name contains it
   *    counts as connected (existence alone). This is how metrics are detected —
   *    OTLP metrics fan out into one stream per metric (e.g. `sqlserver_*`), so
   *    there's no single stream to count over, and the stream is only created on
   *    the first datapoint, making existence proof enough.
   */
  match?: "exact" | "keyword";
  /** SQL WHERE fragment, e.g. "gen_ai_system = 'Anthropic'". */
  filter: string;
  /** Count spans from this far back, so a span that arrived during setup still
   *  counts. Default 600000 (10 min). */
  lookbackMs?: number;
}

export interface UseStreamDetectOptions {
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

export function useStreamDetect(opts: UseStreamDetectOptions) {
  const state = ref<DetectState>("idle");
  const count = ref(0);

  const succeed = (n = 1) => {
    state.value = "connected";
    count.value = Math.max(1, n);
    if (opts.onConnect && !prefersReducedMotion()) opts.onConnect();
  };

  // Window start (micros): `lookbackMs` before now, so a span that landed during
  // setup still counts. Narrow window → only the newest file(s) scanned.
  const windowStartMicros = (cfg: SpanDetectConfig) =>
    (nowMs() - (cfg.lookbackMs ?? 600000)) * 1000;

  // One cheap COUNT over [windowStart, now]. >0 matches → connected.
  // `stream` is user-typed (the stream-name input), so escape it for the quoted
  // identifier (double any `"`) — it can't break out of the FROM clause. `filter`
  // is authored config (a SQL WHERE fragment by design), interpolated as-is.
  const countSql = (cfg: SpanDetectConfig) => {
    const stream = (cfg.streamName || "default").replaceAll('"', '""');
    return `SELECT COUNT(*) as zo_count FROM "${stream}" WHERE (${cfg.filter}) AND _timestamp >= ${windowStartMicros(cfg)}`;
  };

  // Stage 1 — does the target stream exist yet? Uses the streams-list ("stream
  // stats") API, which returns 200 with an empty/filtered list (no 404) until
  // the first span creates the stream.
  const streamExists = async (
    cfg: SpanDetectConfig,
  ): Promise<{ exists: boolean; matched: number }> => {
    const stream = cfg.streamName || "default";
    try {
      const res = await streamService.nameList(cfg.orgId, cfg.streamType, false, -1, -1, stream);
      const list: any[] = res?.data?.list ?? [];
      // "keyword" mode: nameList already filters by substring, so any returned
      // stream is a match (e.g. sqlserver_user_connection_count for "sqlserver").
      if (cfg.match === "keyword") {
        return { exists: list.length > 0, matched: list.length };
      }
      // "exact" mode: nameList's keyword is a substring → require the exact name.
      return { exists: list.some((s) => s?.name === stream), matched: 1 };
    } catch {
      return { exists: false, matched: 0 };
    }
  };

  // One user-triggered check. idle/stalled/connected → checking → result.
  const check = async () => {
    if (state.value === "checking") return; // ignore double-clicks mid-check
    state.value = "checking";
    count.value = 0;
    const cfg = opts.config();

    // Stage 1 — stream must exist before we touch _search.
    const { exists, matched } = await streamExists(cfg);
    if (state.value !== "checking") return; // reset() raced us
    if (!exists) {
      state.value = "stalled";
      return;
    }

    // Keyword mode (metrics): the matching stream existing IS the proof —
    // there's no single stream to COUNT over. Skip stage 2.
    if (cfg.match === "keyword") {
      succeed(matched);
      return;
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
      if (state.value !== "checking") return;
      const n = Number(res?.data?.hits?.[0]?.zo_count ?? 0);
      if (n > 0) {
        succeed(n);
        return;
      }
    } catch {
      // Transient error or no data — treated the same as a zero count.
    }
    state.value = "stalled";
  };

  // Back to the untested state.
  const reset = () => {
    state.value = "idle";
    count.value = 0;
  };

  return {
    state,
    count,
    /** Run one check ("Test" / "Test Again" / "I fixed it"). */
    check,
    reset,
    idle: computed(() => state.value === "idle"),
    checking: computed(() => state.value === "checking"),
    connected: computed(() => state.value === "connected"),
    stalled: computed(() => state.value === "stalled"),
  };
}
