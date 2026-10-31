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

import { describe, expect, it } from "vitest";
import {
  elapsedParts,
  firingTotal,
  hasKnownSince,
  levelCount,
  mergeTopStreams,
  oldestKnownFiring,
  isUnderOnePercent,
  percentOf,
  percentToFraction,
  percentVariant,
  sectionView,
  signalSplit,
  signalVariant,
  sizeShare,
} from "./overviewFormat";
import { buildOverview } from "./overviewFixtures";
import type { OverviewStreamTypeSummary } from "@/ts/interfaces/overview";

const summary = (stream_type: string, top: Array<[string, number]>): OverviewStreamTypeSummary => ({
  stream_type,
  count: top.length,
  doc_num: 0,
  storage_size_mb: 0,
  compressed_size_mb: 0,
  top: top.map(([name, storage_size_mb]) => ({ name, doc_num: 1, storage_size_mb })),
});

describe("sectionView", () => {
  const idle = { pending: false, failed: false };

  it("maps each status to its own view", () => {
    expect(sectionView({ status: "ok", data: {} }, idle)).toBe("ok");
    expect(sectionView({ status: "error", error: "boom" }, idle)).toBe("error");
    expect(sectionView({ status: "forbidden" }, idle)).toBe("forbidden");
    expect(sectionView({ status: "locked", reason: "x" }, idle)).toBe("locked");
  });

  it("loading wins while the first load is in flight", () => {
    expect(sectionView(undefined, { pending: true, failed: false })).toBe("loading");
  });

  it("treats a failed request or a missing section as an error", () => {
    expect(sectionView({ status: "ok", data: {} }, { pending: false, failed: true })).toBe("error");
    expect(sectionView(undefined, idle)).toBe("error");
    expect(sectionView({ status: "ok" }, idle)).toBe("error");
  });
});

describe("limit helpers", () => {
  it("picks the bar colour by percent", () => {
    expect(percentVariant(10)).toBe("default");
    expect(percentVariant(80)).toBe("warning");
    expect(percentVariant(100)).toBe("danger");
  });

  it("clamps the bar fraction", () => {
    expect(percentToFraction(45)).toBe(0.45);
    expect(percentToFraction(250)).toBe(1);
    expect(percentToFraction(-3)).toBe(0);
  });
});

describe("top streams", () => {
  const byType = [
    summary("logs", [
      ["app", 500],
      ["web", 100],
    ]),
    summary("metrics", [["cpu", 900]]),
    summary("traces", [
      ["t1", 50],
      ["t2", 40],
      ["t3", 30],
    ]),
  ];

  it("merges every type, largest first, capped", () => {
    const rows = mergeTopStreams(byType, 4);
    expect(rows.map((r) => `${r.stream_type}/${r.name}`)).toEqual([
      "metrics/cpu",
      "logs/app",
      "logs/web",
      "traces/t1",
    ]);
  });

  it("scales the share against total storage, zero for an empty total", () => {
    expect(sizeShare(450, 900)).toBe(0.5);
    expect(sizeShare(5, 0)).toBe(0);
  });
});

describe("percentOf", () => {
  it("rounds to a whole percent", () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(2, 3)).toBe(67);
    expect(percentOf(512, 2048)).toBe(25);
  });

  it("is zero, not NaN or Infinity, for a zero total", () => {
    expect(percentOf(5, 0)).toBe(0);
    expect(percentOf(0, 0)).toBe(0);
  });
});

describe("isUnderOnePercent", () => {
  it("is true only for a non-empty share below one percent", () => {
    expect(isUnderOnePercent(1, 1000)).toBe(true);
    expect(isUnderOnePercent(10, 1000)).toBe(false);
    expect(isUnderOnePercent(0, 1000)).toBe(false);
    expect(isUnderOnePercent(5, 0)).toBe(false);
  });
});

describe("signalSplit", () => {
  const typed = (stream_type: string, storage_size_mb: number): OverviewStreamTypeSummary => ({
    ...summary(stream_type, []),
    storage_size_mb,
  });

  it("splits logs, metrics and traces by stored size and ignores other types", () => {
    const rows = signalSplit([
      typed("logs", 710),
      typed("metrics", 190),
      typed("traces", 100),
      typed("enrichment_tables", 99999),
    ]);
    expect(rows.map((r) => [r.signal, r.percent])).toEqual([
      ["logs", 71],
      ["metrics", 19],
      ["traces", 10],
    ]);
    expect(rows.map((r) => r.segment.pct)).toEqual([71, 19, 10]);
  });

  it("returns zero shares for a zero total and for missing signals", () => {
    const rows = signalSplit([typed("logs", 0)]);
    expect(rows.map((r) => r.percent)).toEqual([0, 0, 0]);
    expect(rows.map((r) => r.segment.pct)).toEqual([0, 0, 0]);
    expect(signalSplit([]).map((r) => r.sizeMb)).toEqual([0, 0, 0]);
  });

  it("gives each signal a distinct colour and unknown types a neutral grey", () => {
    const variants = ["logs", "metrics", "traces"].map(signalVariant);
    expect(new Set(variants).size).toBe(3);
    expect(signalVariant("enrichment_tables")).toBe("muted");
  });
});

describe("elapsedParts", () => {
  it("splits milliseconds into days, hours and minutes", () => {
    expect(elapsedParts((26 * 60 + 5) * 60_000)).toEqual({ days: 1, hours: 2, minutes: 5 });
    expect(elapsedParts(59_999)).toEqual({ days: 0, hours: 0, minutes: 0 });
    expect(elapsedParts(9 * 3_600_000 + 40 * 60_000)).toEqual({ days: 0, hours: 9, minutes: 40 });
  });

  it("never goes negative", () => {
    expect(elapsedParts(-120_000)).toEqual({ days: 0, hours: 0, minutes: 0 });
  });
});

describe("firing totals", () => {
  const alerts = buildOverview().alerts.data!;

  it("reads the per-level counts", () => {
    expect(levelCount(alerts, "critical")).toBe(2);
    expect(levelCount(undefined, "critical")).toBe(0);
  });

  it("totals every firing level, or falls back to the state counts without levels", () => {
    expect(firingTotal(alerts)).toBe(3);
    const noLevels = { ...alerts, firing_by_level: undefined } as never;
    expect(firingTotal(noLevels)).toBe(3);
  });

  it("treats a zero or negative since as unknown", () => {
    expect(hasKnownSince(0)).toBe(false);
    expect(hasKnownSince(-5)).toBe(false);
    expect(hasKnownSince(1_699_996_400_000_000)).toBe(true);
  });

  it("takes the oldest age from the first firing row with a known since", () => {
    const [first, second] = alerts.firing;
    const rows = [{ ...first, since: 0 }, second];
    expect(oldestKnownFiring({ ...alerts, firing: rows })?.name).toBe(second.name);
    expect(oldestKnownFiring({ ...alerts, firing: [{ ...first, since: 0 }] })).toBeUndefined();
    expect(oldestKnownFiring(undefined)).toBeUndefined();
  });
});
