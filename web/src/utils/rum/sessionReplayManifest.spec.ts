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
  dedupManifest,
  trimBeforeReplayStart,
  findTargetIndex,
  replayWatermark,
  segmentId,
  selectInitialWindow,
  snapshotStarts,
  summarizeManifest,
} from "./sessionReplayManifest";

const manifest = [
  { start: 1000, end: 1999, has_full_snapshot: true, records_count: 5 },
  { start: 2000, end: 2999, has_full_snapshot: false, records_count: 3 },
  { start: 3000, end: 3999, has_full_snapshot: false, records_count: 2 },
  { start: 4000, end: 4999, has_full_snapshot: true, records_count: 7 },
  { start: 5000, end: 5999, has_full_snapshot: false, records_count: 1 },
];

describe("sessionReplayManifest", () => {
  describe("findTargetIndex", () => {
    it("returns the last segment starting at or before the target", () => {
      expect(findTargetIndex(manifest, 3500)).toBe(2);
    });

    it("returns -1 when the target precedes the session", () => {
      expect(findTargetIndex(manifest, 10)).toBe(-1);
    });

    it("returns the final segment for a target past the session end", () => {
      expect(findTargetIndex(manifest, 99999)).toBe(4);
    });
  });

  describe("selectInitialWindow", () => {
    it("runs from the last snapshot at or before the target through the target segment", () => {
      expect(selectInitialWindow(manifest, 5500)).toEqual({
        anchorIndex: 3,
        targetIndex: 4,
        from: 4000,
        to: 5000,
        movedForViews: false,
      });
    });

    it("falls back to the first segment when no snapshot precedes the target", () => {
      const noEarlySnapshot = [
        { start: 1000, end: 1999, has_full_snapshot: false },
        { start: 2000, end: 2999, has_full_snapshot: false },
      ];
      expect(selectInitialWindow(noEarlySnapshot, 2500)).toEqual({
        anchorIndex: 0,
        targetIndex: 1,
        from: 1000,
        to: 2000,
        movedForViews: false,
      });
    });

    it("treats a target before the session as the first segment", () => {
      expect(selectInitialWindow(manifest, 0)).toEqual({
        anchorIndex: 0,
        targetIndex: 0,
        from: 1000,
        to: 1000,
        movedForViews: false,
      });
    });

    it("returns null for an empty manifest", () => {
      expect(selectInitialWindow([], 1000)).toBeNull();
    });

    it("accepts has_full_snapshot as the string form some ingest paths send", () => {
      const stringy = [
        { start: 1000, end: 1999, has_full_snapshot: "true" },
        { start: 2000, end: 2999, has_full_snapshot: false },
      ];
      expect(selectInitialWindow(stringy, 2500)?.anchorIndex).toBe(0);
    });
  });

  describe("snapshotStarts", () => {
    it("lists only the segments that can anchor a cold player", () => {
      expect(snapshotStarts(manifest)).toEqual([1000, 4000]);
    });
  });

  describe("segmentId", () => {
    it("keys a row by view, index in view, span and record count", () => {
      expect(
        segmentId({ start: 1, end: 2, records_count: 3, view_id: "v1", index_in_view: 4 }),
      ).toBe("v1|4|1|2|3");
    });

    it("falls back to span and record count when the schema has no view columns", () => {
      expect(segmentId({ start: 1, end: 2, records_count: 3 })).toBe("1|2|3");
    });

    it("keeps two views that tie on start, end and record count apart", () => {
      const a = { start: 1, end: 2, records_count: 3, view_id: "a", index_in_view: 0 };
      const b = { ...a, view_id: "b" };
      expect(segmentId(a)).not.toBe(segmentId(b));
    });
  });

  describe("trimBeforeReplayStart", () => {
    const rows = [
      { start: 1000, end: 1999, records_count: 5 },
      { start: 2000, end: 2999, records_count: 3, has_full_snapshot: true },
      { start: 3000, end: 3999, records_count: 1 },
    ];

    it("drops leading rows that start before the first full snapshot", () => {
      expect(trimBeforeReplayStart(rows, 2000)).toEqual(rows.slice(1));
    });

    it("keeps every row when replay_start is unknown", () => {
      expect(trimBeforeReplayStart(rows, null)).toBe(rows);
      expect(trimBeforeReplayStart(rows, undefined)).toBe(rows);
    });
  });

  describe("dedupManifest", () => {
    it("drops an exact duplicate row stored twice by a retried upload", () => {
      const row = { start: 1000, end: 1999, records_count: 5, view_id: "v", index_in_view: 0 };
      const next = { start: 2000, end: 2999, records_count: 1, view_id: "v", index_in_view: 1 };
      expect(dedupManifest([row, { ...row }, next])).toEqual([row, next]);
    });

    it("keeps rows that tie on start at a page edge but are different segments", () => {
      const rows = [
        { start: 1000, end: 1000, records_count: 1, view_id: "a", index_in_view: 3 },
        { start: 1000, end: 1500, records_count: 2, view_id: "b", index_in_view: 0 },
      ];
      expect(dedupManifest(rows)).toHaveLength(2);
    });

    it("keeps the manifest order of the first occurrence", () => {
      const rows = [
        { start: 3, end: 4, records_count: 1 },
        { start: 1, end: 2, records_count: 1 },
        { start: 3, end: 4, records_count: 1 },
      ];
      expect(dedupManifest(rows).map((r) => r.start)).toEqual([3, 1]);
    });
  });

  describe("summarizeManifest", () => {
    it("totals the segments and records that were listed", () => {
      expect(summarizeManifest(manifest, true)).toEqual({
        segmentCount: 5,
        recordCount: 18,
        truncated: false,
      });
    });

    it("flags a manifest that was cut short by the page cap", () => {
      expect(summarizeManifest(manifest, false).truncated).toBe(true);
    });

    it("counts a missing records_count as zero rather than NaN", () => {
      expect(summarizeManifest([{ start: 1, end: 2 }], true).recordCount).toBe(0);
    });
  });

  describe("selectInitialWindow across views", () => {
    const row = (
      view_id: string | undefined,
      index_in_view: number,
      start: number,
      end: number,
      full = false,
    ) => ({
      view_id,
      index_in_view,
      start,
      end,
      has_full_snapshot: full,
      records_count: 1,
    });

    it("anchors on the earliest snapshot among views alive at the target", () => {
      const rows = [
        row("A", 0, 0, 5, true),
        row("B", 0, 10, 15, true),
        row("A", 1, 20, 25),
        row("C", 0, 30, 35, true),
        row("A", 2, 40, 45),
        row("C", 1, 40, 46),
      ];
      const window = selectInitialWindow(rows, 41)!;
      expect(window.anchorIndex).toBe(0);
      expect(window.movedForViews).toBe(true);
    });

    it("ignores a view that ended before the target", () => {
      const rows = [row("A", 0, 0, 5, true), row("B", 0, 10, 15, true), row("B", 1, 20, 25)];
      const window = selectInitialWindow(rows, 21)!;
      expect(window.anchorIndex).toBe(1);
      expect(window.movedForViews).toBe(false);
    });

    it("keeps the legacy anchor without view columns", () => {
      const rows = [
        row(undefined, 0, 0, 5, true),
        row(undefined, 0, 10, 15, true),
        row(undefined, 0, 20, 25),
      ];
      const window = selectInitialWindow(rows, 21)!;
      expect(window.anchorIndex).toBe(1);
      expect(window.movedForViews).toBe(false);
    });
  });
  describe("replayWatermark", () => {
    const rows = [
      { start: 0, end: 5 },
      { start: 10, end: 15 },
      { start: 20, end: 25 },
    ];

    it("is the start of the next row the run has not taken", () => {
      expect(replayWatermark(rows, 0, false)).toBe(10);
    });

    it("is the last row's start while live once the run holds every row", () => {
      expect(replayWatermark(rows, 2, true)).toBe(20);
    });

    it("is unbounded once the run holds every row of a finished session", () => {
      expect(replayWatermark(rows, 2, false)).toBe(Number.POSITIVE_INFINITY);
    });
  });
});
