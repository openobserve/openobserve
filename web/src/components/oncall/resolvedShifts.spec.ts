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
  holdersOver,
  segmentSpanKey,
  SHIFT_LOOKBACK_MICROS,
  SHIFT_LOOKUP_MICROS,
  shiftAround,
  shiftLookupWindow,
  swappableRuns,
} from "@/components/oncall/resolvedShifts";
import type { ResolvedSegment } from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY } from "@/ts/interfaces/oncall";

const DAY = MICROS_PER_DAY;
const seg = (over: Partial<ResolvedSegment> = {}): ResolvedSegment => ({
  rotation_id: "rot_1",
  from: 10 * DAY,
  to: 12 * DAY,
  user_email: "ana@o2.ai",
  ...over,
});

describe("shiftLookupWindow", () => {
  it("needs no read for a band inside the window", () => {
    expect(shiftLookupWindow(seg(), { from: 9 * DAY, to: 16 * DAY })).toBeNull();
  });

  it("reads forward from a band cut at the window's end", () => {
    expect(shiftLookupWindow(seg({ to: 16 * DAY }), { from: 9 * DAY, to: 16 * DAY })).toEqual({
      from: 10 * DAY,
      to: 10 * DAY + SHIFT_LOOKUP_MICROS,
    });
  });

  it("reaches back for a band cut at the window's start", () => {
    const lookup = shiftLookupWindow(seg({ from: 9 * DAY }), { from: 9 * DAY, to: 16 * DAY });
    expect(lookup?.from).toBe(9 * DAY - SHIFT_LOOKBACK_MICROS);
    expect(lookup!.to - lookup!.from).toBeLessThanOrEqual(31 * DAY);
  });
});

describe("shiftAround", () => {
  it("returns the whole run the band's person holds", () => {
    const runs = [seg({ from: 8 * DAY, to: 15 * DAY })];
    expect(shiftAround(seg(), runs)).toEqual({ from: 8 * DAY, to: 15 * DAY });
  });

  it("ignores a run held by somebody else, or by a cover", () => {
    const runs = [
      seg({ from: 8 * DAY, to: 15 * DAY, user_email: "bo@o2.ai" }),
      seg({ from: 8 * DAY, to: 15 * DAY, override_id: "ov" }),
    ];
    expect(shiftAround(seg(), runs)).toEqual({ from: 10 * DAY, to: 12 * DAY });
  });
});

describe("swappableRuns", () => {
  it("keeps the roster's turns from the anchor on, dropping gaps and covers", () => {
    const runs = [
      seg({ from: 0, to: 10 * DAY, user_email: "old@o2.ai" }),
      seg(),
      seg({ from: 12 * DAY, to: 13 * DAY, user_email: null }),
      seg({ from: 13 * DAY, to: 14 * DAY, override_id: "ov" }),
      seg({ from: 14 * DAY, to: 16 * DAY, user_email: "bo@o2.ai" }),
    ];
    const shifts = swappableRuns(runs, { id: "rot_1", name: "Primary" }, 10 * DAY, 8);
    expect(shifts.map((one) => [one.member, one.startMicros])).toEqual([
      ["ana@o2.ai", 10 * DAY],
      ["bo@o2.ai", 14 * DAY],
    ]);
    expect(shifts[0]).toMatchObject({ rotationId: "rot_1", rotationName: "Primary" });
  });

  it("caps the list", () => {
    const runs = Array.from({ length: 12 }, (_, i) => seg({ from: i * DAY, to: (i + 1) * DAY }));
    expect(swappableRuns(runs, { id: "rot_1", name: "Primary" }, 0, 8)).toHaveLength(8);
  });
});

describe("holdersOver", () => {
  const window = { from: 10 * DAY, to: 12 * DAY };

  it("names the one person holding the whole window as its sole holder", () => {
    const runs = [seg({ from: 9 * DAY, to: 11 * DAY }), seg({ from: 11 * DAY, to: 13 * DAY })];
    expect(holdersOver(runs, window)).toEqual({ people: ["ana@o2.ai"], sole: "ana@o2.ai" });
  });

  it("lists every holder in order, with no sole holder, when several share it", () => {
    const runs = [
      seg({ from: 11 * DAY, to: 12 * DAY, user_email: "bo@o2.ai" }),
      seg({ from: 10 * DAY, to: 11 * DAY }),
      seg({ from: 13 * DAY, to: 14 * DAY, user_email: "cy@o2.ai" }),
    ];
    expect(holdersOver(runs, window)).toEqual({ people: ["ana@o2.ai", "bo@o2.ai"], sole: null });
  });

  it("has no sole holder when part of the window is a gap or unread", () => {
    expect(
      holdersOver([seg({ to: 11 * DAY }), seg({ from: 11 * DAY, user_email: null })], window).sole,
    ).toBeNull();
    expect(holdersOver([seg({ to: 11 * DAY })], window).sole).toBeNull();
  });
});

describe("segmentSpanKey", () => {
  it("tells two rotations' segments over the same hours apart", () => {
    expect(segmentSpanKey(seg())).not.toBe(segmentSpanKey(seg({ rotation_id: "rot_2" })));
  });
});
