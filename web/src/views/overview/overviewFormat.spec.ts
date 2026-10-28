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
  mergeTopStreams,
  percentToFraction,
  percentVariant,
  sectionView,
  sizeShare,
} from "./overviewFormat";
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

  it("scales the share against the largest listed row", () => {
    const rows = mergeTopStreams(byType);
    expect(sizeShare(450, rows)).toBe(0.5);
    expect(sizeShare(5, [])).toBe(0);
  });
});
