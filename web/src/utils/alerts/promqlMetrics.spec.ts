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
import { promqlMetricNames, promqlScaledToPercent, promqlWithMetric } from "./promqlMetrics";

describe("promqlMetricNames", () => {
  it.each([
    ["", []],
    ["up", ["up"]],
    [
      '100 * (1 - avg by (k8s_node_name) (rate(node_cpu_seconds_total{mode="idle"}[5m])))',
      ["node_cpu_seconds_total"],
    ],
    [
      'sum by (service) (rate(http_server_duration_count{status=~"5.."}[5m])) / sum by (service) (rate(http_server_duration_count[5m]))',
      ["http_server_duration_count"],
    ],
    [
      "container_memory_working_set_bytes / on(pod) group_left kube_pod_container_resource_limits offset 1h > bool 0.85",
      ["container_memory_working_set_bytes", "kube_pod_container_resource_limits"],
    ],
    ['{__name__="job:errors:rate5m", job="api"} > 1e3', ["job:errors:rate5m"]],
    ['label_replace(up, "dst", "$1", "src", "(.*)") and on() vector(1)', ["up"]],
  ])("%s reads %j", (query, names) => {
    expect(promqlMetricNames(query)).toEqual(names);
  });

  it.each([
    ['sum(rate(a{c=~"5.."}[5m])) / sum(rate(a[5m])) * 100', true],
    ['100 * (1 - avg(rate(cpu{mode="idle"}[5m])))', true],
    ["(a / b) *100", true],
    ["a * 100 > 5", false],
    ["sum(a) / sum(b)", false],
    ["a * 1000", false],
    ["1 - a * 100", false],
    ["100 * a - 1", false],
    ["(1 - a / b) * 100", true],
    ["a / 1e-3 * 100", true],
  ])("%s reads in percent: %s", (query, percent) => {
    expect(promqlScaledToPercent(query)).toBe(percent);
  });
});

describe("promqlWithMetric", () => {
  it.each([
    ["rate(a_count[10m])", "rate(b_count[10m])"],
    [
      'sum by (svc) (rate(a_count{code=~"5.."}[5m])) / sum by (svc) (rate(a_count[5m]))',
      'sum by (svc) (rate(b_count{code=~"5.."}[5m])) / sum by (svc) (rate(b_count[5m]))',
    ],
    ['{__name__="a_count", job="a_count"}', '{__name__="b_count", job="a_count"}'],
    ["rate(a_count[5m]) / rate(c[5m])", undefined],
    ["rate(a_count_total[5m])", undefined],
    ["", undefined],
  ])("%s on b_count reads %s", (query, moved) => {
    expect(promqlWithMetric(query, "a_count", "b_count")).toBe(moved);
  });
});
