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

import type { AlertLibraryEntry, AlertLibraryFile } from "@/types/alertLibrary";

import {
  buildQuickAddPayload,
  countEstimatedFires,
  estimateQuery,
  libraryMarks,
  missingStreams,
  NOISY_FIRE_LIMIT,
  pickStartWithThese,
} from "./libraryQuickAdd";

const entry = (overrides: Partial<AlertLibraryEntry> = {}): AlertLibraryEntry => ({
  id: "k8s/pod-oom-killed",
  name: "pod-oom-killed",
  pack: "k8s",
  category: "pod",
  title: "Pod OOM killed",
  severity: "critical",
  description: "",
  stream: "kube_pod_status",
  stream_type: "metrics",
  query_type: "promql",
  required_streams: ["kube_pod_status"],
  path: "packs/k8s/pod-oom-killed.json",
  content_hash: "abc",
  ...overrides,
});

const promqlFile = (overrides: Record<string, unknown> = {}): AlertLibraryFile => ({
  name: "pod_oom_killed",
  enabled: true,
  query_condition: {
    type: "promql",
    promql: "sum(kube_pod_status) by (pod)",
    promql_condition: { column: "value", operator: ">", value: 0 },
  },
  trigger_condition: { period: 5, frequency: 5, silence: 30, threshold: 1, operator: ">=" },
  ...overrides,
});

const MINUTE = 60;

describe("estimateQuery", () => {
  it("applies the structured threshold to the expression, at the rule's frequency and silence", () => {
    expect(estimateQuery(promqlFile())).toEqual({
      expression: "(sum(kube_pod_status) by (pod)) > 0",
      frequencyMinutes: 5,
      silenceMinutes: 30,
    });
  });

  it("maps = to PromQL's ==", () => {
    const file = promqlFile({
      query_condition: {
        type: "promql",
        promql: "up",
        promql_condition: { operator: "=", value: 0 },
      },
    });
    expect(estimateQuery(file)?.expression).toBe("(up) == 0");
  });

  it("runs a rule-mode expression as written, since it carries its own comparison", () => {
    const file = promqlFile({
      query_condition: { type: "promql", promql_rule_mode: true, promql: "up == 0" },
    });
    expect(estimateQuery(file)?.expression).toBe("up == 0");
  });

  it("is null for a SQL rule, which is not estimated", () => {
    const file = promqlFile({ query_condition: { type: "sql", sql: "SELECT * FROM default" } });
    expect(estimateQuery(file)).toBeNull();
  });
});

describe("countEstimatedFires", () => {
  const series = (times: number[]) => ({ metric: {}, values: times.map((t) => [t, "1"]) });

  it("counts instants with any series, merging repeats inside the silence window", () => {
    // 0 and 5 min merge (silence 30); 60 min is a new episode.
    const result = [series([0, 5 * MINUTE]), series([60 * MINUTE])];
    expect(countEstimatedFires(result, 5, 30)).toBe(2);
  });

  it("counts an instant once however many series share it", () => {
    const result = [series([0]), series([0]), series([0])];
    expect(countEstimatedFires(result, 5, 0)).toBe(1);
  });

  it("is zero for an empty result", () => {
    expect(countEstimatedFires([], 5, 30)).toBe(0);
  });
});

describe("buildQuickAddPayload", () => {
  const input = {
    entry: entry(),
    file: promqlFile(),
    folderId: "f1",
    destination: "slack",
    owner: "me@example.com",
    timezone: "UTC",
  };

  it("installs paused when the estimate is above the noisy limit", () => {
    expect(buildQuickAddPayload(input, NOISY_FIRE_LIMIT + 1).enabled).toBe(false);
  });

  it("keeps the file's state at or under the limit", () => {
    expect(buildQuickAddPayload(input, NOISY_FIRE_LIMIT).enabled).toBe(true);
  });

  it("keeps the file's state when the rule was not estimated", () => {
    expect(buildQuickAddPayload(input, null).enabled).toBe(true);
  });

  it("goes through the library install builder: destination, folder and provenance", () => {
    const payload = buildQuickAddPayload(input, 3);
    expect(payload.destinations).toEqual(["slack"]);
    expect(payload.folder_id).toBe("f1");
    expect(payload.context_attributes).toMatchObject({ library_id: "k8s/pod-oom-killed" });
    expect(payload.tags).toContain("pack:k8s");
  });
});

describe("missingStreams", () => {
  const streams = { metrics: new Map([["kube_pod_status", 1]]) };

  it("names the required streams the org does not have", () => {
    const needs = entry({ required_streams: ["kube_pod_status", "kube_node_info"] });
    expect(missingStreams(needs, streams)).toEqual(["kube_node_info"]);
  });

  it("is empty when every stream exists", () => {
    expect(missingStreams(entry(), streams)).toEqual([]);
  });

  it("treats a stream of another type as missing", () => {
    expect(missingStreams(entry({ stream_type: "logs" }), streams)).toEqual(["kube_pod_status"]);
  });
});

describe("pickStartWithThese", () => {
  const fits = () => true;

  it("takes critical rules only, one per category", () => {
    const list = [
      entry({ id: "k8s/a", category: "pod" }),
      entry({ id: "k8s/b", category: "pod" }),
      entry({ id: "k8s/c", category: "node", severity: "warning" }),
      entry({ id: "k8s/d", category: "node" }),
    ];
    expect(pickStartWithThese(list, fits).map((e) => e.id)).toEqual(["k8s/a", "k8s/d"]);
  });

  it("stops at six", () => {
    const list = Array.from({ length: 9 }, (_, i) => entry({ id: `k8s/${i}`, category: `c${i}` }));
    expect(pickStartWithThese(list, fits)).toHaveLength(6);
  });

  it("skips rules that do not fit the org's data", () => {
    const list = [entry({ id: "k8s/a" }), entry({ id: "k8s/b", category: "node" })];
    expect(pickStartWithThese(list, (e) => e.id === "k8s/b").map((e) => e.id)).toEqual(["k8s/b"]);
  });

  it("keeps two packs' same-named categories apart", () => {
    const list = [
      entry({ id: "k8s/a", pack: "k8s", category: "network" }),
      entry({ id: "host/b", pack: "host", category: "network" }),
    ];
    expect(pickStartWithThese(list, fits)).toHaveLength(2);
  });
});

describe("libraryMarks", () => {
  it("reads per-rule marks from library_id", () => {
    const marks = libraryMarks([{ library_id: "k8s/pod-oom-killed" }, { name: "mine" }]);
    expect(marks.entryIds.has("k8s/pod-oom-killed")).toBe(true);
    expect(marks.entryIds.size).toBe(1);
  });

  it("reads per-pack marks from the pack: tag", () => {
    const marks = libraryMarks([{ tags: ["team:a", "pack:k8s"] }, { tags: ["pack:host"] }]);
    expect([...marks.packs].sort()).toEqual(["host", "k8s"]);
  });

  it("gives an anomaly install with no library_id a pack mark only", () => {
    const marks = libraryMarks([{ alert_type: "anomaly_detection", tags: ["pack:k8s"] }]);
    expect(marks.entryIds.size).toBe(0);
    expect(marks.packs.has("k8s")).toBe(true);
  });

  it("ignores malformed items", () => {
    const marks = libraryMarks([null, 3, { library_id: 7, tags: "pack:x" }]);
    expect(marks.entryIds.size).toBe(0);
    expect(marks.packs.size).toBe(0);
  });
});
