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

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CAUGHT_UP_SHOWN_MS,
  FOLLOW_MAX_FAILURES,
  followAnalysis,
  followedAnalyses,
  followKey,
  latestRunOf,
  type AnalysisEvent,
  type FollowDeps,
} from "./analysisFollow";

const begin = (timestamp: number): AnalysisEvent => ({ type: "ai_analysis_begin", timestamp });
const end = (type: string, timestamp: number, data?: Record<string, unknown>): AnalysisEvent => ({
  type,
  timestamp,
  ...(data && { data }),
});

function harness(logs: (AnalysisEvent[] | Error)[], report: string | null = "## Report") {
  const frames: unknown[] = [];
  const sink = { onFrame: vi.fn((frame: unknown) => frames.push(frame)), onKeepalive: vi.fn() };
  let read = 0;
  const deps: FollowDeps = {
    events: vi.fn(async () => {
      const next = logs[Math.min(read, logs.length - 1)];
      read += 1;
      if (next instanceof Error) throw next;
      return next;
    }),
    report: vi.fn(async () => report),
    wait: async () => undefined,
    now: () => 0,
  };
  return { frames, sink, deps };
}

afterEach(() => {
  followedAnalyses.clear();
  vi.useRealTimers();
});

describe("latestRunOf", () => {
  it("reads the newest run and ignores an older run's end", () => {
    expect(latestRunOf([begin(1), end("ai_analysis_complete", 2), begin(3)])).toEqual({
      begin: 3,
      end: null,
    });
    expect(latestRunOf([]).begin).toBeNull();
  });
});

describe("followAnalysis", () => {
  it("follows a background run until the log completes it, then delivers the saved report", async () => {
    const { frames, sink, deps } = harness([
      [begin(1)],
      [begin(1), end("ai_analysis_complete", 2)],
    ]);
    const result = await followAnalysis(
      "o",
      "i",
      sink,
      new AbortController().signal,
      { reason: "background", streamed: "" },
      deps,
    );
    expect(result).toBe("eof");
    expect(frames).toEqual([
      { type: "status" },
      { type: "message_delta", content: "## Report" },
      { type: "complete" },
    ]);
    expect(sink.onKeepalive).toHaveBeenCalledTimes(2);
  });

  it("sends only what a dropped stream had not shown yet, and says it caught up", async () => {
    vi.useFakeTimers();
    const { frames, sink, deps } = harness(
      [[begin(1), end("ai_analysis_complete", 2)]],
      "## Rep and more",
    );
    await followAnalysis(
      "o",
      "i",
      sink,
      new AbortController().signal,
      { reason: "reconnect", streamed: "## Rep" },
      deps,
    );
    expect(frames).toEqual([{ type: "message_delta", content: " and more" }, { type: "complete" }]);
    expect(followedAnalyses.get(followKey("o", "i"))?.caughtUpAt).toBe(0);
    vi.advanceTimersByTime(CAUGHT_UP_SHOWN_MS);
    expect(followedAnalyses.has(followKey("o", "i"))).toBe(false);
  });

  it("maps a failed or cancelled run to its own frame", async () => {
    const failed = harness([[begin(1), end("ai_analysis_failed", 2, { reason: "LLM timeout" })]]);
    await followAnalysis(
      "o",
      "i",
      failed.sink,
      new AbortController().signal,
      { reason: "background", streamed: "" },
      failed.deps,
    );
    expect(failed.frames.at(-1)).toEqual({ type: "error", message: "LLM timeout" });
    const cancelled = harness([[begin(1), end("ai_analysis_cancelled", 2)]]);
    await followAnalysis(
      "o",
      "i",
      cancelled.sink,
      new AbortController().signal,
      { reason: "background", streamed: "" },
      cancelled.deps,
    );
    expect(cancelled.frames.at(-1)).toEqual({ type: "cancelled" });
  });

  it("ends as a dropped stream after repeated failed reads, and stops on abort", async () => {
    const failing = harness(Array.from({ length: FOLLOW_MAX_FAILURES }, () => new Error("503")));
    const result = await followAnalysis(
      "o",
      "i",
      failing.sink,
      new AbortController().signal,
      { reason: "background", streamed: "" },
      failing.deps,
    );
    expect(result).toBe("error");
    expect(followedAnalyses.size).toBe(0);
    const controller = new AbortController();
    controller.abort();
    const idle = harness([[begin(1)]]);
    expect(
      await followAnalysis(
        "o",
        "i",
        idle.sink,
        controller.signal,
        { reason: "background", streamed: "" },
        idle.deps,
      ),
    ).toBe("abort");
  });
});
