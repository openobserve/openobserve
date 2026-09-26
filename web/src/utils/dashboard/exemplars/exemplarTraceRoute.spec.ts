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
  EXEMPLAR_FALLBACK_TRACES_STREAM,
  EXEMPLAR_FALLBACK_WINDOW_US,
  buildExemplarTraceRoute,
} from "./exemplarTraceRoute";
import type { ExemplarMarker } from "@/ts/interfaces/exemplars";

const marker = (over: Partial<ExemplarMarker> = {}): ExemplarMarker => ({
  id: "m",
  queryIndexes: [0],
  tsMs: 1_700_000_000_000,
  value: 1,
  labels: {},
  seriesLabels: {},
  traceId: "abc",
  spanId: "span1",
  ...over,
});

describe("buildExemplarTraceRoute", () => {
  it("opens a found trace with its stream, range and span", () => {
    const route = buildExemplarTraceRoute(
      marker(),
      { state: "found", stream: "payments", startUs: 10, endUs: 20 },
      "org1",
    );
    expect(route).toEqual({
      name: "traceDetails",
      query: {
        stream: "payments",
        trace_id: "abc",
        span_id: "span1",
        from: "10",
        to: "20",
        org_identifier: "org1",
      },
    });
  });

  it("opens an unverified trace on the default stream with a 15 minute window either side", () => {
    const route = buildExemplarTraceRoute(
      marker({ spanId: undefined }),
      { state: "unverified", reason: "timeout" },
      "org1",
    ) as { query: Record<string, string> };
    const tsUs = 1_700_000_000_000_000;
    expect(EXEMPLAR_FALLBACK_WINDOW_US).toBe(900_000_000);
    expect(route.query).toEqual({
      stream: EXEMPLAR_FALLBACK_TRACES_STREAM,
      trace_id: "abc",
      from: String(tsUs - 900_000_000),
      to: String(tsUs + 900_000_000),
      org_identifier: "org1",
    });
  });

  it("returns nothing for a trace that is not available", () => {
    expect(buildExemplarTraceRoute(marker(), { state: "not_available" }, "org1")).toBeNull();
  });

  it("returns nothing without a trace_id", () => {
    expect(
      buildExemplarTraceRoute(marker({ traceId: undefined }), { state: "none" }, "org1"),
    ).toBeNull();
  });
});
