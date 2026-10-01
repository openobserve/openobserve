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
import { mockMeteringDetails, mockMeteringResponse } from "./meteringMock";
import { cycleProgress, cyclesNewestFirst, projectCycleCost, subtotalCost } from "./meteringModel";

describe("meteringMock", () => {
  const now = Date.UTC(2026, 8, 22, 12);
  const mock = mockMeteringDetails(now);

  it("keeps today inside the cycle, past the projection warm-up", () => {
    expect(cycleProgress(mock, now).day).toBe(12);
    expect(projectCycleCost(mock, now)).not.toBeNull();
  });

  it("adds up the way the real API does: meters minus discount is the total", () => {
    expect(subtotalCost(mock) - Number(mock.total_discounted_amount)).toBeCloseTo(mock.total_cost);
  });

  it("returns closed cycles behind the current one, newest first", () => {
    const cycles = cyclesNewestFirst(mockMeteringResponse(now));
    expect(cycles).toHaveLength(3);
    for (let index = 1; index < cycles.length; index += 1) {
      expect(cycles[index].cycle_end).toBeLessThanOrEqual(cycles[index - 1].cycle_start);
    }
  });
});
