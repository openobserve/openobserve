// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { chartUnit, gaugeValueUnit, promqlValueUnit } from "./alertValueUnit";

const MEM = { name: "container_memory_working_set_bytes", type: "gauge", unit: "By" };
const REQ = { name: "http_server_duration_count", type: "counter", unit: "" };
const BUCKET = { name: "http_server_duration_bucket", type: "histogram", unit: "ms" };

describe("promqlValueUnit", () => {
  it.each([
    ["a gauge read as it is", "container_memory_working_set_bytes", MEM, "bytes"],
    [
      "a gauge averaged per label",
      'avg by (k8s_node_name) (container_memory_working_set_bytes{namespace="a"})',
      MEM,
      "bytes",
    ],
    [
      "a gauge by its __name__",
      'max_over_time({__name__="container_memory_working_set_bytes"}[5m])',
      MEM,
      "bytes",
    ],
    [
      "a counter's rate",
      "sum by (service_name) (rate(http_server_duration_count[5m]))",
      REQ,
      "count-per-sec",
    ],
    [
      "a histogram quantile",
      "histogram_quantile(0.95, sum by (le) (rate(http_server_duration_bucket[5m])))",
      BUCKET,
      "milliseconds",
    ],
    ["arithmetic changes the unit", "container_memory_working_set_bytes / 1024", MEM, null],
    [
      "a ratio of two metrics",
      "container_memory_working_set_bytes / container_spec_memory_limit_bytes",
      MEM,
      null,
    ],
    ["a count of series", "count(container_memory_working_set_bytes)", MEM, null],
    ["a gauge an hour ago", "avg(container_memory_working_set_bytes offset 1h)", MEM, "bytes"],
    ["a raw counter", "sum(http_server_duration_count)", REQ, null],
    [
      "a unitless gauge",
      "avg(container_cpu_utilization)",
      { name: "container_cpu_utilization", type: "gauge", unit: "1" },
      null,
    ],
    ["a query on another metric", "avg(node_memory_free_bytes)", MEM, null],
  ])("%s", (_name, query, meta, unit) => {
    expect(promqlValueUnit(query, meta)).toBe(unit);
  });
});

describe("gaugeValueUnit", () => {
  it.each([
    ["a gauge's declared unit", MEM, "bytes"],
    [
      "a count annotation, as its name",
      { name: "k8s_node_cpu_usage", type: "gauge", unit: "{cpu}" },
      "cpu",
    ],
    ["a counter, whose raw values are totals", REQ, null],
  ])("reads %s", (_name, meta, unit) => {
    expect(gaugeValueUnit(meta)).toBe(unit);
  });

  it("charts a unit no table knows as written", () => {
    expect(chartUnit("cpu")).toEqual({ unit: "custom", unitCustom: "cpu" });
    expect(chartUnit(null).unit).toBe("numbers");
  });
});
