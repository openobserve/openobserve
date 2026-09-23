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
import { planSeek } from "./sessionReplaySeekPlan";

describe("planSeek", () => {
  it("is unplayable when no snapshot sits at or before the target", () => {
    expect(planSeek(500, [{ start: 0, end: 5000 }], [1000, 2000])).toEqual({
      status: "unplayable",
    });
  });

  it("is unplayable when there are no snapshots at all", () => {
    expect(planSeek(500, [{ start: 0, end: 5000 }], [])).toEqual({ status: "unplayable" });
  });

  it("is ready when one loaded range covers the anchor through the target", () => {
    expect(planSeek(4000, [{ start: 1000, end: 5000 }], [1000, 3000])).toEqual({
      status: "ready",
    });
  });

  it("is ready when the target sits exactly on a snapshot", () => {
    expect(planSeek(3000, [{ start: 3000, end: 5000 }], [1000, 3000])).toEqual({
      status: "ready",
    });
  });

  it("merges touching ranges before testing coverage", () => {
    const ranges = [
      { start: 3000, end: 4000 },
      { start: 4000, end: 6000 },
    ];
    expect(planSeek(5500, ranges, [3000])).toEqual({ status: "ready" });
  });

  it("needs a fetch from the anchor when a gap splits the loaded ranges", () => {
    const ranges = [
      { start: 3000, end: 3500 },
      { start: 5000, end: 6000 },
    ];
    expect(planSeek(5500, ranges, [3000])).toEqual({
      status: "needs-fetch",
      from: 3000,
      to: 5500,
    });
  });

  it("anchors on the latest snapshot at or before the target", () => {
    expect(planSeek(9000, [], [1000, 4000, 8000, 12000])).toEqual({
      status: "needs-fetch",
      from: 8000,
      to: 9000,
    });
  });

  it("ignores inverted ranges rather than treating them as coverage", () => {
    expect(planSeek(5000, [{ start: 9000, end: 1000 }], [1000])).toEqual({
      status: "needs-fetch",
      from: 1000,
      to: 5000,
    });
  });

  it("merges overlapping ranges so their union counts as coverage", () => {
    const ranges = [
      { start: 1000, end: 3000 },
      { start: 2500, end: 4000 },
    ];
    expect(planSeek(3800, ranges, [1000])).toEqual({ status: "ready" });
  });
});
