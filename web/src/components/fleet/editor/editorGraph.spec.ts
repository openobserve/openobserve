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
import { load } from "js-yaml";
import { graphToYaml, seedGraph, yamlToGraph, type EditorGraph } from "./editorGraph";
import { SEEDS } from "./editorGraph.fixtures";

const SEED_IDS = Object.keys(SEEDS);

const MINIMAL = `receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
exporters:
  debug: {}
service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [debug]
`;

describe("yamlToGraph", () => {
  it.each(SEED_IDS)("round-trips the %s seed", (id) => {
    const seed = SEEDS[id]();
    expect(yamlToGraph(graphToYaml(seed))).toEqual(seed);
  });

  it("round-trips the graph a new configuration starts from", () => {
    expect(yamlToGraph(graphToYaml(seedGraph()))).toEqual(seedGraph());
  });

  it("reads a config without processors and a component written as {}", () => {
    const graph = yamlToGraph(MINIMAL);
    expect(graph).toEqual({
      components: {
        "receiver:otlp": {
          kind: "receiver",
          id: "otlp",
          type: "otlp",
          settings: { "protocols.grpc.endpoint": "0.0.0.0:4317" },
        },
        "exporter:debug": { kind: "exporter", id: "debug", type: "debug", settings: {} },
      },
      pipelines: [{ id: "traces", receivers: ["otlp"], processors: [], exporters: ["debug"] }],
      extensions: [],
    });
  });

  it("reads an empty document as an empty graph", () => {
    expect(yamlToGraph("")).toEqual({ components: {}, pipelines: [], extensions: [] });
  });

  it.each([
    [
      "an explicit empty processors list",
      MINIMAL.replace("receivers: [otlp]", "receivers: [otlp]\n      processors: []"),
    ],
    [
      "an explicit empty exporters section",
      MINIMAL.replace("exporters:\n  debug: {}", "exporters: {}"),
    ],
    ["a null component", MINIMAL.replace("debug: {}", "debug:")],
    ["a list in settings", MINIMAL.replace("debug: {}", "debug:\n    include: [a, b]")],
    [
      "an empty mapping in settings",
      MINIMAL.replace("grpc:\n        endpoint: 0.0.0.0:4317", "grpc: {}"),
    ],
    ["a null leaf in settings", MINIMAL.replace("debug: {}", "debug:\n    timeout: null")],
    ["connectors", MINIMAL + "connectors:\n  count: {}\n"],
    ["service.telemetry", MINIMAL + "  telemetry:\n    logs:\n      level: debug\n"],
    ["a dotted key", MINIMAL.replace("debug: {}", "debug:\n    a.b: x")],
    ["a quoted number", MINIMAL.replace("debug: {}", 'debug:\n    sampling: "5"')],
    ["a top-level list", "- a\n- b\n"],
    ["unparseable YAML", "receivers: [otlp\n"],
  ])("cannot represent %s", (_name, src) => {
    expect(yamlToGraph(src)).toBeNull();
  });
});

describe("components from the base config", () => {
  const BASE_REFS = `processors:
  batch: {}
service:
  extensions: [health_check]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlphttp/o2]
`;

  it("shows a pipeline's undefined references as base config components", () => {
    const graph = yamlToGraph(BASE_REFS);
    expect(graph?.components).toEqual({
      "processor:batch": { kind: "processor", id: "batch", type: "batch", settings: {} },
      "receiver:otlp": { kind: "receiver", id: "otlp", type: "otlp", settings: {}, base: true },
      "exporter:otlphttp/o2": {
        kind: "exporter",
        id: "otlphttp/o2",
        type: "otlphttp",
        settings: {},
        base: true,
      },
      "extension:health_check": {
        kind: "extension",
        id: "health_check",
        type: "health_check",
        settings: {},
        base: true,
      },
    });
    expect(graph?.pipelines).toEqual([
      { id: "traces", receivers: ["otlp"], processors: ["batch"], exporters: ["otlphttp/o2"] },
    ]);
    expect(graph?.extensions).toEqual(["health_check"]);
  });

  it("never writes a definition for a base config component", () => {
    const graph = yamlToGraph(BASE_REFS)!;
    expect(load(graphToYaml(graph))).toEqual(load(BASE_REFS));
    graph.pipelines.push({ id: "logs", receivers: ["otlp"], processors: [], exporters: [] });
    expect(load(graphToYaml(graph))).toMatchObject({
      service: { pipelines: { logs: { receivers: ["otlp"] } } },
    });
    expect(load(graphToYaml(graph))).not.toHaveProperty("receivers");
  });

  it("keeps a component defined here as a normal one", () => {
    expect(yamlToGraph(MINIMAL)?.components["receiver:otlp"]).not.toHaveProperty("base");
  });
});

describe("graphToYaml", () => {
  const graph = (over: Partial<EditorGraph> = {}): EditorGraph => ({
    components: {},
    pipelines: [],
    extensions: [],
    ...over,
  });

  it("omits empty sections, empty pipeline lists and an empty service", () => {
    expect(load(graphToYaml(graph()) || "")).toBeUndefined();
    const yaml = graphToYaml(
      graph({
        components: {
          "receiver:otlp": { kind: "receiver", id: "otlp", type: "otlp", settings: {} },
        },
        pipelines: [{ id: "logs", receivers: ["otlp"], processors: [], exporters: [] }],
      }),
    );
    expect(load(yaml)).toEqual({
      receivers: { otlp: {} },
      service: { pipelines: { logs: { receivers: ["otlp"] } } },
    });
  });

  it("writes a pipeline with no components as {} and a component with no settings as {}", () => {
    const yaml = graphToYaml(
      graph({
        components: {
          "extension:pprof": { kind: "extension", id: "pprof", type: "pprof", settings: {} },
        },
        pipelines: [{ id: "logs", receivers: [], processors: [], exporters: [] }],
      }),
    );
    expect(yaml).toContain("  pprof: {}");
    expect(yaml).toContain("    logs: {}");
    expect(load(yaml)).toEqual({ extensions: { pprof: {} }, service: { pipelines: { logs: {} } } });
  });
});
