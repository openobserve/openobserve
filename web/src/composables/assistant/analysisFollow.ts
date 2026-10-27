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

import { reactive } from "vue";

import type { AssistantFrame } from "./frames";
import type { StreamEnd } from "./sseParser";

/** Waits between event-log reads while a run is followed, longest last. */
export const FOLLOW_DELAYS_MS = [2_000, 3_000, 5_000, 8_000, 10_000];

/** A followed run is given up after this, the server's own stale threshold. */
export const FOLLOW_MAX_MS = 60 * 60 * 1000;

/** Consecutive failed event-log reads before the follow ends as a dropped stream. */
export const FOLLOW_MAX_FAILURES = 5;

/** How long "Caught up" stays readable once a followed run ends. */
export const CAUGHT_UP_SHOWN_MS = 5_000;

/** One incident event as the event log returns it; timestamps are microseconds. */
export interface AnalysisEvent {
  type: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

/** Why a run is being followed through the event log instead of a stream. */
export type FollowReason = "background" | "reconnect";

export interface FollowState {
  reason: FollowReason;
  since: number;
  /** Set once the log shows the run ended, so the tab can say "Caught up". */
  caughtUpAt?: number;
}

/** What following needs from the server; the incidents service by default. */
export interface FollowDeps {
  events(org: string, incidentId: string): Promise<AnalysisEvent[]>;
  report(org: string, incidentId: string): Promise<string | null>;
  wait?(ms: number, signal: AbortSignal): Promise<void>;
  now?(): number;
}

/** Where a followed run's frames go: the client's sink. */
export interface FollowSink {
  onFrame(frame: AssistantFrame, id: string | null): void;
  onKeepalive(): void;
}

const TERMINAL_EVENTS: ReadonlySet<string> = new Set([
  "ai_analysis_complete",
  "ai_analysis_failed",
  "ai_analysis_cancelled",
]);

/** Runs followed right now, keyed `org|incident`; the analysis tab reads its reconnect line here. */
export const followedAnalyses: Map<string, FollowState> = /* @__PURE__ */ reactive(
  new Map<string, FollowState>(),
);

/** The key `followedAnalyses` uses for an incident. */
export function followKey(org: string, incidentId: string): string {
  return `${org}|${incidentId}`;
}

/** The latest run's begin and its end, if it ended; `null` begin when the log holds no run. */
export function latestRunOf(events: readonly AnalysisEvent[]): {
  begin: number | null;
  end: AnalysisEvent | null;
} {
  let begin: number | null = null;
  let end: AnalysisEvent | null = null;
  for (const event of events) {
    if (event.type === "ai_analysis_begin" && (begin === null || event.timestamp >= begin)) {
      begin = event.timestamp;
      end = null;
    } else if (TERMINAL_EVENTS.has(event.type) && (begin === null || event.timestamp >= begin))
      end = event;
  }
  return { begin, end };
}

/** Follows a run the server does not stream (a re-analysis, a dropped stream) until its log ends it. */
export async function followAnalysis(
  org: string,
  incidentId: string,
  sink: FollowSink,
  signal: AbortSignal,
  opts: { reason: FollowReason; streamed: string },
  deps: FollowDeps,
): Promise<StreamEnd> {
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? waitFor;
  const key = followKey(org, incidentId);
  const started = now();
  followedAnalyses.set(key, { reason: opts.reason, since: started });
  // A background run has sent nothing yet; this moves the turn from connecting to working.
  if (opts.reason === "background") sink.onFrame({ type: "status" } as AssistantFrame, null);
  let failures = 0;
  let attempt = 0;
  try {
    while (!signal.aborted) {
      if (now() - started > FOLLOW_MAX_MS) return "error";
      await wait(FOLLOW_DELAYS_MS[Math.min(attempt, FOLLOW_DELAYS_MS.length - 1)], signal);
      attempt += 1;
      if (signal.aborted) return "abort";
      let events: AnalysisEvent[];
      try {
        events = await deps.events(org, incidentId);
        failures = 0;
      } catch {
        failures += 1;
        if (failures >= FOLLOW_MAX_FAILURES) return "error";
        continue;
      }
      sink.onKeepalive();
      const { end } = latestRunOf(events);
      if (!end) continue;
      const state = followedAnalyses.get(key);
      if (state) state.caughtUpAt = now();
      await deliverEnd(org, incidentId, end, sink, opts.streamed, deps);
      return "eof";
    }
    return "abort";
  } finally {
    const state = followedAnalyses.get(key);
    if (state && state.caughtUpAt === undefined) followedAnalyses.delete(key);
    else if (state)
      setTimeout(() => {
        if (followedAnalyses.get(key) === state) followedAnalyses.delete(key);
      }, CAUGHT_UP_SHOWN_MS);
  }
}

async function deliverEnd(
  org: string,
  incidentId: string,
  end: AnalysisEvent,
  sink: FollowSink,
  streamed: string,
  deps: FollowDeps,
): Promise<void> {
  if (end.type === "ai_analysis_cancelled") {
    sink.onFrame({ type: "cancelled" } as AssistantFrame, null);
    return;
  }
  if (end.type === "ai_analysis_failed") {
    const reason = typeof end.data?.reason === "string" ? end.data.reason : undefined;
    sink.onFrame({ type: "error", ...(reason && { message: reason }) } as AssistantFrame, null);
    return;
  }
  const report = (await deps.report(org, incidentId).catch(() => null)) ?? "";
  // The saved report starts with what streamed before a drop; only the rest is new.
  const rest = !streamed
    ? report
    : report.startsWith(streamed)
      ? report.slice(streamed.length)
      : "";
  if (rest) sink.onFrame({ type: "message_delta", content: rest } as AssistantFrame, null);
  sink.onFrame({ type: "complete" } as AssistantFrame, null);
}

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
