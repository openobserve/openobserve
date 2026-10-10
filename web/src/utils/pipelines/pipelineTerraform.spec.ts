// Copyright 2026 OpenObserve Inc.
//
// The pipeline fixture below is the shape a live OpenObserve returns from
// GET /api/{org}/pipelines, not an idealised one — including the server
// rewriting a flat condition list into `{and: [...]}`.

import { describe, expect, it } from "vitest";

import { pipelineIdOf, pipelinesToTerraform } from "./pipelineTerraform";

const PIPELINE = {
  pipeline_id: "7497873160428060672",
  version: 0,
  enabled: true,
  org: "default",
  name: "tf_pipeline",
  description: "route errors",
  source: {
    source_type: "realtime",
    org_id: "default",
    stream_name: "app_logs",
    stream_type: "logs",
  },
  nodes: [
    {
      id: "n1",
      data: {
        node_type: "stream",
        org_id: "default",
        stream_name: "app_logs",
        stream_type: "logs",
      },
      position: { x: 100, y: 100 },
      io_type: "input",
    },
    {
      id: "n2",
      data: {
        node_type: "condition",
        conditions: { and: [{ column: "status", operator: ">=", value: "500" }] },
      },
      position: { x: 300, y: 100 },
      io_type: "default",
    },
    {
      id: "n3",
      data: {
        node_type: "stream",
        org_id: "default",
        stream_name: "app_errors",
        stream_type: "logs",
      },
      position: { x: 500, y: 100 },
      io_type: "output",
    },
  ],
  edges: [
    { id: "e1", source: "n1", target: "n2" },
    { id: "e2", source: "n2", target: "n3" },
  ],
};

const exportOf = (pipelines: Record<string, unknown>[], options = {}) =>
  pipelinesToTerraform(pipelines, options);

describe("pipelinesToTerraform", () => {
  it("renders the pipeline and its trigger", () => {
    const { hcl, unsupported } = exportOf([PIPELINE]);

    expect(unsupported).toEqual([]);
    expect(hcl).toContain('resource "openobserve_pipeline" "tf_pipeline"');
    expect(hcl).toMatch(/name\s+= "tf_pipeline"/);
    expect(hcl).toMatch(/source_type\s+= "realtime"/);
    expect(hcl).toMatch(/stream_name\s+= "app_logs"/);
    expect(hcl).toMatch(/enabled\s+= true/);
  });

  it("turns the nodes array into node blocks", () => {
    const { hcl } = exportOf([PIPELINE]);
    expect(hcl.match(/^\s+node \{/gm)).toHaveLength(3);
  });

  it("turns the edges array into edge blocks, renaming source/target to from/to", () => {
    const { hcl } = exportOf([PIPELINE]);

    expect(hcl.match(/^\s+edge \{/gm)).toHaveLength(2);
    expect(hcl).toMatch(/from\s+= "n1"/);
    expect(hcl).toMatch(/to\s+= "n2"/);
    // The wire spelling must not leak into the configuration.
    expect(hcl).not.toMatch(/source\s+= "n1"/);
    expect(hcl).not.toMatch(/target\s+= "n2"/);
  });

  it("maps node_type onto type and keeps the node's own id", () => {
    const { hcl } = exportOf([PIPELINE]);

    expect(hcl).toMatch(/id\s+= "n1"/);
    expect(hcl).toMatch(/type\s+= "stream"/);
    expect(hcl).toMatch(/type\s+= "condition"/);
    expect(hcl).not.toContain("node_type");
  });

  it("encodes a condition node's filter as JSON", () => {
    const { hcl } = exportOf([PIPELINE]);

    expect(hcl).toContain("conditions = jsonencode({");
    expect(hcl).toMatch(/"column"\s+= "status"/);
  });

  // The wire carries fields that mean nothing for a node's kind — a function
  // node with a leftover org_id, say. Writing them would read back differently
  // from how they were written and show as permanent drift.
  it("writes only the attributes that mean something for each node kind", () => {
    const withFunction = {
      ...PIPELINE,
      nodes: [
        PIPELINE.nodes[0],
        {
          id: "fn",
          data: {
            node_type: "function",
            name: "redact_pii",
            after_flatten: true,
            org_id: "default",
            stream_name: "leftover",
          },
          position: { x: 300, y: 100 },
          io_type: "default",
        },
      ],
      edges: [{ id: "e1", source: "n1", target: "fn" }],
    };
    const { hcl } = exportOf([withFunction]);

    expect(hcl).toMatch(/function_name\s+= "redact_pii"/);
    expect(hcl).toMatch(/after_flatten\s+= true/);
    // A function node's stream fields are meaningless and must not be written.
    expect(hcl).not.toContain("leftover");
  });

  it("names a remote_stream node's destination", () => {
    const remote = {
      ...PIPELINE,
      nodes: [
        PIPELINE.nodes[0],
        {
          id: "out",
          data: {
            node_type: "remote_stream",
            destination_name: "ship_to_remote",
            stream_name: "far_side",
            stream_type: "logs",
          },
          position: { x: 300, y: 100 },
          io_type: "output",
        },
      ],
      edges: [{ id: "e1", source: "n1", target: "out" }],
    };
    const { hcl } = exportOf([remote]);

    expect(hcl).toMatch(/destination_name\s+= "ship_to_remote"/);
    expect(hcl).toMatch(/stream_name\s+= "far_side"/);
  });

  it("reports a scheduled pipeline, which the provider does not model yet", () => {
    const scheduled = {
      ...PIPELINE,
      source: { source_type: "scheduled", query_condition: { sql: "SELECT 1" } },
    };
    const { hcl, unsupported } = exportOf([scheduled]);

    expect(hcl).toBe("");
    expect(unsupported).toEqual([{ name: "tf_pipeline", reason: "scheduled" }]);
  });

  it("reports a pipeline the provider's graph rules would reject", () => {
    // Fewer than two nodes, or no edges, is not a graph.
    expect(exportOf([{ ...PIPELINE, nodes: [PIPELINE.nodes[0]] }]).unsupported).toEqual([
      { name: "tf_pipeline", reason: "incomplete" },
    ]);
    expect(exportOf([{ ...PIPELINE, edges: [] }]).unsupported).toEqual([
      { name: "tf_pipeline", reason: "incomplete" },
    ]);
  });

  it("ignores a node kind the provider has no block for", () => {
    const withUnknown = {
      ...PIPELINE,
      nodes: [...PIPELINE.nodes, { id: "x", data: { node_type: "future_thing" }, position: {} }],
    };
    const { hcl } = exportOf([withUnknown]);

    expect(hcl).not.toContain("future_thing");
    expect(hcl.match(/^\s+node \{/gm)).toHaveLength(3);
  });
});

describe("pipelineIdOf", () => {
  it("finds the id under any of the spellings a payload uses", () => {
    expect(pipelineIdOf(PIPELINE)).toBe("7497873160428060672");
    expect(pipelineIdOf({ pipelineId: "abc" })).toBe("abc");
    expect(pipelineIdOf({ id: "def" })).toBe("def");
    expect(pipelineIdOf({ name: "no id" })).toBe("");
  });
});

describe("import blocks", () => {
  it("addresses the pipeline as org/pipeline_id", () => {
    const { hcl } = exportOf([PIPELINE], { orgId: "default" });

    expect(hcl).toContain("to = openobserve_pipeline.tf_pipeline");
    expect(hcl).toContain('id = "default/7497873160428060672"');
  });

  it("keeps ids paired with the right pipeline when one is skipped", () => {
    const scheduled = { ...PIPELINE, name: "skipped", source: { source_type: "scheduled" } };
    const { hcl } = exportOf([scheduled, PIPELINE], {
      orgId: "default",
      ids: ["skipped-id", "kept-id"],
    });

    expect(hcl).toContain('id = "default/kept-id"');
    expect(hcl).not.toContain("skipped-id");
  });

  it("writes none without an org", () => {
    expect(exportOf([PIPELINE]).hcl).not.toContain("import {");
  });
});
