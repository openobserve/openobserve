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
import { promqlMetricNames } from "./promqlMetrics";

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
});
