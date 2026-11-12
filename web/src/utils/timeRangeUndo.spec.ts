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
import { popUndoStep, pushUndoStep, type TimeRangeUndoStep } from "./timeRangeUndo";

const step = (label: string, startUs = 0, endUs = 1): TimeRangeUndoStep => ({
  label,
  selectedType: "absolute",
  calendarToken: null,
  relativePeriod: "m",
  relativeValue: 15,
  startUs,
  endUs,
});

const rolling = (value: number): TimeRangeUndoStep => ({
  ...step(`Last ${value} minutes`),
  selectedType: "relative",
  relativeValue: value,
});

describe("time range undo stack", () => {
  it("pops the last step first and names the range it returns to", () => {
    let stack = pushUndoStep([], rolling(15));
    stack = pushUndoStep(stack, step("Nov 11, 12:31 – 12:36", 10, 20));
    const first = popUndoStep(stack);
    expect(first?.step.label).toBe("Nov 11, 12:31 – 12:36");
    const second = popUndoStep(first!.rest);
    expect(second?.step.label).toBe("Last 15 minutes");
    expect(popUndoStep(second!.rest)).toBeNull();
  });

  it("does not stack the same range twice in a row", () => {
    const stack = pushUndoStep(pushUndoStep([], rolling(15)), rolling(15));
    expect(stack).toHaveLength(1);
    expect(pushUndoStep(stack, rolling(30))).toHaveLength(2);
  });

  it("drops the oldest step past the limit", () => {
    let stack: TimeRangeUndoStep[] = [];
    for (let i = 0; i < 5; i++) stack = pushUndoStep(stack, step(String(i), i, i + 1), 3);
    expect(stack.map((item) => item.label)).toEqual(["2", "3", "4"]);
  });
});
