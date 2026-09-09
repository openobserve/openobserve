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
import { traceQueryWindow, TRACE_RANGE_PADDING_US } from "@/utils/rum/traceWindow";

describe("traceQueryWindow", () => {
  it("pads an indexed range on both sides", () => {
    expect(traceQueryWindow({ start_time: 1_000_000, end_time: 2_000_000 }, 7, 8)).toEqual({
      startTime: 1_000_000 - TRACE_RANGE_PADDING_US,
      endTime: 2_000_000 + TRACE_RANGE_PADDING_US,
    });
  });

  it("falls back to the caller's window when there is no range", () => {
    expect(traceQueryWindow(undefined, 7, 8)).toEqual({ startTime: 7, endTime: 8 });
  });
});
