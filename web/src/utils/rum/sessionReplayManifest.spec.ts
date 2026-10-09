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
  pickTrack,
  splitIntoTracks,
  trimBeforeReplayStart,
  findTargetIndex,
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

const viewRow = (view_id: string, start: number, end: number, extra: Record<string, any> = {}) => ({
  start,
  end,
  view_id,
  ...extra,
});

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
      });
    });

    it("treats a target before the session as the first segment", () => {
      expect(selectInitialWindow(manifest, 0)).toEqual({
        anchorIndex: 0,
        targetIndex: 0,
        from: 1000,
        to: 1000,
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

  describe("splitIntoTracks", () => {
    // Segment spans of the two-tab recording behind #15171: the tabs alternate every five seconds.
    const twoTabs = [
      viewRow("a", 0, 4890, { has_full_snapshot: true }),
      viewRow("b", 3060, 7560, { has_full_snapshot: true }),
      viewRow("a", 5590, 10490),
      viewRow("b", 8460, 12960),
      viewRow("a", 11200, 16090),
    ];

    it("puts views that overlap in time on separate tracks, each in manifest order", () => {
      const tracks = splitIntoTracks(twoTabs);
      expect(tracks.map((track) => track.views.map((view) => view.id))).toEqual([["a"], ["b"]]);
      expect(tracks[0].rows.map((row) => row.start)).toEqual([0, 5590, 11200]);
      expect(tracks[1].rows.map((row) => row.start)).toEqual([3060, 8460]);
    });

    it("keeps the pages of one tab, one after another, on a single track", () => {
      const rows = [
        viewRow("orders", 0, 8400),
        viewRow("dashboard", 8600, 14000),
        viewRow("orders-again", 14600, 20200),
      ];
      const tracks = splitIntoTracks(rows);
      expect(tracks).toHaveLength(1);
      expect(tracks[0].rows).toEqual(rows);
    });

    it("keeps a view that starts exactly when the previous one ended on the same track", () => {
      expect(splitIntoTracks([viewRow("a", 0, 1000), viewRow("b", 1000, 2000)])).toHaveLength(1);
    });

    it("continues the track that ended last when more than one is free", () => {
      const rows = [viewRow("a", 0, 1000), viewRow("b", 500, 3000), viewRow("c", 4000, 5000)];
      const tracks = splitIntoTracks(rows);
      expect(tracks.map((track) => track.views.map((view) => view.id))).toEqual([
        ["a"],
        ["b", "c"],
      ]);
    });

    it("keeps rows from a schema without view columns on one track, unchanged", () => {
      const tracks = splitIntoTracks(manifest);
      expect(tracks).toHaveLength(1);
      expect(tracks[0].rows).toEqual(manifest);
    });
  });

  describe("pickTrack", () => {
    const tracks = splitIntoTracks([
      viewRow("a", 0, 4000, { records_count: 3 }),
      viewRow("b", 2000, 9000, { records_count: 9 }),
      viewRow("c", 5000, 6000, { records_count: 1 }),
    ]);

    it("picks the track with the most recorded activity when there is no target", () => {
      expect(pickTrack(tracks, null)?.views[0].id).toBe("b");
    });

    it("picks the only track recording at the target", () => {
      expect(pickTrack(tracks, 1000)?.views[0].id).toBe("a");
    });

    it("breaks a tie at the target by recorded activity", () => {
      expect(pickTrack(tracks, 3000)?.views[0].id).toBe("b");
    });

    it("picks the track recording just before an uncovered target, else the busiest", () => {
      const apart = splitIntoTracks([
        viewRow("a", 1000, 2000, { records_count: 9 }),
        viewRow("b", 1500, 4000, { records_count: 1 }),
      ]);
      expect(pickTrack(apart, 5000)?.views[0].id).toBe("b");
      expect(pickTrack(apart, 500)?.views[0].id).toBe("a");
    });

    it("passes over a track with no full snapshot to start from", () => {
      const blind = splitIntoTracks([
        viewRow("a", 0, 4000, { records_count: 9 }),
        viewRow("b", 2000, 9000, { records_count: 1, has_full_snapshot: true }),
      ]);
      expect(pickTrack(blind, null)?.views[0].id).toBe("b");
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
});
