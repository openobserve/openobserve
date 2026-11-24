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
  hasFullPage,
  eventSecondWindow,
  inBucket,
  isK8sMetricSet,
  labelsOnMetric,
  metricPickerGroups,
  metricsSql,
  sampleLabels,
  traceDetailWindow,
} from "./pointExplorers";

const MIN = 60_000_000;

describe("Trace Explorer helpers", () => {
  it("opens a trace over its own span, one minute wider each side", () => {
    expect(traceDetailWindow({ trace_start_time: 10 * MIN, trace_end_time: 12 * MIN })).toEqual({
      startTime: 9 * MIN,
      endTime: 13 * MIN,
    });
  });

  it.each([
    [25, 25, true],
    [24, 25, false],
    [0, 25, false],
  ])("%i rows of a %i-row page has a next page: %s", (rows, size, expected) => {
    expect(hasFullPage(rows, size)).toBe(expected);
  });
});

describe("Metrics Explorer helpers", () => {
  const bucket = { startTime: 100 * MIN, endTime: 105 * MIN };

  it("keeps the clicked labels the metric carries and drops the others", () => {
    const filters = [
      { field: "service_name", value: "cart" },
      { field: "k8s_namespace", value: "shop" },
    ];
    expect(labelsOnMetric(filters, ["service_name", "value"])).toEqual([
      { field: "service_name", value: "cart" },
    ]);
  });

  it("builds the raw-sample SQL newest first, quoting values", () => {
    expect(metricsSql("cpu", [{ field: "pod", value: "a'b" }])).toBe(
      `SELECT * FROM "cpu" WHERE pod = 'a''b' ORDER BY _timestamp DESC`,
    );
    expect(metricsSql("cpu", [])).toBe(`SELECT * FROM "cpu" ORDER BY _timestamp DESC`);
  });

  it("names a sample's series by its labels, leaving out time, value and internals", () => {
    const row = { _timestamp: 1, value: 3, __name__: "cpu", __hash__: "h", pod: "a", zone: "" };
    expect(sampleLabels(row)).toEqual([
      { field: "pod", value: "a" },
      { field: "zone", value: null },
    ]);
  });

  it("marks only samples inside the clicked bucket", () => {
    expect(inBucket(100 * MIN, bucket)).toBe(true);
    expect(inBucket(105 * MIN, bucket)).toBe(false);
  });

  it("splits a Kubernetes metric set into the Pods or Nodes tab, grouped by category", () => {
    const streams = ["k8s_pod_cpu_utilization", "k8s_node_memory_usage", "http_requests_total"];
    expect(isK8sMetricSet(streams)).toBe(true);
    expect(isK8sMetricSet(["http_requests_total"])).toBe(false);
    const pods = metricPickerGroups(streams, "", "pods").flatMap((g) => g.streams);
    const nodes = metricPickerGroups(streams, "", "nodes").flatMap((g) => g.streams);
    expect(pods).toEqual(["k8s_pod_cpu_utilization"]);
    expect(nodes).toEqual(["k8s_node_memory_usage"]);
  });

  it("lists every stream in a flat set and filters by the search", () => {
    const streams = ["cpu_usage", "memory_used_bytes"];
    expect(
      metricPickerGroups(streams, "", null)
        .flatMap((g) => g.streams)
        .sort(),
    ).toEqual(streams);
    expect(metricPickerGroups(streams, "MEM", null).flatMap((g) => g.streams)).toEqual([
      "memory_used_bytes",
    ]);
  });
});

describe("eventSecondWindow", () => {
  it("is the whole second holding the event, end exclusive", () => {
    expect(eventSecondWindow(1_700_000_123_456_789)).toEqual({
      startTime: 1_700_000_123_000_000,
      endTime: 1_700_000_124_000_000,
    });
  });

  it("an event on a whole second starts its own window", () => {
    expect(eventSecondWindow(5_000_000)).toEqual({ startTime: 5_000_000, endTime: 6_000_000 });
  });
});
