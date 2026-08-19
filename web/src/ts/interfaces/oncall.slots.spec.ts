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

/**
 * Which slots a schedule staffs — the question two screens ask and got wrong
 * the same way.
 *
 * A rotation can staff **two** slots: `slot`, held by whoever is on shift, and
 * `secondary_slot`, held by whoever sits `secondary_offset` handovers ahead off
 * the same roster. Reading only `slot` therefore reports one slot for a team
 * whose rotation the backend auto-staffed — which, since 2026-08-17, is every
 * team with two or more members.
 *
 * What that cost: `resolved-schedule` was only ever fetched `?slot=primary`, so
 * the calendar drew a secondary lane it could never fill; and the cover
 * dialog's slot picker is gated on there being more than one slot, so a cover
 * meant for the secondary landed on the primary and evicted whoever was on
 * call. Two visible faults, one missing field.
 */

import { describe, expect, it } from "vitest";

import type { Rotation } from "./oncall";
import { DEFAULT_SLOT, sameSlot, staffedSlots } from "./oncall";

function rotation(overrides: Partial<Rotation> = {}): Rotation {
  return {
    name: "Weekly",
    members: ["ana@o2.ai", "bo@o2.ai"],
    shift_micros: 604_800_000_000,
    anchor_micros: 1_785_000_000_000_000,
    ...overrides,
  };
}

describe("staffedSlots", () => {
  it("reports the default slot for a rotation that names none", () => {
    expect(staffedSlots([rotation()])).toEqual([DEFAULT_SLOT]);
  });

  /// The case the old `rotations.map(r => r.slot)` missed entirely, and the
  /// common one: ONE rotation, TWO slots.
  it("counts a rotation's derived secondary as a slot of its own", () => {
    expect(staffedSlots([rotation({ secondary_slot: "secondary" })])).toEqual([
      "primary",
      "secondary",
    ]);
  });

  it("counts two hand-built rotations in two slots", () => {
    expect(
      staffedSlots([rotation({ slot: "primary" }), rotation({ slot: "secondary" })]),
    ).toEqual(["primary", "secondary"]);
  });

  /// Layers — two rotations sharing a slot — are one slot, not two. They
  /// compete by priority and restriction; that is what follow-the-sun is.
  it("does not double-count layers of the same slot", () => {
    expect(
      staffedSlots([
        rotation({ slot: "primary", priority: 30 }),
        rotation({ slot: "primary", priority: 10 }),
      ]),
    ).toEqual(["primary"]);
  });

  /// The server compares slots case- and whitespace-insensitively, so a screen
  /// that treated `Secondary` and `secondary` as two would render an empty lane
  /// beside a full one and ask which of them a cover meant.
  it("folds together spellings the server treats as one slot", () => {
    const slots = staffedSlots([
      rotation({ slot: "primary" }),
      rotation({ slot: " Primary " }),
      rotation({ slot: "secondary" }),
    ]);

    expect(slots).toHaveLength(2);
    expect(sameSlot(slots[0], "primary")).toBe(true);
    expect(sameSlot(slots[1], "secondary")).toBe(true);
  });

  /// First-seen spelling wins, so what the picker offers is what the schedule
  /// actually says rather than a normalised form nobody typed.
  it("keeps the spelling the schedule used", () => {
    expect(staffedSlots([rotation({ slot: "Follow-the-sun" })])).toEqual(["Follow-the-sun"]);
  });

  it("answers nothing for a team with no rotations", () => {
    expect(staffedSlots([])).toEqual([]);
  });
});
