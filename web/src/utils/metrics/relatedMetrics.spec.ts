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

import { describe, it, expect } from "vitest";
import { rankRelatedMetrics, relatedCandidates } from "./relatedMetrics";
import { MISC_GROUP_ID } from "./prefixGrouping";
import { baseNameOf } from "./metricDefaults";

const familyOf = (name: string) => baseNameOf(name);

describe("relatedCandidates", () => {
  const names = ["http_a", "http_b", "node_a", "lonely_metric", "odd_one"];
  const groups: Record<string, string> = {
    http_a: "http",
    http_b: "http",
    node_a: "node",
    lonely_metric: MISC_GROUP_ID,
    odd_one: MISC_GROUP_ID,
  };
  const prefixOf = (name: string) => groups[name] ?? MISC_GROUP_ID;

  it("takes the other metrics of the selected metric's prefix group", () => {
    expect(relatedCandidates("http_a", names, prefixOf)).toEqual(["http_b"]);
  });

  it("falls back to every metric when the selected one is in misc", () => {
    expect(relatedCandidates("lonely_metric", names, prefixOf)).toEqual([
      "http_a",
      "http_b",
      "node_a",
      "odd_one",
    ]);
  });
});

describe("rankRelatedMetrics", () => {
  it("excludes the selected metric's own family", () => {
    const selected = "http_server_request_duration_seconds_bucket";
    const ranked = rankRelatedMetrics(
      selected,
      [
        selected,
        "http_server_request_duration_seconds_sum",
        "http_server_request_duration_seconds_count",
        "http_server_active_requests",
        "http_server_response_body_size_bytes_bucket",
      ],
      {},
      familyOf,
    ).map((r) => r.name);

    // http+server+bucket (3) outranks http+server (2).
    expect(ranked).toEqual([
      "http_server_response_body_size_bytes_bucket",
      "http_server_active_requests",
    ]);
  });

  it("ranks by shared name segments first", () => {
    const ranked = rankRelatedMetrics(
      "node_memory_free_bytes",
      ["node_cpu_seconds_total", "node_memory_total_bytes", "node_memory_free_ratio"],
      {},
      familyOf,
    ).map((r) => r.name);
    // memory+free+node (3) and memory+bytes+node (3) beat node (1); the tie goes alphabetical.
    expect(ranked).toEqual([
      "node_memory_free_ratio",
      "node_memory_total_bytes",
      "node_cpu_seconds_total",
    ]);
  });

  it("breaks a segment tie by label overlap, then alphabetically", () => {
    const labelsByStream = {
      sel_x: ["job", "instance", "pod"],
      b_y: ["job", "instance", "pod"],
      a_y: ["job"],
      c_y: ["job"],
    };
    const ranked = rankRelatedMetrics("sel_x", ["c_y", "a_y", "b_y"], labelsByStream, familyOf);
    expect(ranked.map((r) => r.name)).toEqual(["b_y", "a_y", "c_y"]);
    expect(ranked[0].sharedLabels).toEqual(["instance", "job", "pod"]);
  });

  it("ranks a misc metric's candidates by label overlap alone", () => {
    const labelsByStream: Record<string, string[]> = { lonely: ["job", "pod"] };
    const names = Array.from({ length: 20 }, (_, i) => `other${i}`);
    names.forEach((n, i) => (labelsByStream[n] = i === 7 ? ["job", "pod"] : ["zone"]));
    const ranked = rankRelatedMetrics("lonely", names, labelsByStream, familyOf);
    expect(ranked).toHaveLength(20);
    expect(ranked[0].name).toBe("other7");
  });
});
