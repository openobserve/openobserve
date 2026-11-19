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
import { ratioThresholdFix, seriesValueRange } from "./ratioThreshold";

describe("seriesValueRange", () => {
  const points = (...values: unknown[]) => ({ data: values.map((v, i) => [i, v]) });
  it.each([
    [
      "every numeric point of every series",
      [points(0.2, null, "0.85"), points(0, "x"), { data: "not points" }],
      { min: 0, max: 0.85, fractional: true },
    ],
    ["whole numbers only", [points(0, 1)], { min: 0, max: 1, fractional: false }],
    ["no numbers", [points(null)], null],
  ])("%s", (_case, series, expected) => {
    expect(seriesValueRange(series)).toEqual(expected);
  });
});

describe("ratioThresholdFix", () => {
  const ratioValues = { min: 0, max: 0.85, fractional: true };
  it.each([
    ["90 against values in 0-0.85", { value: 90, range: ratioValues }, 0.9],
    ["a typed string", { value: "85", range: { ...ratioValues, max: 1.8 } }, 0.85],
    ["a declared ratio with no values yet", { value: 99.5, declaredRatio: true }, 0.995],
    ["a value a ratio can reach", { value: 1.5, range: ratioValues }, null],
    ["more than 100", { value: 250, range: ratioValues }, null],
    ["values above the ratio ceiling", { value: 90, range: { ...ratioValues, max: 40 } }, null],
    ["negative values", { value: 90, range: { ...ratioValues, min: -0.2 } }, null],
    [
      "whole-number values (a count or a 0/1 flag)",
      { value: 90, range: { min: 0, max: 1, fractional: false } },
      null,
    ],
    [
      "a declared ratio the values contradict",
      { value: 90, declaredRatio: true, range: { ...ratioValues, max: 40 } },
      null,
    ],
    ["no values and no declared ratio", { value: 90 }, null],
    ["an empty field", { value: "", range: ratioValues }, null],
  ])("%s", (_case, input, expected) => {
    expect(ratioThresholdFix({ declaredRatio: false, range: null, ...input })).toBe(expected);
  });
});
