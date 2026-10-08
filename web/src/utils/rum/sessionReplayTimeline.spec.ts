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
  canResume,
  formatReplayTime,
  isLoadedAt,
  isSkipMarker,
  playbackMargin,
  shouldBuffer,
  skippedCount,
  timelineLength,
  toPercent,
} from "./sessionReplayTimeline";

describe("sessionReplayTimeline", () => {
  it("scales the margin with the user speed, not the skip timer speed", () => {
    expect(playbackMargin(4)).toBe(4000);
    expect(playbackMargin(0)).toBe(1000);
  });

  it("pauses one margin before the loaded end and resumes only with two margins of headroom", () => {
    expect(shouldBuffer(115_999, 120_000, 4)).toBe(false);
    expect(shouldBuffer(116_000, 120_000, 4)).toBe(true);
    expect(canResume(116_000, 123_999, 4)).toBe(false);
    expect(canResume(116_000, 124_000, 4)).toBe(true);
  });

  it("sizes the bar from the metadata and widens it only for records past the end", () => {
    const start = 1_704_110_400_000;
    expect(timelineLength(start, start + 600_000, start + 5_000)).toBe(600_000);
    expect(timelineLength(start, start + 600_000, start + 601_000)).toBe(601_000);
    expect(timelineLength(start, start - 1, start - 1)).toBe(0);
  });

  it("guards the bar scale against a zero timeline", () => {
    expect(toPercent(500, 0)).toBe(0);
    expect(toPercent(500, 1000)).toBe(50);
    expect(toPercent(5000, 1000)).toBe(100);
  });

  it("treats only player or fetched ranges as loaded", () => {
    const ranges = [
      { start: 0, end: 100, state: "inPlayer" as const },
      { start: 200, end: 300, state: "skipped" as const },
    ];
    expect(isLoadedAt(50, ranges)).toBe(true);
    expect(isLoadedAt(250, ranges)).toBe(false);
    expect(skippedCount(ranges)).toBe(1);
  });

  it("recognises a skip marker", () => {
    expect(isSkipMarker({ skipped: true, segmentId: "a", start: 1, end: 2 })).toBe(true);
    expect(isSkipMarker({ records: [] })).toBe(false);
  });

  it("formats minutes and hours", () => {
    expect(formatReplayTime(61_000)).toBe("01:01");
    expect(formatReplayTime(3_661_000)).toBe("01:01:01");
    expect(formatReplayTime(-5)).toBe("00:00");
  });
});
