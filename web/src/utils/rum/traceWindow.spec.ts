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
  arrivalTraceWindowUs,
  isRumContextSpan,
  spanWindowUs,
  traceQueryWindow,
  TRACE_RANGE_PADDING_US,
  waterfallAxisSpans,
} from "@/utils/rum/traceWindow";

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

describe("arrivalTraceWindowUs", () => {
  it("pads the earliest first and latest last arrival across hits", () => {
    const hits = [
      { _first_ts: 5_000_000, _last_ts: 6_000_000 },
      { _first_ts: 1_000_000, _last_ts: 2_000_000 },
      { _first_ts: 3_000_000, _last_ts: 9_000_000 },
    ];
    expect(arrivalTraceWindowUs(hits)).toEqual({
      start: 1_000_000 - TRACE_RANGE_PADDING_US,
      end: 9_000_000 + TRACE_RANGE_PADDING_US,
    });
  });

  it("parses numeric-string timestamps", () => {
    expect(arrivalTraceWindowUs([{ _first_ts: "1000000", _last_ts: "2000000" }])).toEqual({
      start: 1_000_000 - TRACE_RANGE_PADDING_US,
      end: 2_000_000 + TRACE_RANGE_PADDING_US,
    });
  });

  it("ignores null, blank, zero and NaN values", () => {
    const hits = [
      { _first_ts: null, _last_ts: null },
      { _first_ts: "", _last_ts: "" },
      { _first_ts: 0, _last_ts: 0 },
      { _first_ts: NaN, _last_ts: NaN },
      { _first_ts: "abc", _last_ts: -5 },
      { _first_ts: 4_000_000, _last_ts: 7_000_000 },
    ];
    expect(arrivalTraceWindowUs(hits)).toEqual({
      start: 4_000_000 - TRACE_RANGE_PADDING_US,
      end: 7_000_000 + TRACE_RANGE_PADDING_US,
    });
  });

  it("returns null when no hit has a usable timestamp", () => {
    expect(arrivalTraceWindowUs([])).toBeNull();
    expect(
      arrivalTraceWindowUs([{}, { _first_ts: null, _last_ts: "" }, { _first_ts: 0 }]),
    ).toBeNull();
  });
});

describe("isRumContextSpan", () => {
  it("is true for the RUM view and for collapsed group rows", () => {
    expect(isRumContextSpan({ rum_event_type: "view" })).toBe(true);
    expect(
      isRumContextSpan({ rum_event_type: "collapsed_requests", _is_collapsed_group: true }),
    ).toBe(true);
  });

  it("is false for RUM actions and requests and for backend spans", () => {
    expect(isRumContextSpan({ rum_event_type: "action" })).toBe(false);
    expect(isRumContextSpan({ rum_event_type: "resource" })).toBe(false);
    expect(isRumContextSpan({})).toBe(false);
    expect(isRumContextSpan(null)).toBe(false);
  });
});

describe("waterfallAxisSpans", () => {
  const view = { rum_event_type: "view", start_time: 0, end_time: 1_500_000_000_000 };
  const others = {
    rum_event_type: "collapsed_requests",
    _is_collapsed_group: true,
    start_time: 1_000,
    end_time: 1_400_000_000_000,
  };
  const request = { rum_event_type: "resource", start_time: 600e9, end_time: 600.3e9 };
  const backend = { start_time: 600.1e9, end_time: 600.2e9 };

  // Regression: a 25-minute view set a 25-minute axis and hid every request bar.
  it("fits the axis to the request and its backend spans, not the page visit", () => {
    expect(spanWindowUs(waterfallAxisSpans([view, others, request, backend]))).toEqual({
      start: 600e6,
      end: 600.3e6,
    });
  });

  it("leaves a trace without RUM spans unchanged", () => {
    expect(waterfallAxisSpans([request, backend])).toEqual([request, backend]);
  });

  it("falls back to every span when only context spans are present", () => {
    expect(waterfallAxisSpans([view, others])).toEqual([view, others]);
  });

  it("returns an empty list for no spans", () => {
    expect(waterfallAxisSpans(undefined)).toEqual([]);
  });
});
