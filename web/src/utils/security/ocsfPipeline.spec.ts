// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import {
  consistencyState,
  entityFunctionName,
  entityProgram,
  findOurNode,
  fullFunctionName,
  insertNode,
  newPipeline,
  ourNode,
  preAttachChecks,
  removeNode,
  type Pipeline,
  type PipelineNode,
} from "./ocsfPipeline";

const pairs = (p: Pipeline) => new Set(p.edges.map((e) => `${e.source}->${e.target}`));

const streamNode = (id: string, name: string, io: string): PipelineNode => ({
  id,
  data: { node_type: "stream", stream_name: name, stream_type: "logs", org_id: "o" },
  position: { x: 0, y: 0 },
  io_type: io,
});

const funcNode = (id: string, name: string): PipelineNode => ({
  id,
  data: { node_type: "function", name, after_flatten: false, num_args: 0 },
  position: { x: 0, y: 0 },
  io_type: "default",
});

const edge = (source: string, target: string) => ({ id: `e${source}-${target}`, source, target });

describe("naming (R2)", () => {
  it("builds per-stream entity and shared full names, lowercased", () => {
    expect(entityFunctionName(1, "App-Logs")).toBe("ocsf_entity_v1_app-logs");
    expect(fullFunctionName("AWS_CloudTrail", 2)).toBe("ocsf_aws_cloudtrail_v2");
  });
});

describe("entityProgram (R3)", () => {
  it("substitutes the stream for the placeholder and leaves a full pack unchanged", () => {
    expect(entityProgram('x = "__O2_STREAM__"', "s")).toBe('x = "s"');
    expect(entityProgram("full_pack_body", "s")).toBe("full_pack_body");
  });
});

describe("ourNode (R4)", () => {
  it("builds the SDD §5.3 function node offset below the source", () => {
    const node = ourNode("entity", 1, "ocsf_entity_v1_s", { x: 42, y: 100 });
    expect(node.data.node_type).toBe("function");
    expect(node.data.name).toBe("ocsf_entity_v1_s");
    expect(node.data.after_flatten).toBe(false);
    expect(node.meta).toEqual({ o2_ocsf_pack: "entity@1" });
    expect(node.io_type).toBe("default");
    expect(node.position).toEqual({ x: 42, y: 220 });
  });
});

describe("findOurNode (R5)", () => {
  it("matches only by meta.o2_ocsf_pack, never by name or position", () => {
    const named = funcNode("f1", "ocsf_entity_v1_s");
    const ours = { ...funcNode("f2", "something"), meta: { o2_ocsf_pack: "entity@1" } };
    const p: Pipeline = {
      name: "p",
      description: "",
      source: {},
      nodes: [streamNode("s", "s", "input"), named, ours],
      edges: [],
    };
    expect(findOurNode(p)?.id).toBe("f2");
    expect(findOurNode({ ...p, nodes: [streamNode("s", "s", "input"), named] })).toBeNull();
  });
});

describe("newPipeline (R7)", () => {
  it("builds source → ours → destination with the full realtime source", () => {
    const node = ourNode("entity", 1, "ocsf_entity_v1_s", { x: 0, y: 0 });
    const p = newPipeline("org1", "web", node);
    expect(p.name).toBe("ocsf-web");
    expect(p.source).toEqual({
      source_type: "realtime",
      org_id: "org1",
      stream_name: "web",
      stream_type: "logs",
    });
    expect(p.nodes).toHaveLength(3);
    expect(p.nodes[0].io_type).toBe("input");
    expect(p.nodes[1].id).toBe(node.id);
    expect(p.nodes[2].io_type).toBe("output");
    const src = p.nodes[0].id;
    const dst = p.nodes[2].id;
    expect(pairs(p)).toEqual(new Set([`${src}->${node.id}`, `${node.id}->${dst}`]));
  });
});

describe("insertNode (R6)", () => {
  it("inserts a lone source→dest edge", () => {
    const p: Pipeline = {
      name: "p",
      description: "",
      source: {},
      nodes: [streamNode("src", "s", "input"), streamNode("dst", "s", "output")],
      edges: [edge("src", "dst")],
    };
    const node = funcNode("ours", "f");
    const out = insertNode(p, node);
    expect(out.nodes[0].id).toBe("src");
    expect(out.nodes[out.nodes.length - 1].id).toBe("ours");
    expect(pairs(out)).toEqual(new Set(["src->ours", "ours->dst"]));
  });

  it("fans the source edges through our node, keeping order and dropping duplicate targets", () => {
    const p: Pipeline = {
      name: "p",
      description: "",
      source: {},
      nodes: [
        streamNode("src", "s", "input"),
        funcNode("fn", "cust"),
        { ...funcNode("cond", "c"), data: { node_type: "condition" } },
        streamNode("d1", "s", "output"),
        streamNode("d2", "other", "output"),
      ],
      edges: [
        edge("src", "fn"),
        edge("src", "cond"),
        edge("src", "fn"),
        edge("fn", "d1"),
        edge("cond", "d2"),
      ],
    };
    const node = funcNode("ours", "f");
    const out = insertNode(p, node);
    const fromSrc = out.edges.filter((e) => e.source === "src").map((e) => e.target);
    const fromOurs = out.edges.filter((e) => e.source === "ours").map((e) => e.target);
    expect(fromSrc).toEqual(["ours"]);
    expect(fromOurs).toEqual(["fn", "cond"]);
    expect(out.edges.some((e) => e.source === "fn" && e.target === "d1")).toBe(true);
    expect(out.edges.some((e) => e.source === "cond" && e.target === "d2")).toBe(true);
    expect(out.edges.every((e) => e.id === `e${e.source}-${e.target}`)).toBe(true);
  });
});

describe("removeNode and round-trip (R8, R9)", () => {
  const base: Pipeline = {
    name: "p",
    description: "",
    source: {},
    nodes: [
      streamNode("src", "s", "input"),
      funcNode("fn", "cust"),
      { ...funcNode("cond", "c"), data: { node_type: "condition" } },
      streamNode("d1", "s", "output"),
      streamNode("d2", "other", "output"),
    ],
    edges: [edge("src", "fn"), edge("src", "cond"), edge("fn", "d1"), edge("cond", "d2")],
  };

  it("restores the exact (source,target) pair set on round-trip", () => {
    const node = ourNode("entity", 1, "ocsf_entity_v1_s", { x: 0, y: 0 });
    const round = removeNode(insertNode(base, node));
    expect(pairs(round)).toEqual(pairs(base));
    expect(findOurNode(round)).toBeNull();
    expect(round.nodes.map((n) => n.id).sort()).toEqual(base.nodes.map((n) => n.id).sort());
  });

  it("removes our node and reconnects source→X directly", () => {
    const node = { ...funcNode("ours", "f"), meta: { o2_ocsf_pack: "entity@1" } };
    const inserted = insertNode(base, node);
    const removed = removeNode(inserted);
    expect(pairs(removed)).toEqual(pairs(base));
  });
});

const setting = (over: Record<string, unknown> = {}) => ({
  source_type: "entity",
  pack_id: "entity",
  pack_version: 1,
  attached_at: 0,
  pipeline_id: "p1",
  pipeline_created: true,
  included: true,
  ...over,
});

const pipelineWith = (over: Partial<Pipeline> = {}): Pipeline => ({
  name: "p",
  description: "",
  source: {},
  enabled: true,
  nodes: [
    streamNode("src", "web", "input"),
    { ...funcNode("ours", "ocsf_entity_v1_web"), meta: { o2_ocsf_pack: "entity@1" } },
    streamNode("dst", "web", "output"),
  ],
  edges: [edge("src", "ours"), edge("ours", "dst")],
  ...over,
});

describe("consistencyState (R14)", () => {
  it("mapped when the setting, node and version all agree", () => {
    expect(consistencyState(setting(), pipelineWith())).toBe("mapped");
  });

  it("pack_removed_outside when the setting has a pack but the node is gone", () => {
    const noNode = pipelineWith({
      nodes: [streamNode("src", "web", "input"), streamNode("dst", "web", "output")],
      edges: [edge("src", "dst")],
    });
    expect(consistencyState(setting(), noNode)).toBe("pack_removed_outside");
  });

  it("attached_without_record when a node exists but no setting records it", () => {
    expect(consistencyState(setting({ pack_id: "", pack_version: 0 }), pipelineWith())).toBe(
      "attached_without_record",
    );
    expect(consistencyState(null, pipelineWith())).toBe("attached_without_record");
  });

  it("pipeline_not_writing_back when no leaf writes to the source stream", () => {
    const elsewhere = pipelineWith({
      nodes: [
        streamNode("src", "web", "input"),
        { ...funcNode("ours", "ocsf_entity_v1_web"), meta: { o2_ocsf_pack: "entity@1" } },
        streamNode("dst", "other", "output"),
      ],
    });
    expect(consistencyState(setting(), elsewhere)).toBe("pipeline_not_writing_back");
  });

  it("pipeline_disabled when the pipeline is off", () => {
    expect(consistencyState(setting(), pipelineWith({ enabled: false }))).toBe("pipeline_disabled");
  });
});

describe("preAttachChecks (R10)", () => {
  const cfg = { globalFlattenLevel: 0, guaranteedColumns: ["class_uid", "o2_ocsf_pack"] };
  const clean = { name: "web", settings: {} };

  it("passes a clean stream with no pipeline", () => {
    expect(preAttachChecks(clean, null, cfg)).toEqual([]);
  });

  it("(a) blocks a pipeline that does not route rows back to the stream", () => {
    const p = pipelineWith({
      nodes: [streamNode("src", "web", "input"), streamNode("dst", "other", "output")],
      edges: [edge("src", "dst")],
    });
    const blocks = preAttachChecks(clean, p, cfg);
    expect(blocks.map((b) => b.code)).toContain("stream_not_written");
    expect(blocks.find((b) => b.code === "stream_not_written")?.streams).toEqual(["other"]);
  });

  it("(b) blocks when the stream flatten level differs from the global one", () => {
    const blocks = preAttachChecks({ name: "web", settings: { flatten_level: 2 } }, null, cfg);
    expect(blocks.map((b) => b.code)).toContain("flatten_level_mismatch");
  });

  it("(c) blocks when the global flatten level is 1 or 2", () => {
    const blocks = preAttachChecks(clean, null, { ...cfg, globalFlattenLevel: 1 });
    expect(blocks.map((b) => b.code)).toContain("global_flatten_level");
  });

  it("(d) blocks when a user-defined schema lacks guaranteed columns", () => {
    const blocks = preAttachChecks(
      { name: "web", settings: { defined_schema_fields: ["class_uid"] } },
      null,
      cfg,
    );
    const block = blocks.find((b) => b.code === "schema_missing_columns");
    expect(block?.columns).toEqual(["o2_ocsf_pack"]);
  });

  it("(e) blocks when the existing pipeline is disabled", () => {
    const blocks = preAttachChecks(clean, pipelineWith({ enabled: false }), cfg);
    expect(blocks.map((b) => b.code)).toContain("pipeline_disabled");
  });
});
