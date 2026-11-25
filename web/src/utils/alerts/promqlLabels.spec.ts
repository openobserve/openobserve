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
import { missingByLabel, promqlMetricNames } from "./promqlLabels";

describe("promqlMetricNames", () => {
  it.each([
    [
      '100 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100',
      ["node_cpu_seconds_total"],
    ],
    ["sum(rate(a_total[5m])) / sum(rate(b_total[5m])) > bool 0.05", ["a_total", "b_total"]],
    ['{__name__="up", job="x"} offset 5m', ["up"]],
    ["max without (pod) (mem) and on (node) cpu", ["mem", "cpu"]],
    ["", []],
  ])("%s reads %j", (query, expected) => {
    expect(promqlMetricNames(query)).toEqual(expected);
  });
});

describe("missingByLabel", () => {
  const schema: Record<string, string[]> = {
    node_cpu_seconds_total: ["_timestamp", "__hash__", "k8s_node_name", "cpu", "mode", "value"],
    other: ["instance"],
  };
  const labelsOf = (metric: string) => schema[metric];

  it.each([
    [
      "avg by (instance) (rate(node_cpu_seconds_total[5m]))",
      {
        label: "instance",
        metric: "node_cpu_seconds_total",
        labels: ["k8s_node_name", "cpu", "mode"],
      },
    ],
    ["avg by (k8s_node_name) (rate(node_cpu_seconds_total[5m]))", null],
    ["sum by (instance) (node_cpu_seconds_total) / sum by (instance) (other)", null],
    ["avg by (instance) (unknown_metric)", null],
    ['label_replace(node_cpu_seconds_total, "instance", "$1", "k8s_node_name", "(.*)")', null],
  ])("%s → %j", (query, expected) => {
    expect(missingByLabel(query, labelsOf)).toEqual(expected);
  });
});
