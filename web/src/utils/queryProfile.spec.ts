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
  CARD_H,
  CARD_W,
  buildProfileModel,
  clusterNodes,
  cleanPlanExpr,
  computeTimeNs,
  extractProfile,
  formatPlanValue,
  layoutProfile,
  metricSections,
  metricsForScope,
  nodeScope,
  operatorCategory,
  operatorLabel,
  operatorNodeRows,
  parsePlanDetail,
  parseSearchStream,
  physicalPlanToProfile,
  planAggregate,
  planFingerprint,
  planOperatorSummary,
  planScanInfo,
  queryPhases,
  scopedValue,
  shareTone,
  skew,
  splitTopLevel,
  summarizePlan,
  summarizeProfile,
  type ProfileLayout,
  type ProfileModel,
  type ProfileNode,
  type QueryProfile,
  type RemoteNodeProfile,
} from "./queryProfile";
import {
  AGG_PHYSICAL_PLAN,
  T0,
  TOPN_PHYSICAL_PLAN,
  joinProfile,
} from "./__fixtures__/queryProfile.fixture";

const MS = 1_000_000;

function opsNamed(model: ProfileModel, name: string) {
  return model.order.map((id) => model.operators[id]).filter((op) => op.name === name);
}

function logsStage(model: ProfileModel) {
  return model.stages.find((s) => s.nodes.length === 6)!;
}

function eventsStage(model: ProfileModel) {
  return model.stages.find((s) => s.nodes.length === 4)!;
}

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function expectNoCardOverlap(layout: ProfileLayout) {
  const rects = layout.cards.map((c) => ({ ...c, w: CARD_W, h: CARD_H }));
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      expect(overlaps(rects[i], rects[j]), `${rects[i].opId} vs ${rects[j].opId}`).toBe(false);
    }
  }
}

function expectCardsInsideStages(model: ProfileModel, layout: ProfileLayout) {
  for (const card of layout.cards) {
    let stageId = model.operators[card.opId].stageId;
    while (stageId) {
      const box = layout.stages.find((s) => s.stageId === stageId)!;
      expect(card.x).toBeGreaterThanOrEqual(box.x);
      expect(card.x + CARD_W).toBeLessThanOrEqual(box.x + box.w);
      expect(card.y).toBeGreaterThanOrEqual(box.y);
      expect(card.y + CARD_H).toBeLessThanOrEqual(box.y + box.h);
      stageId = model.stageById[stageId].parentStageId;
    }
  }
}

function plainRemote(
  name: string,
  role: string,
  partition: number,
  plan?: ProfileNode,
): RemoteNodeProfile {
  return {
    partition,
    node_name: name,
    node_address: `10.0.0.${partition}:5081`,
    role,
    region: "",
    cluster: "",
    start_us: T0,
    first_batch_us: T0 + 1000,
    end_us: T0 + 100_000,
    output_rows: 10,
    output_batches: 1,
    output_bytes: 100,
    fetch_ns: MS,
    decode_ns: MS,
    assigned_files: 1,
    skipped: false,
    error: "",
    peak_memory: 0,
    plan,
  };
}

function scanPlan(ms: number): ProfileNode {
  return {
    name: "DataSourceExec",
    detail: "DataSourceExec: file_type=parquet",
    partitions: 1,
    metrics: [
      { name: "output_rows", kind: "count", value: 10, max: 10 },
      { name: "time_elapsed_processing", kind: "time", value: ms * MS, max: ms * MS },
    ],
  };
}

function singleStageProfile(remotes: RemoteNodeProfile[]): QueryProfile {
  return {
    version: 1,
    node_name: "leader",
    node_address: "10.0.0.100:5081",
    start_us: T0,
    end_us: T0 + 200_000,
    output_rows: 10,
    plan: {
      name: "CoalescePartitionsExec",
      detail: "CoalescePartitionsExec",
      partitions: 1,
      children: [
        {
          name: "RemoteScanExec",
          detail: "RemoteScanExec",
          partitions: remotes.length,
          remote: remotes,
        },
      ],
    },
  };
}

describe("operatorCategory / operatorLabel", () => {
  it("classifies DataFusion operator names", () => {
    expect(operatorCategory("RemoteScanExec")).toBe("remote");
    expect(operatorCategory("DataSourceExec")).toBe("scan");
    expect(operatorCategory("NewEmptyExec")).toBe("scan");
    expect(operatorCategory("FilterExec")).toBe("filter");
    expect(operatorCategory("HashJoinExec")).toBe("join");
    expect(operatorCategory("AggregateExec")).toBe("agg");
    expect(operatorCategory("SortPreservingMergeExec")).toBe("sort");
    expect(operatorCategory("RepartitionExec")).toBe("exchange");
    expect(operatorCategory("UnionExec")).toBe("exchange");
    expect(operatorCategory("ProjectionExec")).toBe("projection");
    expect(operatorCategory("SomethingElse")).toBe("other");
  });

  it("strips Exec and appends the aggregate mode", () => {
    expect(
      operatorLabel({ name: "AggregateExec", detail: "AggregateExec: mode=Partial, gby=[]" }),
    ).toBe("Aggregate · Partial");
    expect(operatorLabel({ name: "FilterExec", detail: "FilterExec: a = 1" })).toBe("Filter");
  });
});

describe("computeTimeNs", () => {
  it("prefers elapsed_compute over time_elapsed_processing", () => {
    expect(
      computeTimeNs([
        { name: "time_elapsed_processing", kind: "time", value: 9, max: 9 },
        { name: "elapsed_compute", kind: "time", value: 4, max: 4 },
      ]),
    ).toBe(4);
  });

  it("falls back to time_elapsed_processing, then 0", () => {
    expect(
      computeTimeNs([{ name: "time_elapsed_processing", kind: "time", value: 7, max: 7 }]),
    ).toBe(7);
    expect(computeTimeNs([{ name: "output_rows", kind: "count", value: 7, max: 7 }])).toBe(0);
    expect(computeTimeNs(undefined)).toBe(0);
  });
});

describe("buildProfileModel", () => {
  const model = buildProfileModel(joinProfile());

  it("creates one stage per RemoteScanExec", () => {
    expect(model.stages).toHaveLength(2);
    expect(
      opsNamed(model, "RemoteScanExec")
        .map((op) => op.remoteStageId)
        .sort(),
    ).toEqual(["s1", "s2"]);
  });

  it("groups the logs stage into a querier and an ingester variant", () => {
    const stage = logsStage(model);
    expect(stage.variants.map((v) => [v.role, v.nodeKeys.length])).toEqual([
      ["querier", 4],
      ["ingester", 2],
    ]);
    expect(eventsStage(model).variants).toHaveLength(1);
    expect(eventsStage(model).variants[0].role).toBe("querier");
  });

  it("draws each plan shape once, aggregating per-node samples", () => {
    expect(opsNamed(model, "FilterExec")).toHaveLength(3);
    const querierFilter = opsNamed(model, "FilterExec").find(
      (op) => op.samples.length === 4 && op.detail.includes("level"),
    )!;
    expect(querierFilter.samples.map((s) => s.nodeKey)).toEqual(["q-0", "q-1", "q-2", "q-3"]);
    expect(querierFilter.totalComputeNs).toBeCloseTo((205 + 205 + 205 * 2.2 + 205 * 0.9) * MS);
  });

  it("sums compute across the whole tree including remote plans and decode time", () => {
    const sum = model.order.reduce((a, id) => a + model.operators[id].totalComputeNs, 0);
    expect(model.totalComputeNs).toBe(sum);
    const logsRemote = model.operators[logsStage(model).remoteOpId];
    expect(logsRemote.totalComputeNs).toBe(6 * 2 * MS);
    expect(logsRemote.totalRows).toBe(2_810_000);
  });

  it("flags only q-2 as a straggler of the logs stage", () => {
    const flagged = logsStage(model)
      .nodes.filter((n) => n.straggler)
      .map((n) => n.key);
    expect(flagged).toEqual(["q-2"]);
    expect(eventsStage(model).nodes.some((n) => n.straggler)).toBe(false);
  });

  it("produces distinct fingerprints per plan shape", () => {
    const [q, i] = logsStage(model).variants;
    const qRoot = model.operators[q.rootOpId];
    const iRoot = model.operators[i.rootOpId];
    expect(qRoot.name).toBe(iRoot.name);
    expect(qRoot.childIds).toHaveLength(1);
    const p = joinProfile().plan;
    expect(planFingerprint(p)).toContain("RemoteScanExec");
  });

  it("lists every distinct node once for the scope picker", () => {
    expect(clusterNodes(model).map((n) => n.key)).toEqual([
      "q-0",
      "q-1",
      "q-2",
      "q-3",
      "i-0",
      "i-1",
    ]);
  });
});

describe("scopedValue", () => {
  const model = buildProfileModel(joinProfile());
  const ingesterFilter = opsNamed(model, "FilterExec").find((op) => op.samples.length === 2)!;
  const leaderJoin = opsNamed(model, "HashJoinExec")[0];

  it("sums by default and takes the largest node for max", () => {
    expect(scopedValue(ingesterFilter, "sum").computeNs).toBeCloseTo((27 + 27 * 1.1) * MS);
    expect(scopedValue(ingesterFilter, "max").computeNs).toBeCloseTo(27 * 1.1 * MS);
    expect(scopedValue(ingesterFilter, "max").rows).toBe(Math.max(85_000, 85_000 * 1.1));
  });

  it("shows one node's sample, or dims when the node is not in the variant", () => {
    expect(scopedValue(ingesterFilter, nodeScope("i-0"))).toEqual({
      computeNs: 27 * MS,
      rows: 85_000,
      on: true,
    });
    expect(scopedValue(ingesterFilter, nodeScope("q-0")).on).toBe(false);
  });

  it("leaves leader operators untouched by the scope", () => {
    expect(scopedValue(leaderJoin, nodeScope("q-0"))).toEqual(scopedValue(leaderJoin, "sum"));
  });
});

describe("metricsForScope / metricSections / per-node rows", () => {
  const model = buildProfileModel(joinProfile());
  const scan = opsNamed(model, "DataSourceExec").find(
    (op) => op.samples.length === 4 && op.detail.includes("parquet") && op.totalRows > 10_000_000,
  )!;

  it("merges metrics across nodes for the sum scope", () => {
    const merged = metricsForScope(scan, "sum");
    const pruning = merged.find((m) => m.name === "row_groups_pruned_statistics")!;
    expect(pruning.value).toBe(475 * 4);
    expect(pruning.total).toBe(560 * 4);
  });

  it("uses the slowest node for max and one node for a node scope", () => {
    const slowest = metricsForScope(scan, "max");
    expect(slowest.find((m) => m.name === "time_elapsed_processing")!.value).toBeCloseTo(
      1480 * 2.2 * MS,
    );
    expect(
      metricsForScope(scan, nodeScope("q-0")).find((m) => m.name === "output_rows")!.value,
    ).toBe(2_950_000);
    expect(metricsForScope(scan, nodeScope("i-0"))).toEqual([]);
  });

  it("splits metrics into timing, pruning, ratio and counter sections", () => {
    const s = metricSections(metricsForScope(scan, "sum"));
    expect(s.timing.map((m) => m.name)).toEqual(["time_elapsed_processing", "metadata_load_time"]);
    expect(s.pruning.map((m) => m.name)).toEqual(["row_groups_pruned_statistics"]);
    expect(s.counters.map((m) => m.name)).toContain("bytes_scanned");
  });

  it("builds per-node rows with straggler tags and skew", () => {
    const rows = operatorNodeRows(model, scan);
    expect(rows.find((r) => r.nodeKey === "q-2")!.straggler).toBe(true);
    expect(rows.reduce((a, r) => a + r.share, 0)).toBeCloseTo(1);
    expect(skew(rows.map((r) => r.computeNs))).toBeCloseTo(2.2);
    expect(skew([0, 0])).toBe(1);
  });

  it("maps share of total CPU to a tone", () => {
    expect(shareTone(0.005)).toBe("none");
    expect(shareTone(0.02)).toBe("low");
    expect(shareTone(0.1)).toBe("mid");
    expect(shareTone(0.4)).toBe("high");
  });
});

describe("summarizeProfile", () => {
  const model = buildProfileModel(joinProfile());
  const took = {
    total: 1840,
    cache_took: 0,
    file_list_took: 162,
    wait_in_queue: 70,
    idx_took: 0,
    search_took: 1500,
  };
  const summary = summarizeProfile(model, { took_detail: took });

  it("counts nodes by role and finds the peak-memory node", () => {
    expect(summary.nodeCounts).toEqual({ queriers: 4, ingesters: 2, other: 0, total: 6 });
    expect(summary.peakMemory).toEqual({ bytes: 1_200_000_000, node: "q-2" });
    expect(summary.leaderName).toBe("q-1");
  });

  it("counts an all-in-one node under both roles", () => {
    const profile = joinProfile();
    const stack = [profile.plan];
    while (stack.length) {
      const node = stack.pop()!;
      for (const remote of node.remote ?? []) remote.role = "querier,ingester";
      stack.push(...(node.children ?? []));
    }
    const counts = summarizeProfile(buildProfileModel(profile)).nodeCounts;
    expect(counts).toEqual({ queriers: 6, ingesters: 6, other: 0, total: 6 });
  });

  it("derives phases from took_detail and omits them when absent", () => {
    expect(summary.phases!.map((p) => p.id)).toEqual(["queue", "fileList", "execution", "other"]);
    expect(summary.phases!.find((p) => p.id === "execution")!.ms).toBe(1520);
    expect(queryPhases(undefined, model.profile)).toBeNull();
    expect(summarizeProfile(model).phases).toBeNull();
  });

  it("ranks hotspots without remote scans and reports the straggler", () => {
    expect(summary.hotspots).toHaveLength(5);
    expect(summary.hotspots.every((id) => model.operators[id].category !== "remote")).toBe(true);
    expect(model.operators[summary.hotspots[0]].name).toBe("DataSourceExec");
    expect(summary.stragglers.map((s) => s.name)).toEqual(["q-2"]);
    expect(summary.stragglers[0].ratio).toBeGreaterThan(1.8);
  });

  it("builds one timeline row per node with a segment per stage", () => {
    const q0 = summary.timeline.rows.find((r) => r.nodeKey === "q-0")!;
    expect(q0.segments.map((s) => s.stageIndex).sort()).toEqual([1, 2]);
    expect(summary.timeline.rows.find((r) => r.nodeKey === "i-0")!.segments).toHaveLength(1);
    expect(summary.timeline.spanUs).toBe(1_520_000);
  });

  it("totals scan stats and category time", () => {
    expect(summary.scanned!.files).toBe(104 * 3 + 100 + 9 * 4);
    expect(summary.byCategory[0].category).toBe("scan");
    expect(summary.byCategory.reduce((a, c) => a + c.ns, 0)).toBe(model.totalComputeNs);
  });
});

describe("layoutProfile", () => {
  it("lays out the join without overlaps and keeps cards inside their stages", () => {
    const model = buildProfileModel(joinProfile());
    const layout = layoutProfile(model);
    expect(layout.cards).toHaveLength(model.order.length);
    expect(layout.stages).toHaveLength(2);
    expect(overlaps(layout.stages[0], layout.stages[1])).toBe(false);
    expectNoCardOverlap(layout);
    expectCardsInsideStages(model, layout);
    expect(layout.edges).toHaveLength(model.order.length - 1);
  });

  it("places the root at the top and children below their parent", () => {
    const model = buildProfileModel(joinProfile());
    const layout = layoutProfile(model);
    const y = new Map(layout.cards.map((c) => [c.opId, c.y]));
    expect(y.get(model.rootId)).toBe(0);
    for (const id of model.order) {
      const parent = model.operators[id].parentId;
      if (parent) expect(y.get(id)!).toBeGreaterThan(y.get(parent)!);
    }
  });

  it("sizes the graph by plan shape, not by node count", () => {
    const small = singleStageProfile(
      [0, 1].map((i) => plainRemote(`q-${i}`, "querier", i, scanPlan(1))),
    );
    const large = singleStageProfile(
      Array.from({ length: 50 }, (_, i) =>
        plainRemote(`q-${i}`, "querier", i, scanPlan(1 + (i % 3))),
      ),
    );
    const a = layoutProfile(buildProfileModel(small));
    const b = layoutProfile(buildProfileModel(large));
    expect(b.cards).toHaveLength(a.cards.length);
    expect(b.width).toBe(a.width);
    expect(b.height).toBe(a.height);
  });

  it("nests stages for a super-cluster plan without overlaps", () => {
    const regionPlan = (region: string): ProfileNode => ({
      name: "AggregateExec",
      detail: "AggregateExec: mode=Partial",
      partitions: 1,
      metrics: [{ name: "elapsed_compute", kind: "time", value: MS, max: MS }],
      children: [
        {
          name: "RemoteScanExec",
          detail: "RemoteScanExec",
          partitions: 2,
          remote: [0, 1].map((i) => plainRemote(`${region}-q${i}`, "querier", i, scanPlan(2))),
        },
      ],
    });
    const profile = singleStageProfile([
      plainRemote("region-a", "", 0, regionPlan("a")),
      plainRemote("region-b", "", 1, regionPlan("b")),
    ]);
    const model = buildProfileModel(profile);
    expect(model.stages).toHaveLength(2);
    const nested = model.stages[1];
    expect(nested.parentStageId).toBe(model.stages[0].id);
    expect(nested.nodes.map((n) => n.key)).toEqual(["a-q0", "a-q1", "b-q0", "b-q1"]);
    const layout = layoutProfile(model);
    expectNoCardOverlap(layout);
    expectCardsInsideStages(model, layout);
  });

  it("keeps a union with several children free of overlaps", () => {
    const leaf = (n: number): ProfileNode => ({ ...scanPlan(n), name: `DataSourceExec` });
    const profile = singleStageProfile([]);
    profile.plan = {
      name: "UnionExec",
      detail: "UnionExec",
      partitions: 3,
      children: [leaf(1), leaf(2), { ...profile.plan }, leaf(3)],
    };
    const model = buildProfileModel(profile);
    const layout = layoutProfile(model);
    expectNoCardOverlap(layout);
    expect(layout.stages).toHaveLength(0);
  });
});

describe("fallback when a remote node has no structured plan", () => {
  const remotes = [
    plainRemote("q-0", "querier", 0, scanPlan(1)),
    plainRemote("q-old", "querier", 1),
    plainRemote("q-gone", "querier", 2),
  ];
  const hits = [
    { phase: 0, plan: "CoalescePartitionsExec" },
    {
      phase: 1,
      node_name: "q-old",
      node_address: "10.0.0.1:5081",
      plan: "FilterExec: a = 1, metrics=[output_rows=5, elapsed_compute=2ms]\n  DataSourceExec: x, metrics=[output_rows=9]",
    },
  ];
  const model = buildProfileModel(singleStageProfile(remotes), hits);
  const stage = model.stages[0];

  it("parses the node's text plan from the hits", () => {
    const old = stage.nodes.find((n) => n.key === "q-old")!;
    expect(old.planSource).toBe("text");
    const variant = model.variantById[old.variantId!];
    const root = model.operators[variant.rootOpId];
    expect(root.name).toBe("FilterExec");
    expect(root.totalComputeNs).toBe(2 * MS);
    expect(root.totalRows).toBe(5);
  });

  it("keeps a node with no plan at all without crashing", () => {
    const gone = stage.nodes.find((n) => n.key === "q-gone")!;
    expect(gone.planSource).toBe("none");
    expect(gone.variantId).toBeNull();
    expect(stage.variants).toHaveLength(2);
    expect(() => layoutProfile(model)).not.toThrow();
  });
});

describe("parseSearchStream / extractProfile", () => {
  it("merges hits across events and keeps took_detail from the metadata event", () => {
    const meta = {
      results: {
        took: 5,
        took_detail: {
          total: 9,
          cache_took: 0,
          file_list_took: 1,
          wait_in_queue: 2,
          idx_took: 0,
          search_took: 6,
        },
        hits: [],
        total: 3,
        scan_size: 4,
        scan_records: 100,
      },
    };
    const sse = [
      "event: progress",
      'data: {"percent":50}',
      "",
      "event: search_response_metadata",
      `data: ${JSON.stringify(meta)}`,
      "",
      "event: search_response_hits",
      `data: ${JSON.stringify({ hits: [{ phase: 0, plan: "A" }] })}`,
      "",
      "event: search_response_hits",
      `data: ${JSON.stringify({ hits: [{ phase: 1, plan: "B" }] })}`,
      "",
      "data: [[DONE]]",
    ].join("\n");
    const result = parseSearchStream(sse)!;
    expect(result.hits.map((h) => h.plan)).toEqual(["A", "B"]);
    expect(result.took_detail!.total).toBe(9);
    expect(result.scan_size).toBe(4);
    expect(result.scan_records).toBe(100);
  });

  it("returns null when no event carries results", () => {
    expect(parseSearchStream("event: progress\ndata: {}\n")).toBeNull();
    expect(parseSearchStream("")).toBeNull();
  });

  it("reads the profile JSON from the first hit and ignores bad JSON", () => {
    const profile = joinProfile();
    expect(
      extractProfile([
        { phase: 0, plan: "x", profile: JSON.stringify(profile) },
        { phase: 1, profile: null },
      ])!.node_name,
    ).toBe("q-1");
    expect(extractProfile([{ phase: 0, profile: "{not json" }])).toBeNull();
    expect(extractProfile([{ phase: 0, plan: "x" }])).toBeNull();
  });
});

describe("plan detail parsing", () => {
  it("splits on top-level commas only, honouring quotes and escapes", () => {
    expect(splitTopLevel(`a=[x, y], b=f(1, 2), c="p, \\"q\\"", d`)).toEqual([
      "a=[x, y]",
      "b=f(1, 2)",
      `c="p, \\"q\\""`,
      "d",
    ]);
  });

  it("strips column indexes, self aliases and Utf8 wrappers", () => {
    expect(cleanPlanExpr("k8s_namespace_name@0 as k8s_namespace_name")).toBe("k8s_namespace_name");
    expect(cleanPlanExpr("count(Int64(1))@1 as cnt")).toBe("count(Int64(1)) as cnt");
    expect(cleanPlanExpr('level = Utf8("error")')).toBe("level = 'error'");
  });

  it("parses key=value pairs and keeps positional parts with an empty key", () => {
    expect(
      parsePlanDetail("FilterExec: level@1 = error, projection=[k8s_namespace_name@0]"),
    ).toEqual([
      { key: "", value: "level = error" },
      { key: "projection", value: "[k8s_namespace_name]" },
    ]);
    expect(
      parsePlanDetail(
        String.raw`NewEmptyExec: name="app_logs", filters=["level = Utf8(\"error\")"], sort_order=timestamp_desc`,
      ).map((e) => e.key),
    ).toEqual(["name", "filters", "sort_order"]);
    expect(parsePlanDetail("CoalescePartitionsExec")).toEqual([]);
  });

  it("formats list values as a plain comma list", () => {
    expect(formatPlanValue('["a", "b"]')).toBe("a, b");
    expect(formatPlanValue('"app_logs"')).toBe("app_logs");
    expect(formatPlanValue("10")).toBe("10");
  });
});

describe("physicalPlanToProfile", () => {
  const model = buildProfileModel(physicalPlanToProfile(AGG_PHYSICAL_PLAN)!, [], {
    planOnly: true,
  });
  const byName = (name: string) => opsNamed(model, name);

  it("turns the subtree under RemoteScanExec into one stage with no runtime numbers", () => {
    expect(model.planOnly).toBe(true);
    expect(model.stages).toHaveLength(1);
    expect(model.stages[0].variants).toHaveLength(1);
    const remote = byName("RemoteScanExec")[0];
    expect(remote.remoteStageId).toBe(model.stages[0].id);
    expect(model.operators[remote.childIds[0]].name).toBe("AggregateExec");
    expect(model.totalComputeNs).toBe(0);
    expect(model.order).toHaveLength(12);
    expect(model.order.filter((id) => model.operators[id].stageId)).toHaveLength(5);
  });

  it("keeps the placeholder scan as a scan with its stream and pushdown", () => {
    const scan = byName("NewEmptyExec")[0];
    expect(scan.category).toBe("scan");
    expect(planScanInfo(scan)).toEqual({
      opId: scan.id,
      stream: "app_logs",
      filters: ["level = 'error'"],
      columns: ["k8s_namespace_name", "level"],
      sortOrder: "",
    });
  });

  it("summarises each operator in one readable line", () => {
    const summary = (name: string, i = 0) => planOperatorSummary(byName(name)[i]);
    expect(summary("FilterExec")).toBe("level = error");
    expect(summary("SortExec")).toBe("count(Int64(1)) DESC · fetch=10");
    expect(summary("SortPreservingMergeExec")).toBe("cnt DESC · fetch=10");
    expect(summary("RepartitionExec", 0)).toBe("Hash(k8s_namespace_name) · 10");
    expect(summary("RepartitionExec", 1)).toBe("RoundRobinBatch · 10");
    expect(summary("ProjectionExec")).toBe("k8s_namespace_name, count(Int64(1)) as cnt");
    expect(planAggregate(byName("AggregateExec")[0].detail)).toEqual({
      groupBy: ["k8s_namespace_name"],
      aggr: ["count(Int64(1))"],
    });
  });

  it("summarises the plan: streams, operator split, limit and pushdown", () => {
    const plan = summarizePlan(model);
    expect(plan.streams).toEqual(["app_logs"]);
    expect(plan.leaderOps).toBe(7);
    expect(plan.remoteOps).toBe(5);
    expect(plan.fetch).toBe(10);
    expect(plan.scans).toHaveLength(1);
    expect(plan.leaderCategories).toEqual(["sort", "projection", "agg", "exchange"]);
  });

  it("reads sort order pushdown from a top-N plan", () => {
    const topn = buildProfileModel(physicalPlanToProfile(TOPN_PHYSICAL_PLAN)!, [], {
      planOnly: true,
    });
    const plan = summarizePlan(topn);
    expect(topn.stages).toHaveLength(1);
    expect(plan.fetch).toBe(100);
    expect(plan.scans[0].sortOrder).toBe("timestamp_desc");
    expect(plan.scans[0].columns).toHaveLength(5);
    expect(planOperatorSummary(opsNamed(topn, "FilterExec")[0])).toBe("level = error");
  });

  it("lays plan cards out with the same card size as a profile", () => {
    const layout = layoutProfile(model);
    expect(layout.cards).toHaveLength(model.order.length);
    expect(layout.stages).toHaveLength(1);
    expect(layout.width).toBeGreaterThanOrEqual(CARD_W);
    expect(layout.height).toBeGreaterThanOrEqual(CARD_H * 12);
  });

  it("returns null for an empty plan", () => {
    expect(physicalPlanToProfile("")).toBeNull();
  });
});
