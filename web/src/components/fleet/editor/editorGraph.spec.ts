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
import {
  CATALOG,
  addFromCatalog,
  catalogFor,
  graphToYaml,
  isSettingPath,
  seedGraph,
  typeKey,
  yamlToGraph,
  type EditorGraph,
  type EditorKind,
} from "./editorGraph";
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

  it("keeps an empty map such as a hostmetrics scraper and writes it back as {}", () => {
    const yaml = `receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu: {}
      memory: {}
exporters:
  otlphttp:
    endpoint: \${env:O2_ENDPOINT}
service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      exporters: [otlphttp]
`;
    const graph = yamlToGraph(yaml);
    expect(graph?.components["receiver:hostmetrics"].settings).toEqual({
      collection_interval: "30s",
      "scrapers.cpu": "{}",
      "scrapers.memory": "{}",
    });
    expect(load(graphToYaml(graph!))).toEqual(load(yaml));
  });

  it("keeps lists as indexed keys and writes them back, including a list of maps", () => {
    const yaml = `receivers:
  filelog:
    include: ["/var/log/pods/*/*/*.log"]
    include_file_path: true
    operators:
      - type: container
        add_metadata_from_filepath: true
      - type: regex_parser
        regex: ^(?P<time>\\S+)
processors:
  k8sattributes:
    extract:
      metadata: [k8s.pod.name, k8s.namespace.name]
  resource:
    attributes:
      - key: env
        value: prod
        action: upsert
exporters:
  otlphttp:
    endpoint: \${env:O2_ENDPOINT}
    headers:
      Authorization: \${env:O2_TOKEN}
    retry_on_failure:
      enabled: true
    sending_queue: {}
    extra: []
service:
  pipelines:
    logs:
      receivers: [filelog]
      processors: [k8sattributes, resource]
      exporters: [otlphttp]
`;
    const graph = yamlToGraph(yaml);
    expect(graph?.components["receiver:filelog"].settings).toEqual({
      "include[0]": "/var/log/pods/*/*/*.log",
      include_file_path: "true",
      "operators[0].type": "container",
      "operators[0].add_metadata_from_filepath": "true",
      "operators[1].type": "regex_parser",
      "operators[1].regex": "^(?P<time>\\S+)",
    });
    expect(graph?.components["processor:resource"].settings).toEqual({
      "attributes[0].key": "env",
      "attributes[0].value": "prod",
      "attributes[0].action": "upsert",
    });
    expect(graph?.components["exporter:otlphttp"].settings).toMatchObject({
      sending_queue: "{}",
      extra: "[]",
    });
    expect(load(graphToYaml(graph!))).toEqual(load(yaml));
  });

  it("keeps quoted text that reads as a boolean, number or null a string", () => {
    const yaml = `exporters:
  otlphttp:
    headers:
      flag: "true"
      code: "123"
      nothing: "null"
      on: true
      port: 8080
service:
  pipelines:
    logs:
      receivers: [otlp]
      exporters: [otlphttp]
receivers:
  otlp: {}
`;
    const graph = yamlToGraph(yaml);
    expect(graph?.components["exporter:otlphttp"].settings).toMatchObject({
      "headers.flag": '"true"',
      "headers.code": '"123"',
      "headers.nothing": '"null"',
      "headers.on": "true",
      "headers.port": "8080",
    });
    expect(load(graphToYaml(graph!))).toEqual(load(yaml));
    graph!.components["exporter:otlphttp"].settings["headers.typed"] = '"false"';
    graph!.components["exporter:otlphttp"].settings["headers.label"] = '"plain text"';
    const headers = (load(graphToYaml(graph!)) as any).exporters.otlphttp.headers;
    expect(headers.typed).toBe("false");
    expect(headers.label).toBe("plain text");
  });

  it("writes a quoted value's text literally and keeps quotes that are part of the value", () => {
    const yaml = `exporters:
  otlphttp:
    headers:
      etag: '"abc"'
      single: "'x'"
      path: 'C:\\temp'
service:
  pipelines:
    logs:
      receivers: [otlp]
      exporters: [otlphttp]
receivers:
  otlp: {}
`;
    const graph = yamlToGraph(yaml);
    expect(graph).not.toBeNull();
    expect(load(graphToYaml(graph!))).toEqual(load(yaml));
    const settings = graph!.components["exporter:otlphttp"].settings;
    settings["headers.pattern"] = '"^\\d+$"';
    settings["headers.dir"] = '"C:\\temp"';
    settings["headers.typed"] = "'true'";
    const headers = (load(graphToYaml(graph!)) as any).exporters.otlphttp.headers;
    expect(headers).toMatchObject({
      etag: '"abc"',
      single: "'x'",
      pattern: "^\\d+$",
      dir: "C:\\temp",
      typed: "true",
    });
  });

  it("quotes a key that holds a dot or other path syntax and writes it back", () => {
    const yaml = `receivers:
  hostmetrics:
    scrapers:
      cpu: {}
processors:
  resourcedetection:
    detectors: [system]
    system:
      hostname_sources: [os]
      resource_attributes:
        host.id:
          enabled: true
        os.description:
          enabled: false
exporters:
  otlphttp:
    endpoint: \${env:O2_ENDPOINT}
    headers:
      X-Scope.OrgID: tenant-a
      "a: b": "c"
      'say "hi"': x
service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: [resourcedetection]
      exporters: [otlphttp]
`;
    const graph = yamlToGraph(yaml);
    expect(graph?.components["processor:resourcedetection"].settings).toEqual({
      "detectors[0]": "system",
      "system.hostname_sources[0]": "os",
      'system.resource_attributes."host.id".enabled': "true",
      'system.resource_attributes."os.description".enabled': "false",
    });
    expect(graph?.components["exporter:otlphttp"].settings).toMatchObject({
      'headers."X-Scope.OrgID"': "tenant-a",
      'headers."a: b"': "c",
      'headers."say \\"hi\\""': "x",
    });
    expect(load(graphToYaml(graph!))).toEqual(load(yaml));
  });

  it("accepts quoted segments in a settings path and rejects malformed ones", () => {
    for (const path of [
      "endpoint",
      "headers.Authorization",
      "include[0]",
      "operators[1].regex",
      'resource_attributes."host.id".enabled',
      '"a.b"[2]."c d"',
      '"say \\"hi\\""',
    ]) {
      expect(isSettingPath(path), path).toBe(true);
    }
    for (const path of [
      "",
      ".a",
      "a.",
      "a..b",
      "a b",
      'a."b',
      '"\\q"',
      "a[x]",
      "[0]",
      "host.id.",
    ]) {
      expect(isSettingPath(path), path).toBe(false);
    }
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
    ["a list holding a null", MINIMAL.replace("debug: {}", "debug:\n    include: [a, null]")],
    ["a null leaf in settings", MINIMAL.replace("debug: {}", "debug:\n    timeout: null")],
    ["connectors", MINIMAL + "connectors:\n  count: {}\n"],
    ["service.telemetry", MINIMAL + "  telemetry:\n    logs:\n      level: debug\n"],
    ["a top-level list", "- a\n- b\n"],
    ["unparseable YAML", "receivers: [otlp\n"],
  ])("cannot represent %s", (_name, src) => {
    expect(yamlToGraph(src)).toBeNull();
  });

  it.each([
    ["a dotted key", "a.b", '"a.b"'],
    ["a key spelled like a list index", "a[0]", '"a[0]"'],
  ])("represents %s by quoting it", (_name, key, path) => {
    const graph = yamlToGraph(MINIMAL.replace("debug: {}", `debug:\n    ${key}: x`));
    expect(graph?.components["exporter:debug"].settings).toEqual({ [path]: "x" });
    expect(load(graphToYaml(graph!))).toEqual(
      load(MINIMAL.replace("debug: {}", `debug:\n    ${key}: x`)),
    );
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

  it("closes the holes left in a list and lets children replace a scalar at the same path", () => {
    const yaml = graphToYaml(
      graph({
        components: {
          "receiver:filelog": {
            kind: "receiver",
            id: "filelog",
            type: "filelog",
            settings: {
              "include[0]": "/a.log",
              "include[3]": "/b.log",
              "operators[1].type": "container",
              retry: "5s",
              "retry.enabled": "true",
            },
          },
        },
      }),
    );
    expect(load(yaml)).toEqual({
      receivers: {
        filelog: {
          include: ["/a.log", "/b.log"],
          operators: [{ type: "container" }],
          retry: { enabled: true },
        },
      },
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

describe("Kubernetes palette items", () => {
  const added = (key: string) => {
    const graph = seedGraph();
    const item = CATALOG.find((i) => i.key === key)!;
    const compKey = addFromCatalog(graph, item);
    graph.pipelines[0].processors.push(graph.components[compKey].id);
    return { graph, yaml: load(graphToYaml(graph)) as Record<string, any> };
  };

  it("adds K8s attributes matched by pod uid then IP, never by the connection", () => {
    const { yaml } = added("k8sattributes");
    expect(yaml.processors.k8sattributes).toEqual({
      auth_type: "serviceAccount",
      pod_association: [
        { sources: [{ from: "resource_attribute", name: "k8s.pod.uid" }] },
        { sources: [{ from: "resource_attribute", name: "k8s.pod.ip" }] },
      ],
      extract: {
        metadata: [
          "k8s.pod.name",
          "k8s.namespace.name",
          "k8s.deployment.name",
          "k8s.node.name",
          "k8s.pod.ip",
        ],
      },
    });
  });

  it("adds the cluster name as a resource processor reading the chart's K8S_CLUSTER_NAME", () => {
    const { graph, yaml } = added("k8s_cluster_name");
    expect(yaml.processors["resource/k8s_cluster"]).toEqual({
      attributes: [{ key: "k8s.cluster.name", value: "${env:K8S_CLUSTER_NAME}", action: "upsert" }],
    });
    expect(yaml.service.pipelines.logs.processors).toEqual(["resource/k8s_cluster"]);
    expect(catalogFor(graph.components["processor:resource/k8s_cluster"])?.key).toBe(
      "k8s_cluster_name",
    );
  });

  it("keeps a plain resource processor on the generic Resource item", () => {
    const { graph } = added("resource");
    expect(catalogFor(graph.components["processor:resource"])?.key).toBe("resource");
  });
});

describe("upstream snake_case renames", () => {
  const itemFor = (kind: EditorKind, id: string) =>
    catalogFor({ kind, id, type: id.split("/")[0], settings: {} })?.key;

  it.each([
    ["receiver", "file_log", "filelog"],
    ["receiver", "fluent_forward", "fluentforward"],
    ["receiver", "host_metrics", "hostmetrics"],
    ["receiver", "k8s_objects", "k8sobjects"],
    ["receiver", "kubelet_stats", "kubeletstats"],
    ["receiver", "aws_s3", "awss3"],
    ["receiver", "windows_event_log", "windowseventlog"],
    ["processor", "k8s_attributes", "k8sattributes"],
    ["processor", "resource_detection", "resourcedetection"],
    ["exporter", "otlp_grpc", "otlp"],
    ["exporter", "otlp_http", "otlphttp"],
  ] as const)("shows a %s written as %s as the %s item", (kind, renamed, key) => {
    expect(itemFor(kind, renamed)).toBe(key);
    expect(itemFor(kind, key)).toBe(key);
  });

  it("maps otlp_grpc to otlp only for exporters, where upstream renamed it", () => {
    expect(typeKey("exporter", "otlp_grpc")).toBe("otlp");
    expect(typeKey("receiver", "otlp_grpc")).toBe("otlpgrpc");
  });

  it("finds a named item by its renamed id", () => {
    expect(itemFor("exporter", "otlp_http/openobserve")).toBe("openobserve");
    expect(itemFor("exporter", "otlp_http/other")).toBe("otlphttp");
  });

  it("keeps the name a configuration was written with", () => {
    const yaml = `processors:
  k8s_attributes:
    auth_type: serviceAccount
exporters:
  otlp_http/openobserve:
    endpoint: \${env:O2_ENDPOINT}
service:
  pipelines:
    logs:
      processors: [k8s_attributes]
      exporters: [otlp_http/openobserve]
`;
    expect(load(graphToYaml(yamlToGraph(yaml)!))).toEqual(load(yaml));
  });
});
