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

import { describe, it, expect, vi, beforeEach } from "vitest";
import http from "./http";
import traces from "./traces";

vi.mock("./http", () => {
  const mockClient = { get: vi.fn() };
  return { default: vi.fn(() => mockClient) };
});

describe("traces service", () => {
  const mockClient = (http as unknown as ReturnType<typeof vi.fn>)();

  const T1 = "01a034c1aabc72f78880daf6c9755cff";
  const T2 = "0badc0ffee0ddf00dd15ea5eba5eba11";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getTraceTimeRanges() calls GET /api/{org}/traces/time_range with one id", () => {
    traces.getTraceTimeRanges("myorg", { traceIds: [T1] });
    expect(mockClient.get).toHaveBeenCalledWith("/api/myorg/traces/time_range", {
      params: { trace_id: T1 },
    });
  });

  it("joins many ids with commas", () => {
    traces.getTraceTimeRanges("myorg", { traceIds: [T1, T2] });
    expect(mockClient.get).toHaveBeenCalledWith("/api/myorg/traces/time_range", {
      params: { trace_id: `${T1},${T2}` },
    });
  });

  it("sends the bounds, hint and stream filter when given", () => {
    traces.getTraceTimeRanges("myorg", {
      traceIds: [T1],
      startTime: 1_000,
      endTime: 2_000,
      hintTs: 1_500,
      streams: ["default", "payments_traces"],
    });
    expect(mockClient.get).toHaveBeenCalledWith("/api/myorg/traces/time_range", {
      params: {
        trace_id: T1,
        start_time: 1_000,
        end_time: 2_000,
        hint_ts: 1_500,
        streams: "default,payments_traces",
      },
    });
  });

  it("omits a lone bound — the server rejects start_time without end_time", () => {
    traces.getTraceTimeRanges("myorg", { traceIds: [T1], startTime: 1_000 });
    expect(mockClient.get).toHaveBeenCalledWith("/api/myorg/traces/time_range", {
      params: { trace_id: T1 },
    });
  });

  it("omits an empty stream filter", () => {
    traces.getTraceTimeRanges("myorg", { traceIds: [T1], streams: [] });
    expect(mockClient.get).toHaveBeenCalledWith("/api/myorg/traces/time_range", {
      params: { trace_id: T1 },
    });
  });

  it("sends a zero bound pair — 0/0 is the server's 'no bounds' encoding, not absence", () => {
    traces.getTraceTimeRanges("myorg", { traceIds: [T1], startTime: 0, endTime: 0 });
    expect(mockClient.get).toHaveBeenCalledWith("/api/myorg/traces/time_range", {
      params: { trace_id: T1, start_time: 0, end_time: 0 },
    });
  });
});
