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
import { pickUnit, toBase } from "./durationUnits";

const REMIND = ["min", "h"] as const;
const KEEP = ["seconds", "min", "h"] as const;

describe("durationUnits", () => {
  it.each([
    [90, "min", REMIND, 90, "min"],
    [240, "min", REMIND, 4, "h"],
    [0, "min", REMIND, 0, "min"],
    [45, "seconds", KEEP, 45, "seconds"],
    [120, "seconds", KEEP, 2, "min"],
    [3600, "seconds", KEEP, 1, "h"],
    [5400, "seconds", KEEP, 90, "min"],
  ] as const)("pickUnit(%d %s) shows %d %s", (value, base, units, amount, unit) => {
    expect(pickUnit(value, base, units)).toEqual({ amount, unit });
  });

  it.each([
    ["min", REMIND],
    ["seconds", KEEP],
  ] as const)("round-trips every %s value exactly", (base, units) => {
    for (const x of [0, 1, 90, 240, 45, 3600, 5400]) {
      const { amount, unit } = pickUnit(x, base, units);
      expect(toBase(amount, unit, base)).toBe(x);
    }
  });

  it("converts a fractional amount without float dust", () => {
    expect(toBase(0.1, "h", "min")).toBe(6);
  });
});
