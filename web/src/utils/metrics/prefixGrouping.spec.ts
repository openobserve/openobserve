// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect } from "vitest";
import {
  computePrefixAssignment,
  computeSuffixGroups,
  matchesSearch,
  MISC_GROUP_ID,
  MISC_GROUP_LABEL,
  type PrefixGroup,
} from "./prefixGrouping";

/**
 * The groups half of the one entry point. There is deliberately no exported
 * `computePrefixGroups`: a caller handed groups without the assignment that
 * produced them re-derives it, and re-deriving it is the bug this module's own
 * doc block warns about.
 */
const computePrefixGroups = (
  names: string[],
  opts?: Parameters<typeof computePrefixAssignment>[1],
): PrefixGroup[] => computePrefixAssignment(names, opts).groups;

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

/** The canonical example from the PRD. */
const TRUTH_CASE = [
  "envoy_cluster_a",
  "envoy_cluster_b",
  "envoy_http_x",
  "node_cpu_1",
  "node_cpu_2",
  "lonely_metric",
];

const sumCounts = (groups: { count: number }[]): number =>
  groups.reduce((acc, g) => acc + g.count, 0);

// ---------------------------------------------------------------------------
// computePrefixGroups
// ---------------------------------------------------------------------------

describe("computePrefixGroups", () => {
  it("groups the PRD truth case by deepest qualifying prefix", () => {
    // Candidate coverage over the input:
    //   envoy (3), envoy_cluster (2), envoy_http (1),
    //   node (2), node_cpu (2), lonely (1), lonely_metric (1)
    // Assignment picks the DEEPEST candidate covering >= 2 distinct names:
    //   envoy_cluster_a/b -> envoy_cluster
    //   envoy_http_x      -> envoy_http fails (1) -> falls back to envoy (3)
    //   node_cpu_1/2      -> node_cpu
    //   lonely_metric     -> nothing qualifies -> misc
    // `envoy` then holds only 1 name (the other two went deeper), so the
    // under-sized fold moves envoy_http_x into misc as well.
    const groups = computePrefixGroups(TRUTH_CASE);

    expect(groups).toEqual<PrefixGroup[]>([
      { id: "envoy_cluster", label: "envoy_cluster", count: 2, depth: 2 },
      { id: "node_cpu", label: "node_cpu", count: 2, depth: 2 },
      { id: MISC_GROUP_ID, label: MISC_GROUP_LABEL, count: 2, depth: 0 },
    ]);
  });

  it("folds a qualifying-but-under-sized group into misc", () => {
    // `envoy` covers 3 names so it qualifies, but two of them prefer the deeper
    // `envoy_cluster`, leaving `envoy` with a single member. No rendered group
    // may be smaller than minGroupSize.
    const groups = computePrefixGroups([
      "envoy_cluster_a",
      "envoy_cluster_b",
      "envoy_http_x",
    ]);

    expect(groups).toEqual<PrefixGroup[]>([
      { id: "envoy_cluster", label: "envoy_cluster", count: 2, depth: 2 },
      { id: MISC_GROUP_ID, label: MISC_GROUP_LABEL, count: 1, depth: 0 },
    ]);
    expect(groups.every((g) => g.id === MISC_GROUP_ID || g.count >= 2)).toBe(
      true,
    );
  });

  it("assigns every name to exactly one group (counts sum to total)", () => {
    const names = [
      ...TRUTH_CASE,
      "node_memory_bytes",
      "node_memory_free",
      "prometheus_build_info",
      "http_requests_total",
      "http_requests_failed",
      "http_duration_seconds",
      "standalone",
    ];

    const groups = computePrefixGroups(names);

    expect(sumCounts(groups)).toBe(names.length);
    // ids are unique — no name is double counted across groups
    expect(new Set(groups.map((g) => g.id)).size).toBe(groups.length);
  });

  it("sorts by count desc, then label asc", () => {
    const names = [
      // bbb_x -> 3 members
      "bbb_x_1",
      "bbb_x_2",
      "bbb_x_3",
      // aaa_y and ccc_z -> 2 members each (tie -> label asc)
      "aaa_y_1",
      "aaa_y_2",
      "ccc_z_1",
      "ccc_z_2",
    ];

    const groups = computePrefixGroups(names);

    expect(groups.map((g) => [g.id, g.count])).toEqual([
      ["bbb_x", 3],
      ["aaa_y", 2],
      ["ccc_z", 2],
    ]);
  });

  it("always sorts misc last, even when it is the largest group", () => {
    const names = ["a_b", "c_d", "e_f", "x_y_1", "x_y_2"];

    const groups = computePrefixGroups(names);

    expect(groups).toEqual<PrefixGroup[]>([
      { id: "x_y", label: "x_y", count: 2, depth: 2 },
      { id: MISC_GROUP_ID, label: MISC_GROUP_LABEL, count: 3, depth: 0 },
    ]);
    expect(groups[groups.length - 1].id).toBe(MISC_GROUP_ID);
  });

  it("sends unshared names with no underscore to misc", () => {
    const names = ["up", "down", "node_cpu_a", "node_cpu_b"];

    const groups = computePrefixGroups(names);

    expect(groups).toEqual<PrefixGroup[]>([
      { id: "node_cpu", label: "node_cpu", count: 2, depth: 2 },
      { id: MISC_GROUP_ID, label: MISC_GROUP_LABEL, count: 2, depth: 0 },
    ]);
    expect(sumCounts(groups)).toBe(names.length);
  });

  it("treats a whole underscore-free name as its depth-1 candidate", () => {
    // With minGroupSize 1 the single name `up` qualifies as its own depth-1 group.
    const groups = computePrefixGroups(["up", "node_cpu_a"], {
      minGroupSize: 1,
    });

    expect(groups).toEqual<PrefixGroup[]>([
      { id: "node_cpu", label: "node_cpu", count: 1, depth: 2 },
      { id: "up", label: "up", count: 1, depth: 1 },
    ]);
  });

  it("honours a custom maxDepth", () => {
    const names = ["a_b_c_1", "a_b_c_2", "a_b_d_1"];

    // depth 2 (default): only `a_b` is considered -> single group of 3
    expect(computePrefixGroups(names)).toEqual<PrefixGroup[]>([
      { id: "a_b", label: "a_b", count: 3, depth: 2 },
    ]);

    // depth 3: `a_b_c` (2 names) qualifies; `a_b_d` (1 name) falls back to `a_b`,
    // which is then left under-sized and folded into misc
    expect(computePrefixGroups(names, { maxDepth: 3 })).toEqual<PrefixGroup[]>([
      { id: "a_b_c", label: "a_b_c", count: 2, depth: 3 },
      { id: MISC_GROUP_ID, label: MISC_GROUP_LABEL, count: 1, depth: 0 },
    ]);

    // depth 1: everything collapses onto `a`
    expect(computePrefixGroups(names, { maxDepth: 1 })).toEqual<PrefixGroup[]>([
      { id: "a", label: "a", count: 3, depth: 1 },
    ]);
  });

  it("honours a custom minGroupSize", () => {
    const names = ["svc_a_1", "svc_a_2", "svc_b_1"];

    // minGroupSize 3: `svc_a` (2) no longer qualifies, `svc` (3) does
    expect(computePrefixGroups(names, { minGroupSize: 3 })).toEqual<
      PrefixGroup[]
    >([{ id: "svc", label: "svc", count: 3, depth: 1 }]);

    // minGroupSize 4: nothing qualifies -> everything is misc
    expect(computePrefixGroups(names, { minGroupSize: 4 })).toEqual<
      PrefixGroup[]
    >([{ id: MISC_GROUP_ID, label: MISC_GROUP_LABEL, count: 3, depth: 0 }]);
  });

  it("ignores blanks and duplicates", () => {
    const groups = computePrefixGroups([
      "node_cpu_a",
      "node_cpu_a",
      "  node_cpu_b  ",
      "",
      "   ",
    ]);

    expect(groups).toEqual<PrefixGroup[]>([
      { id: "node_cpu", label: "node_cpu", count: 2, depth: 2 },
    ]);
  });

  it("returns an empty list for an empty input", () => {
    expect(computePrefixGroups([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computeSuffixGroups
// ---------------------------------------------------------------------------

describe("computeSuffixGroups", () => {
  it("counts the trailing segment of each name", () => {
    const names = [
      "http_requests_total",
      "http_errors_total",
      "node_cpu_seconds_total",
      "http_duration_bucket",
      "node_memory_bytes",
    ];

    expect(computeSuffixGroups(names)).toEqual([
      { id: "total", label: "total", count: 3 },
      { id: "bucket", label: "bucket", count: 1 },
      { id: "bytes", label: "bytes", count: 1 },
    ]);
  });

  it("skips names with no underscore entirely", () => {
    const groups = computeSuffixGroups(["up", "down", "http_requests_total"]);

    expect(groups).toEqual([{ id: "total", label: "total", count: 1 }]);
    expect(sumCounts(groups)).toBe(1);
  });

  it("sorts by count desc, then label asc", () => {
    const groups = computeSuffixGroups(TRUTH_CASE);

    expect(groups).toEqual([
      { id: "1", label: "1", count: 1 },
      { id: "2", label: "2", count: 1 },
      { id: "a", label: "a", count: 1 },
      { id: "b", label: "b", count: 1 },
      { id: "metric", label: "metric", count: 1 },
      { id: "x", label: "x", count: 1 },
    ]);
  });

  it("ignores empty trailing segments, blanks and duplicates", () => {
    expect(
      computeSuffixGroups([
        "http_requests_total",
        "http_requests_total",
        "trailing_",
        "",
      ]),
    ).toEqual([{ id: "total", label: "total", count: 1 }]);
  });

  it("returns an empty list for an empty input", () => {
    expect(computeSuffixGroups([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// matchesSearch
// ---------------------------------------------------------------------------

describe("matchesSearch", () => {
  const NAME = "node_cpu_seconds_total";
  const HELP = "Seconds the CPUs spent in each mode";

  it("matches an empty query", () => {
    expect(matchesSearch(NAME, HELP, "")).toBe(true);
    expect(matchesSearch(NAME, HELP, "   ")).toBe(true);
    // punctuation-only queries reduce to zero terms
    expect(matchesSearch(NAME, HELP, "-- ,, ??")).toBe(true);
  });

  it("requires every term to match, regardless of order", () => {
    expect(matchesSearch(NAME, HELP, "node total")).toBe(true);
    expect(matchesSearch(NAME, HELP, "total node")).toBe(true);
    expect(matchesSearch(NAME, HELP, "node missingterm")).toBe(false);
  });

  it("searches the help text as well as the name", () => {
    expect(matchesSearch(NAME, HELP, "mode")).toBe(true);
    // one term from the name, one from the help
    expect(matchesSearch(NAME, HELP, "cpu spent")).toBe(true);
  });

  it("is case insensitive on both sides", () => {
    expect(matchesSearch(NAME, HELP, "NODE CPU")).toBe(true);
    expect(matchesSearch("Node_CPU_Total", undefined, "node_cpu")).toBe(true);
  });

  it("splits on any non [a-z0-9_:] run and keeps underscores and colons", () => {
    // separators collapse and drop out
    expect(matchesSearch(NAME, HELP, "node, ; cpu")).toBe(true);
    // underscores are part of a term
    expect(matchesSearch(NAME, HELP, "cpu_seconds")).toBe(true);
    // colons are part of a term (recording-rule style names)
    expect(matchesSearch("job:http_requests:rate5m", undefined, "job:http")).toBe(
      true,
    );
    expect(matchesSearch(NAME, HELP, "cpu-seconds")).toBe(true); // -> ["cpu","seconds"]
  });

  it("handles an undefined help text", () => {
    expect(matchesSearch(NAME, undefined, "seconds")).toBe(true);
    expect(matchesSearch(NAME, undefined, "mode")).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("computePrefixAssignment", () => {
  const NAMES = [
    "envoy_cluster_a",
    "envoy_cluster_b",
    "envoy_http_x",
    "node_cpu_1",
    "node_cpu_2",
    "lonely_metric",
  ];

  it("assigns every name to a group that actually exists", () => {
    const { groups, groupOf } = computePrefixAssignment(NAMES);
    const ids = new Set(groups.map((g) => g.id));

    expect(groupOf.size).toBe(NAMES.length);
    for (const name of NAMES) {
      expect(ids.has(groupOf.get(name)!)).toBe(true);
    }
  });

  it("assignment counts reconcile exactly with the reported group counts", () => {
    // This is the invariant that a hand-rolled `depth2 ?? depth1 ?? misc` guess
    // breaks: the rail would show a count the grid could not reproduce.
    const { groups, groupOf } = computePrefixAssignment(NAMES);

    const tally = new Map<string, number>();
    for (const id of groupOf.values()) {
      tally.set(id, (tally.get(id) ?? 0) + 1);
    }
    for (const group of groups) {
      expect(tally.get(group.id) ?? 0).toBe(group.count);
    }
  });

  it("follows the fold into misc rather than falling back to a shallower prefix", () => {
    // `envoy` qualifies on coverage (3 names) but keeps only envoy_http_x once
    // the other two claim the deeper envoy_cluster — so it is folded into misc.
    const { groupOf } = computePrefixAssignment(NAMES);
    expect(groupOf.get("envoy_cluster_a")).toBe("envoy_cluster");
    expect(groupOf.get("envoy_http_x")).toBe(MISC_GROUP_ID);
    expect(groupOf.get("lonely_metric")).toBe(MISC_GROUP_ID);
  });

  it("tracks a changed minGroupSize instead of drifting from it", () => {
    const names = ["svc_a_1", "svc_a_2", "svc_b_1"];
    const { groups, groupOf } = computePrefixAssignment(names, {
      minGroupSize: 3,
    });
    const ids = new Set(groups.map((g) => g.id));

    for (const name of names) {
      expect(ids.has(groupOf.get(name)!)).toBe(true);
      expect(groupOf.get(name)).toBe("svc");
    }
  });
});

describe("the assignment and the counts are the same statement", () => {
  it("keeps a folded group's members in misc, at any maxDepth", () => {
    // The reconstruction this replaced asked a different question than the
    // algorithm answered.
    //
    //   a_b_c_1, a_b_c_2  ->  claim the depth-3 group `a_b_c` (2 names)
    //   a_b_d             ->  deepest qualifying prefix is `a_b` (3 names could
    //                         use it) — but the two above went deeper, so `a_b`
    //                         keeps only ONE name and pass 3 folds it into misc
    //   a_x, a_y          ->  hold the depth-1 group `a` open (2 names)
    //
    // So `a_b_d` belongs in misc. Rebuilding the assignment from the surviving
    // group ids instead handed it to `a` — which is still standing — while its
    // COUNT sat in misc. The rail said one thing and the grid did another.
    const names = ["a_b_c_1", "a_b_c_2", "a_b_d", "a_x", "a_y"];
    const { groups, groupOf } = computePrefixAssignment(names, {
      maxDepth: 3,
      minGroupSize: 2,
    });

    expect(groupOf.get("a_b_c_1")).toBe("a_b_c");
    expect(groupOf.get("a_x")).toBe("a");
    expect(groupOf.get("a_b_d")).toBe(MISC_GROUP_ID);

    // Every group's count equals the number of names actually assigned to it.
    for (const group of groups) {
      const assigned = names.filter((n) => groupOf.get(n) === group.id).length;
      expect(assigned).toBe(group.count);
    }
    // ...and every name is assigned exactly once.
    expect(groups.reduce((sum, g) => sum + g.count, 0)).toBe(names.length);
  });
});
