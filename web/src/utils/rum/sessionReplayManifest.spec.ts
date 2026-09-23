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
  findTargetIndex,
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
