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
import { finerCheckMinutes, missedBreachMinutes } from "./checkCadence";

describe("finerCheckMinutes", () => {
  it.each([
    [5, 1, 1],
    [10, 1, 2],
    [15, 1, 5],
    [60, 1, 20],
    [3, 1, 1],
    [10, 5, undefined],
    [2, 1, undefined],
  ])("a %i-minute span with a %i-minute floor checks every %s", (span, floor, expected) => {
    expect(finerCheckMinutes(span, floor)).toBe(expected);
  });
});

describe("missedBreachMinutes", () => {
  it.each([
    { fn: "min", operator: ">", period: 10, frequency: 10, expected: 20 },
    { fn: "max", operator: "<=", period: 10, frequency: 15, expected: 25 },
    { fn: "min", operator: ">", period: 10, frequency: 5, expected: undefined },
    { fn: "avg", operator: ">", period: 10, frequency: 10, expected: undefined },
    { fn: "min", operator: "<", period: 10, frequency: 10, expected: undefined },
  ])("$fn $operator over $period min every $frequency min → $expected", (row) => {
    expect(missedBreachMinutes(row)).toBe(row.expected);
  });
});
