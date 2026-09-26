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
import { buildExemplarMarkers, exemplarIdentity } from "./buildExemplarMarkers";
import type { ExemplarApiItem, ExemplarQueryResult } from "@/ts/interfaces/exemplars";

const START_S = 1_700_000_000;
const END_S = START_S + 3600;
const WINDOW = { startMs: START_S * 1000, endMs: END_S * 1000 };

const result = (
  queryIndex: number,
  exemplars: ExemplarApiItem[],
  seriesLabels: Record<string, string> = {},
): ExemplarQueryResult => ({
  queryIndex,
  query: `q${queryIndex}`,
  response: { status: "success", data: [{ seriesLabels, exemplars }] },
});

const item = (
  timestamp: number,
  value: string,
  labels: Record<string, string> = {},
): ExemplarApiItem => ({ timestamp, value, labels });

describe("buildExemplarMarkers", () => {
  it("converts fractional seconds to milliseconds", () => {
    const markers = buildExemplarMarkers(
      [result(0, [item(START_S + 10.25, "1.5", { trace_id: "t1" })])],
      WINDOW,
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].tsMs).toBe((START_S + 10) * 1000 + 250);
    expect(markers[0].value).toBe(1.5);
  });

  it("drops exemplars outside the window, including the ones the API returns from 30 minutes before start", () => {
    const markers = buildExemplarMarkers(
      [
        result(0, [
          item(START_S - 1800, "1", { trace_id: "early" }),
          item(START_S, "2", { trace_id: "at-start" }),
          item(END_S, "3", { trace_id: "at-end" }),
          item(END_S + 1, "4", { trace_id: "late" }),
        ]),
      ],
      WINDOW,
    );
    expect(markers.map((m) => m.traceId)).toEqual(["at-start", "at-end"]);
  });

  it("drops non-numeric values", () => {
    const markers = buildExemplarMarkers([result(0, [item(START_S + 1, "NaN")])], WINDOW);
    expect(markers).toEqual([]);
  });

  it("draws a repeated trace_id + span_id + timestamp exactly once", () => {
    const labels = { trace_id: "t1", span_id: "s1" };
    const markers = buildExemplarMarkers(
      [result(0, [item(START_S + 5, "1", labels), item(START_S + 5, "1", labels)])],
      WINDOW,
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].spanId).toBe("s1");
  });

  it("keeps both queries' markers when their selectors differ", () => {
    const markers = buildExemplarMarkers(
      [
        result(0, [item(START_S + 1, "1", { trace_id: "a" })]),
        result(1, [item(START_S + 2, "2", { trace_id: "b" })]),
      ],
      WINDOW,
    );
    expect(markers.map((m) => m.queryIndexes)).toEqual([[0], [1]]);
  });

  it("merges an exemplar two queries return into one marker tagged with both", () => {
    const shared = item(START_S + 1, "0.4", { trace_id: "a", span_id: "s" });
    const markers = buildExemplarMarkers(
      [result(1, [shared], { job: "api" }), result(0, [shared])],
      WINDOW,
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].queryIndexes).toEqual([0, 1]);
    expect(markers[0].seriesLabels).toEqual({ job: "api" });
  });

  it("merges a trace-less duplicate on timestamp, value and labels", () => {
    const markers = buildExemplarMarkers(
      [
        result(0, [item(START_S + 1, "7", { pod: "a", zone: "z" })]),
        result(1, [
          item(START_S + 1, "7", { zone: "z", pod: "a" }),
          item(START_S + 1, "8", { pod: "a", zone: "z" }),
        ]),
      ],
      WINDOW,
    );
    expect(markers).toHaveLength(2);
    expect(markers.find((m) => m.value === 7)?.queryIndexes).toEqual([0, 1]);
    expect(markers.find((m) => m.value === 8)?.queryIndexes).toEqual([1]);
    expect(markers[0].traceId).toBeUndefined();
  });

  it("sorts output by timestamp", () => {
    const markers = buildExemplarMarkers(
      [result(0, [item(START_S + 9, "1", { trace_id: "late" }), item(START_S + 2, "1")])],
      WINDOW,
    );
    expect(markers.map((m) => m.tsMs)).toEqual([(START_S + 2) * 1000, (START_S + 9) * 1000]);
  });
});

describe("exemplarIdentity", () => {
  it("ignores value and extra labels when a trace_id exists", () => {
    expect(exemplarIdentity({ trace_id: "t", span_id: "s", x: "1" }, 5, 1)).toBe(
      exemplarIdentity({ trace_id: "t", span_id: "s" }, 5, 2),
    );
  });

  it("is label-order independent without a trace_id", () => {
    expect(exemplarIdentity({ a: "1", b: "2" }, 5, 1)).toBe(
      exemplarIdentity({ b: "2", a: "1" }, 5, 1),
    );
  });
});
