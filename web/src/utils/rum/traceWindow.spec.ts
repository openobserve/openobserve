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
import { spanWindowUs, traceQueryWindow, TRACE_RANGE_PADDING_US } from "@/utils/rum/traceWindow";

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

describe("spanWindowUs", () => {
  it("returns the earliest start and latest end across disjoint spans", () => {
    const spans = [
      { start_time: 5_000_000, end_time: 6_000_000 },
      { start_time: 1_000_000, end_time: 2_000_000 },
    ];
    expect(spanWindowUs(spans)).toEqual({ start: 1_000, end: 6_000 });
  });

  it("lets a root that starts first and ends last set both bounds", () => {
    const spans = [
      { start_time: 2_000_000, end_time: 3_000_000 },
      { start_time: 1_000_000, end_time: 9_000_000 },
      { start_time: 4_000_000, end_time: 5_000_000 },
    ];
    expect(spanWindowUs(spans)).toEqual({ start: 1_000, end: 9_000 });
  });

  it("floors the start and ceils the end when ns values do not divide by 1000", () => {
    expect(spanWindowUs([{ start_time: 1_000_999, end_time: 2_000_001 }])).toEqual({
      start: 1_000,
      end: 2_001,
    });
  });

  it("parses numeric-string timestamps", () => {
    expect(spanWindowUs([{ start_time: "1000000", end_time: "2000000" }])).toEqual({
      start: 1_000,
      end: 2_000,
    });
  });

  it("skips a span with a blank end_time whole, so its start does not lower the window", () => {
    const spans = [
      { start_time: 1_000_000, end_time: "" },
      { start_time: 3_000_000, end_time: 4_000_000 },
    ];
    expect(spanWindowUs(spans)).toEqual({ start: 3_000, end: 4_000 });
  });

  it("skips a span with a missing start_time whole, so its end does not raise the window", () => {
    const spans = [{ start_time: 1_000_000, end_time: 2_000_000 }, { end_time: 9_000_000 }];
    expect(spanWindowUs(spans)).toEqual({ start: 1_000, end: 2_000 });
  });

  it("returns null for an empty list", () => {
    expect(spanWindowUs([])).toBeNull();
  });

  it("returns null for a null or undefined list", () => {
    expect(spanWindowUs(null)).toBeNull();
    expect(spanWindowUs(undefined)).toBeNull();
  });

  it("returns null when no span has a usable pair of timestamps", () => {
    const spans = [
      { start_time: "", end_time: 2_000_000 },
      { start_time: "abc", end_time: 2_000_000 },
      { start_time: 1_000_000 },
      null,
    ];
    expect(spanWindowUs(spans)).toBeNull();
  });

  it("handles a 150 000-span list, which a spread into Math.min/Math.max cannot", () => {
    const spans = Array.from({ length: 150_000 }, (_, i) => ({
      start_time: 10_000_000 + i * 1_000,
      end_time: 20_000_000 + i * 1_000,
    }));
    expect(spanWindowUs(spans)).toEqual({ start: 10_000, end: 169_999 });
  });
});
