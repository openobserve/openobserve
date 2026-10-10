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

import { describe, it, expect } from "vitest";
import {
  MICROS_PER_DAY,
  MICROS_PER_HOUR,
  MICROS_PER_MINUTE,
  NARROW_PRESETS,
  chooseNarrowPreset,
  compareStreamsByLatest,
  estimateScanMb,
  estimateStreamMb,
  evaluateScanPolicy,
  periodToMicros,
  pickLatestStream,
  relativeWindow,
  type EstimateContext,
  type StreamStatsEntry,
} from "./estimateScanMb";

const NOW = 2_000 * MICROS_PER_DAY;
const ctx: EstimateContext = { nowUs: NOW, defaultRetentionDays: 30, superCluster: false };

const steady: StreamStatsEntry = {
  name: "steady",
  stats: {
    doc_time_min: NOW - 10 * MICROS_PER_DAY,
    doc_time_max: NOW - MICROS_PER_HOUR,
    storage_size: 10_000 - 1000 / 24,
  },
};

function lastWindow(durationUs: number) {
  return { startUs: NOW - durationUs, endUs: NOW };
}

describe("estimateStreamMb", () => {
  const rate = (10_000 - 1000 / 24) / (10 * MICROS_PER_DAY - MICROS_PER_HOUR);

  it("estimates a window inside the data span from the average rate", () => {
    const window = { startUs: NOW - 3 * MICROS_PER_DAY, endUs: NOW - 2 * MICROS_PER_DAY };
    const est = estimateStreamMb(steady, window, ctx);
    expect(est.status).toBe("known");
    expect(est.estimateMb).toBeCloseTo(rate * MICROS_PER_DAY, 6);
  });

  it("clips a window that starts before the stream's first document", () => {
    const est = estimateStreamMb(steady, lastWindow(20 * MICROS_PER_DAY), ctx);
    expect(est.estimateMb).toBeCloseTo(rate * 10 * MICROS_PER_DAY, 6);
  });

  it("returns zero for a window disjoint from the data", () => {
    const window = { startUs: NOW - 30 * MICROS_PER_DAY, endUs: NOW - 20 * MICROS_PER_DAY };
    expect(estimateStreamMb(steady, window, ctx).estimateMb).toBe(0);
  });

  it("extrapolates past doc_time_max instead of counting it as empty", () => {
    const stale: StreamStatsEntry = {
      name: "stale",
      stats: {
        doc_time_min: NOW - 2 * MICROS_PER_DAY,
        doc_time_max: NOW - MICROS_PER_DAY,
        storage_size: 100,
      },
    };
    const est = estimateStreamMb(stale, lastWindow(MICROS_PER_HOUR), ctx);
    expect(est.status).toBe("known");
    expect(est.estimateMb).toBeCloseTo(100 / 24, 6);
  });

  it("never counts time after now", () => {
    const window = { startUs: NOW - MICROS_PER_DAY, endUs: NOW + MICROS_PER_DAY };
    expect(estimateStreamMb(steady, window, ctx).estimateMb).toBeCloseTo(rate * MICROS_PER_DAY, 6);
  });

  it("uses retention as the denominator when the span exceeds it", () => {
    const old: StreamStatsEntry = {
      name: "old",
      stats: { doc_time_min: NOW - 100 * MICROS_PER_DAY, doc_time_max: NOW, storage_size: 3000 },
      settings: { data_retention: 30 },
    };
    const est = estimateStreamMb(old, lastWindow(MICROS_PER_DAY), ctx);
    expect(est.estimateMb).toBeCloseTo(100, 6);
  });

  it("falls back to the org retention when the stream sets none", () => {
    const old: StreamStatsEntry = {
      name: "old",
      stats: { doc_time_min: NOW - 100 * MICROS_PER_DAY, doc_time_max: NOW, storage_size: 3000 },
      settings: { data_retention: 0 },
    };
    expect(
      estimateStreamMb(old, lastWindow(MICROS_PER_DAY), { ...ctx, defaultRetentionDays: 10 })
        .estimateMb,
    ).toBeCloseTo(300, 6);
  });

  it("uses the observed span when no retention is known at all", () => {
    const old: StreamStatsEntry = {
      name: "old",
      stats: { doc_time_min: NOW - 100 * MICROS_PER_DAY, doc_time_max: NOW, storage_size: 3000 },
    };
    expect(
      estimateStreamMb(old, lastWindow(MICROS_PER_DAY), { ...ctx, defaultRetentionDays: 0 })
        .estimateMb,
    ).toBeCloseTo(30, 6);
  });

  it("is unknown when doc_time_max is 0", () => {
    const fresh: StreamStatsEntry = {
      name: "fresh",
      stats: { doc_time_min: 0, doc_time_max: 0, storage_size: 0 },
    };
    expect(estimateStreamMb(fresh, lastWindow(MICROS_PER_HOUR), ctx)).toEqual({
      name: "fresh",
      status: "unknown",
      estimateMb: null,
      cause: "no-stats",
    });
  });

  it("is unknown when the stats object is missing", () => {
    expect(estimateStreamMb({ name: "bare" }, lastWindow(MICROS_PER_HOUR), ctx).cause).toBe(
      "no-stats",
    );
  });

  it("is unknown when the span is under one minute", () => {
    const short: StreamStatsEntry = {
      name: "short",
      stats: { doc_time_min: NOW - 30 * 1_000_000, doc_time_max: NOW - 1_000_000, storage_size: 5 },
    };
    expect(estimateStreamMb(short, lastWindow(MICROS_PER_HOUR), ctx).cause).toBe("short-span");
  });

  it("is unknown on any super-cluster deployment", () => {
    const est = estimateStreamMb(steady, lastWindow(15 * MICROS_PER_MINUTE), {
      ...ctx,
      superCluster: true,
    });
    expect(est).toMatchObject({ status: "unknown", cause: "super-cluster", estimateMb: null });
  });
});

describe("estimateScanMb + evaluateScanPolicy", () => {
  const fresh = (name: string): StreamStatsEntry => ({
    name,
    stats: { doc_time_max: 0, doc_time_min: 0, storage_size: 0 },
  });

  it("sums known streams", () => {
    const other: StreamStatsEntry = { ...steady, name: "other" };
    const one = estimateScanMb(["steady"], [steady], lastWindow(MICROS_PER_DAY), ctx);
    const both = estimateScanMb(
      ["steady", "other"],
      [steady, other],
      lastWindow(MICROS_PER_DAY),
      ctx,
    );
    expect(both.status).toBe("known");
    expect(both.knownMb).toBeCloseTo(one.knownMb * 2, 6);
  });

  it("allows a known estimate at or under the threshold and blocks above it", () => {
    const est = estimateScanMb(["steady"], [steady], lastWindow(MICROS_PER_DAY), ctx);
    expect(evaluateScanPolicy(est, est.knownMb)).toMatchObject({
      allowed: true,
      reason: "within-threshold",
    });
    expect(evaluateScanPolicy(est, est.knownMb - 1)).toMatchObject({
      allowed: false,
      reason: "over-threshold",
    });
  });

  it("allows fresh unknown streams for a window of at most one hour", () => {
    const est = estimateScanMb(["fresh"], [fresh("fresh")], lastWindow(MICROS_PER_HOUR), ctx);
    expect(est.status).toBe("unknown");
    expect(evaluateScanPolicy(est, 100)).toMatchObject({
      allowed: true,
      reason: "unknown-allowed",
    });
  });

  it("blocks fresh unknown streams for a window over one hour", () => {
    const est = estimateScanMb(["fresh"], [fresh("fresh")], lastWindow(MICROS_PER_HOUR + 1), ctx);
    expect(evaluateScanPolicy(est, 100)).toMatchObject({
      allowed: false,
      reason: "unknown-window",
    });
  });

  it("blocks a super-cluster 15 minute window with no allowance", () => {
    const est = estimateScanMb(["steady"], [steady], lastWindow(15 * MICROS_PER_MINUTE), {
      ...ctx,
      superCluster: true,
    });
    expect(evaluateScanPolicy(est, 1e12)).toMatchObject({
      allowed: false,
      reason: "unknown-unvalidated",
    });
  });

  it("blocks 11 fresh unknown streams on a 15 minute window", () => {
    const names = Array.from({ length: 11 }, (_, i) => `f${i}`);
    const est = estimateScanMb(names, names.map(fresh), lastWindow(15 * MICROS_PER_MINUTE), ctx);
    expect(evaluateScanPolicy(est, 1e12)).toMatchObject({
      allowed: false,
      reason: "unknown-unvalidated",
    });
  });

  it("allows 10 fresh unknown streams on a 15 minute window", () => {
    const names = Array.from({ length: 10 }, (_, i) => `f${i}`);
    const est = estimateScanMb(names, names.map(fresh), lastWindow(15 * MICROS_PER_MINUTE), ctx);
    expect(evaluateScanPolicy(est, 1e12).allowed).toBe(true);
  });

  it("blocks a multi-stream search when the known subtotal already exceeds the threshold", () => {
    const est = estimateScanMb(
      ["steady", "fresh"],
      [steady, fresh("fresh")],
      lastWindow(MICROS_PER_HOUR),
      ctx,
    );
    expect(est.status).toBe("unknown");
    expect(evaluateScanPolicy(est, 1)).toMatchObject({ allowed: false, reason: "over-threshold" });
    expect(evaluateScanPolicy(est, 1e6)).toMatchObject({
      allowed: true,
      reason: "unknown-allowed",
    });
  });

  it("reports sources absent from the readable list as unresolved, never as zero", () => {
    const est = estimateScanMb(["steady", "ghost"], [steady], lastWindow(MICROS_PER_HOUR), ctx);
    expect(est.status).toBe("unresolved");
    expect(est.unresolvedSources).toEqual(["ghost"]);
    expect(evaluateScanPolicy(est, 1e12)).toMatchObject({ allowed: false, reason: "unresolved" });
  });

  it("treats an empty source list as unresolved", () => {
    expect(estimateScanMb([], [steady], lastWindow(MICROS_PER_HOUR), ctx).status).toBe(
      "unresolved",
    );
  });
});

describe("Narrow to", () => {
  it("lists presets in ascending duration", () => {
    const durations = NARROW_PRESETS.map((p) => p.durationUs);
    expect(durations).toEqual([...durations].sort((a, b) => a - b));
    expect(NARROW_PRESETS[0].period).toBe("1m");
  });

  it("picks the largest preset under the threshold, shorter than the current window", () => {
    const pick = chooseNarrowPreset(["steady"], [steady], ctx, 200, 7 * MICROS_PER_DAY);
    expect(pick?.period).toBe("3h");
    expect(pick?.decision.allowed).toBe(true);
    expect(pick?.estimate.knownMb).toBeLessThanOrEqual(200);
  });

  it("returns null when no preset fits", () => {
    expect(chooseNarrowPreset(["steady"], [steady], ctx, 0.0001, 7 * MICROS_PER_DAY)).toBeNull();
  });

  it("never offers a window at least as wide as the current one", () => {
    const pick = chooseNarrowPreset(["steady"], [steady], ctx, 1e12, 3 * MICROS_PER_HOUR);
    expect(pick?.period).toBe("2h");
  });

  it("offers one hour for a fresh unknown stream and nothing on a super cluster", () => {
    const fresh: StreamStatsEntry = { name: "fresh", stats: { doc_time_max: 0 } };
    expect(chooseNarrowPreset(["fresh"], [fresh], ctx, 100, 7 * MICROS_PER_DAY)?.period).toBe("1h");
    expect(
      chooseNarrowPreset(
        ["steady"],
        [steady],
        { ...ctx, superCluster: true },
        1e12,
        7 * MICROS_PER_DAY,
      ),
    ).toBeNull();
  });
});

describe("periods", () => {
  it("parses relative periods", () => {
    expect(periodToMicros("15m")).toBe(15 * MICROS_PER_MINUTE);
    expect(periodToMicros("2w")).toBe(14 * MICROS_PER_DAY);
    expect(periodToMicros("1M")).toBe(31 * MICROS_PER_DAY);
    expect(periodToMicros("30s")).toBe(30_000_000);
    expect(periodToMicros("bogus")).toBeNull();
    expect(relativeWindow("1h", NOW)).toEqual({ startUs: NOW - MICROS_PER_HOUR, endUs: NOW });
    expect(relativeWindow("x", NOW)).toBeNull();
  });
});

describe("shared tie comparator", () => {
  const s = (name: string, max: number): StreamStatsEntry => ({
    name,
    stats: { doc_time_max: max },
  });

  it("orders by doc_time_max descending, then name ascending", () => {
    const sorted = [s("b", 5), s("a", 5), s("c", 9), s("d", 1)].sort(compareStreamsByLatest);
    expect(sorted.map((x) => x.name)).toEqual(["c", "a", "b", "d"]);
  });

  it("picks the first tie by name rather than the last", () => {
    expect(pickLatestStream([s("zeta", 7), s("alpha", 7)])).toBe("alpha");
  });

  it("preselects nothing when every stream has doc_time_max 0", () => {
    expect(pickLatestStream([s("a", 0), s("b", 0)])).toBeNull();
    expect(pickLatestStream([])).toBeNull();
  });
});
