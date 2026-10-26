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

import { load } from "js-yaml";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

/** The settings value standing for an empty YAML map. */
export const EMPTY_MAP = "{}";
/** The settings value standing for an empty YAML list. */
export const EMPTY_LIST = "[]";

export type EditorKind = "receiver" | "processor" | "exporter" | "extension";

export interface CatalogItem {
  /** Palette key; usually the component type, but several items can share a type. */
  key: string;
  kind: EditorKind;
  type: string;
  /** Component name as the OTel docs spell it — not translated. */
  name: string;
  icon: IconName;
  /** Id given to the first instance; later ones get a numeric suffix. */
  idHint?: string;
  defaults: Record<string, string>;
}

export interface EditorComponent {
  kind: EditorKind;
  id: string;
  type: string;
  settings: Record<string, string>;
  /** Referenced here but defined in the collector's base config, so the YAML never defines it. */
  base?: true;
}

export interface EditorPipeline {
  id: string;
  receivers: string[];
  processors: string[];
  exporters: string[];
}

export interface EditorGraph {
  /** Keyed by `${kind}:${id}` — receivers and exporters share ids like `otlp`. */
  components: Record<string, EditorComponent>;
  pipelines: EditorPipeline[];
  extensions: string[];
}

export const PALETTE_MIME = "application/x-fleet-component";

export const SIGNALS = ["metrics", "logs", "traces"] as const;
export type Signal = (typeof SIGNALS)[number];

const r = (
  key: string,
  name: string,
  icon: IconName,
  defaults: Record<string, string>,
  extra: Partial<CatalogItem> = {},
): CatalogItem => ({ key, kind: "receiver", type: key, name, icon, defaults, ...extra });
const p = (
  key: string,
  name: string,
  icon: IconName,
  defaults: Record<string, string>,
): CatalogItem => ({ key, kind: "processor", type: key, name, icon, defaults });
const e = (
  key: string,
  name: string,
  icon: IconName,
  defaults: Record<string, string>,
  extra: Partial<CatalogItem> = {},
): CatalogItem => ({ key, kind: "exporter", type: key, name, icon, defaults, ...extra });
const x = (
  key: string,
  name: string,
  icon: IconName,
  defaults: Record<string, string>,
): CatalogItem => ({ key, kind: "extension", type: key, name, icon, defaults });

export const CATALOG: CatalogItem[] = [
  r("otlp", "OTLP", "input", {
    "protocols.grpc.endpoint": "0.0.0.0:4317",
    "protocols.http.endpoint": "0.0.0.0:4318",
  }),
  r("prometheus", "Prometheus", "query-stats", {
    "config.scrape_configs[0].job_name": "kubernetes-pods",
    "config.scrape_configs[0].scrape_interval": "30s",
    "config.scrape_configs[0].kubernetes_sd_configs[0].role": "pod",
    "config.scrape_configs[0].relabel_configs[0].source_labels[0]":
      "__meta_kubernetes_pod_annotation_prometheus_io_scrape",
    "config.scrape_configs[0].relabel_configs[0].action": "keep",
    "config.scrape_configs[0].relabel_configs[0].regex": "true",
  }),
  r("filelog", "File log", "description", {
    "include[0]": "/var/log/pods/*/*/*.log",
    start_at: "end",
    include_file_path: "true",
    "operators[0].type": "container",
  }),
  r("fluentforward", "Fluent forward", "forum", { endpoint: "0.0.0.0:8006" }),
  r("docker_stats", "Docker stats", "view-in-ar", {
    endpoint: "unix:///var/run/docker.sock",
    collection_interval: "15s",
  }),
  r("hostmetrics", "Host metrics", "memory", {
    collection_interval: "30s",
    "scrapers.cpu": EMPTY_MAP,
    "scrapers.memory": EMPTY_MAP,
    "scrapers.disk": EMPTY_MAP,
    "scrapers.filesystem": EMPTY_MAP,
    "scrapers.network": EMPTY_MAP,
    "scrapers.load": EMPTY_MAP,
  }),
  r("jaeger", "Jaeger", "timeline", { "protocols.grpc.endpoint": "0.0.0.0:14250" }),
  r("zipkin", "Zipkin", "timeline", { endpoint: "0.0.0.0:9411" }),
  r("k8s_cluster", "K8s cluster", "hub", {
    collection_interval: "30s",
    auth_type: "serviceAccount",
  }),
  r("k8s_events", "K8s events", "event-note", { auth_type: "serviceAccount" }),
  r("k8sobjects", "K8s objects", "data-object", {
    auth_type: "serviceAccount",
    "objects[0].name": "pods",
    "objects[0].mode": "watch",
  }),
  r("kubeletstats", "Kubelet stats", "hub", {
    collection_interval: "20s",
    endpoint: "https://${env:K8S_NODE_NAME}:10250",
    auth_type: "serviceAccount",
    insecure_skip_verify: "true",
  }),
  r("journald", "Journald", "article", {
    "units[0]": "kubelet",
    "units[1]": "containerd",
    directory: "/var/log/journal",
  }),
  r("syslog", "Syslog", "receipt-long", {
    "tcp.listen_address": "0.0.0.0:54526",
    protocol: "rfc5424",
  }),
  r("statsd", "StatsD", "speed", { endpoint: "0.0.0.0:8125" }),
  r("awss3", "AWS S3", "cloud-download", {
    "s3downloader.region": "us-east-1",
    "s3downloader.s3_bucket": "acme-telemetry",
    "s3downloader.s3_prefix": "telemetry",
  }),
  r("windowseventlog", "Windows event log", "window", { channel: "System" }),
  r("postgresql", "PostgreSQL", "database", {
    endpoint: "localhost:5432",
    username: "postgres",
    password: "${env:PG_PASSWORD}",
  }),
  r("mysql", "MySQL", "database", {
    endpoint: "localhost:3306",
    username: "root",
    password: "${env:MYSQL_PASSWORD}",
  }),
  p("batch", "Batch", "inventory-2", { timeout: "5s", send_batch_size: "8192" }),
  p("memory_limiter", "Memory limiter", "memory", {
    check_interval: "1s",
    limit_mib: "400",
    spike_limit_mib: "100",
  }),
  p("k8sattributes", "K8s attributes", "label", {
    auth_type: "serviceAccount",
    "extract.metadata[0]": "k8s.pod.name",
    "extract.metadata[1]": "k8s.namespace.name",
    "extract.metadata[2]": "k8s.deployment.name",
  }),
  p("resource", "Resource", "tune", {
    "attributes[0].key": "deployment.environment",
    "attributes[0].value": "production",
    "attributes[0].action": "upsert",
  }),
  p("attributes", "Attributes", "tag", {
    "actions[0].key": "env",
    "actions[0].value": "prod",
    "actions[0].action": "insert",
  }),
  p("filter", "Filter", "filter-alt", {
    "logs.log_record[0]": "severity_number < SEVERITY_NUMBER_INFO",
  }),
  p("transform", "Transform", "transform", {
    "log_statements[0].context": "log",
    "log_statements[0].statements[0]": 'set(attributes["cluster"], "prod")',
  }),
  p("tail_sampling", "Tail sampling", "science", {
    decision_wait: "10s",
    num_traces: "50000",
    "policies[0].name": "errors",
    "policies[0].type": "status_code",
    "policies[0].status_code.status_codes[0]": "ERROR",
  }),
  p("resourcedetection", "Resource detection", "manage-search", {
    "detectors[0]": "env",
    "detectors[1]": "system",
  }),
  e("otlp", "OTLP", "send", {
    endpoint: "otel-gateway:4317",
    "tls.insecure": "false",
    "headers.Authorization": "${env:OTLP_TOKEN}",
  }),
  e("otlphttp", "OTLP HTTP", "cloud-upload", {
    endpoint: "https://collector.example.com",
    "headers.Authorization": "${env:OTLP_TOKEN}",
  }),
  e(
    "openobserve",
    "OpenObserve",
    "cloud-upload",
    {
      endpoint: "${env:O2_ENDPOINT}",
      "headers.Authorization": "${env:O2_TOKEN}",
      "headers.stream-name": "default",
    },
    { type: "otlphttp", idHint: "otlphttp/openobserve" },
  ),
  e("debug", "Debug", "code", { verbosity: "basic" }),
  e("kafka", "Kafka", "hub", {
    "brokers[0]": "kafka:9092",
    topic: "otlp_logs",
    encoding: "otlp_proto",
  }),
  x("file_storage", "File storage", "storage", {
    directory: "/var/lib/opampsupervisor/storage",
    create_directory: "true",
  }),
  x("health_check", "Health check", "monitor-heart", { endpoint: "0.0.0.0:13133" }),
  x("k8s_leader_elector", "K8s leader elector", "workspace-premium", {
    auth_type: "serviceAccount",
    lease_name: "otel-fleet-collector-gateway",
    lease_namespace: "${env:K8S_NAMESPACE}",
  }),
  x("pprof", "pprof", "speed", { endpoint: "localhost:1777" }),
  x("zpages", "zpages", "insights", { endpoint: "localhost:55679" }),
];

export const compKey = (kind: EditorKind, id: string) => `${kind}:${id}`;

export function catalogFor(c: EditorComponent): CatalogItem | undefined {
  return (
    CATALOG.find((i) => i.kind === c.kind && i.idHint === c.id) ??
    CATALOG.find((i) => i.kind === c.kind && i.type === c.type && !i.idHint) ??
    CATALOG.find((i) => i.kind === c.kind && i.type === c.type)
  );
}

/** Adds a component instance from the palette and returns its key. */
export function addFromCatalog(graph: EditorGraph, item: CatalogItem): string {
  const base = item.idHint ?? item.type;
  let id = base;
  let n = 2;
  while (graph.components[compKey(item.kind, id)]) id = `${base}/${n++}`;
  graph.components[compKey(item.kind, id)] = {
    kind: item.kind,
    id,
    type: item.type,
    settings: { ...item.defaults },
  };
  return compKey(item.kind, id);
}

/** The graph a new configuration starts from: one empty logs pipeline. */
export function seedGraph(): EditorGraph {
  return {
    components: {},
    pipelines: [{ id: "logs", receivers: [], processors: [], exporters: [] }],
    extensions: [],
  };
}

/** Pipeline ids a component is wired into, for the "shared across" hint. */
export function pipelinesUsing(graph: EditorGraph, key: string): string[] {
  const [kind, ...rest] = key.split(":");
  const id = rest.join(":");
  const field = `${kind}s` as "receivers" | "processors" | "exporters";
  return graph.pipelines.filter((p) => p[field]?.includes(id)).map((p) => p.id);
}

const isMap = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isIdList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

type Segment = string | number;

/** `a.b[0].c` → ["a", "b", 0, "c"]. */
function segments(path: string): Segment[] {
  const out: Segment[] = [];
  for (const part of path.split(".")) {
    const name = part.replace(/(\[\d+\])+$/, "");
    if (name) out.push(name);
    for (const m of part.slice(name.length).matchAll(/\[(\d+)\]/g)) out.push(Number(m[1]));
  }
  return out;
}

const leaf = (value: string): unknown =>
  value === EMPTY_MAP ? {} : value === EMPTY_LIST ? [] : value;

/** Drops the holes a settings edit can leave in a list. */
function compact(node: unknown): unknown {
  if (Array.isArray(node)) return node.filter((x) => x !== undefined).map(compact);
  if (isMap(node)) return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, compact(v)]));
  return node;
}

function nest(settings: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(settings)) {
    const segs = segments(path);
    let cur: Record<string, unknown> = out;
    segs.forEach((seg, i) => {
      if (i === segs.length - 1) {
        cur[seg] = leaf(value);
        return;
      }
      const wantList = typeof segs[i + 1] === "number";
      // A scalar at a path that also has children loses to the children.
      const fits = wantList ? Array.isArray(cur[seg]) : isMap(cur[seg]);
      if (!fits) cur[seg] = wantList ? [] : {};
      cur = cur[seg] as Record<string, unknown>;
    });
  }
  return compact(out) as Record<string, unknown>;
}

const scalar = (v: string) => (/^[\w./-]+$/.test(v) ? v : JSON.stringify(v));

function emitList(key: string, items: unknown[], indent: number, lines: string[]) {
  const pad = " ".repeat(indent);
  lines.push(`${pad}${key}:`);
  for (const item of items) {
    if (isMap(item) && Object.keys(item).length) {
      const sub: string[] = [];
      emit(item, indent + 4, sub);
      lines.push(`${pad}  - ${sub[0].trimStart()}`, ...sub.slice(1));
    } else if (isMap(item)) lines.push(`${pad}  - {}`);
    else lines.push(`${pad}  - ${scalar(String(item))}`);
  }
}

function emit(obj: Record<string, unknown>, indent: number, lines: string[]) {
  const pad = " ".repeat(indent);
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      if (!v.length) lines.push(`${pad}${k}: []`);
      else emitList(k, v, indent, lines);
    } else if (isMap(v)) {
      if (!Object.keys(v).length) lines.push(`${pad}${k}: {}`);
      else {
        lines.push(`${pad}${k}:`);
        emit(v, indent + 2, lines);
      }
    } else lines.push(`${pad}${k}: ${scalar(String(v))}`);
  }
}

/** Generates collector YAML from the in-memory graph. */
export function graphToYaml(graph: EditorGraph): string {
  const lines: string[] = [];
  // An emitted empty value is not a no-op: the supervisor's merge replaces the base config's value with it.
  const section = (title: string, kind: EditorKind) => {
    const comps = Object.values(graph.components).filter((c) => c.kind === kind && !c.base);
    if (!comps.length) return;
    lines.push(`${title}:`);
    for (const c of comps) {
      if (!Object.keys(c.settings).length) lines.push(`  ${c.id}: {}`);
      else {
        lines.push(`  ${c.id}:`);
        emit(nest(c.settings), 4, lines);
      }
    }
  };
  section("receivers", "receiver");
  section("processors", "processor");
  section("exporters", "exporter");
  section("extensions", "extension");
  if (graph.extensions.length || graph.pipelines.length) lines.push("service:");
  if (graph.extensions.length) lines.push(`  extensions: [${graph.extensions.join(", ")}]`);
  if (graph.pipelines.length) lines.push("  pipelines:");
  for (const p of graph.pipelines) {
    const lists = (["receivers", "processors", "exporters"] as const).filter((f) => p[f].length);
    if (!lists.length) {
      lines.push(`    ${p.id}: {}`);
      continue;
    }
    lines.push(`    ${p.id}:`);
    for (const f of lists) lines.push(`      ${f}: [${p[f].join(", ")}]`);
  }
  return lines.join("\n") + "\n";
}

const SECTIONS: [string, EditorKind][] = [
  ["receivers", "receiver"],
  ["processors", "processor"],
  ["exporters", "exporter"],
  ["extensions", "extension"],
];

/** Settings as dotted keys with `[i]` list indexes, or null when a graph edit could not write them back. */
function flatten(obj: Record<string, unknown>): Record<string, string> | null {
  const out: Record<string, string> = {};
  const visit = (path: string, v: unknown): boolean => {
    if (v === null) return false;
    if (Array.isArray(v)) {
      if (!v.length) out[path] = EMPTY_LIST;
      else return v.every((item, i) => visit(`${path}[${i}]`, item));
    } else if (isMap(v)) {
      // An empty map is a real setting (`cpu: {}` enables a scraper), kept as the literal `{}`.
      if (!Object.keys(v).length) out[path] = EMPTY_MAP;
      else return Object.entries(v).every(([k, c]) => visit(path ? `${path}.${k}` : k, c));
    } else out[path] = String(v);
    return true;
  };
  if (!Object.keys(obj).length) return out;
  return visit("", obj) ? out : null;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (!isMap(a) || !isMap(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]))
  );
}

function loadDoc(src: string): Record<string, unknown> | null {
  let doc: unknown;
  try {
    doc = load(src);
  } catch {
    return null;
  }
  if (doc === undefined || doc === null) return {};
  return isMap(doc) ? doc : null;
}

function buildGraph(doc: Record<string, unknown>): EditorGraph | null {
  const graph: EditorGraph = { components: {}, pipelines: [], extensions: [] };
  for (const [title, kind] of SECTIONS) {
    const section = doc[title] ?? {};
    if (!isMap(section)) return null;
    for (const [id, value] of Object.entries(section)) {
      if (!isMap(value)) return null;
      const settings = flatten(value);
      if (!settings) return null;
      graph.components[compKey(kind, id)] = { kind, id, type: id.split("/")[0], settings };
    }
  }
  const service = doc.service ?? {};
  if (!isMap(service)) return null;
  // The server accepts these too: the supervisor merges the fleet config onto the base config.
  const fromBase = (kind: EditorKind, ids: string[]) => {
    for (const id of ids) {
      const key = compKey(kind, id);
      graph.components[key] ??= { kind, id, type: id.split("/")[0], settings: {}, base: true };
    }
  };
  const extensions = service.extensions ?? [];
  if (!isIdList(extensions)) return null;
  fromBase("extension", extensions);
  graph.extensions = extensions;
  const pipelines = service.pipelines ?? {};
  if (!isMap(pipelines)) return null;
  for (const [id, value] of Object.entries(pipelines)) {
    if (!isMap(value)) return null;
    const { receivers = [], processors = [], exporters = [] } = value;
    if (!isIdList(receivers) || !isIdList(processors) || !isIdList(exporters)) return null;
    fromBase("receiver", receivers);
    fromBase("processor", processors);
    fromBase("exporter", exporters);
    graph.pipelines.push({ id, receivers, processors, exporters });
  }
  return graph;
}

/** The graph for `src`, or null when the visual editor cannot represent it without loss. */
export function yamlToGraph(src: string): EditorGraph | null {
  const doc = loadDoc(src);
  const graph = doc && buildGraph(doc);
  if (!graph) return null;
  return deepEqual(loadDoc(graphToYaml(graph)), doc) ? graph : null;
}
