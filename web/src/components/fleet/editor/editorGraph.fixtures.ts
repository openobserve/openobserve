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

import { CATALOG, compKey, type EditorGraph, type EditorKind } from "./editorGraph";

function seed(spec: {
  pipelines: [string, string[], string[], string[]][];
  extensions?: string[];
}): EditorGraph {
  const graph: EditorGraph = { components: {}, pipelines: [], extensions: [] };
  const ensure = (kind: EditorKind, token: string): string => {
    const item = CATALOG.find((i) => i.kind === kind && (i.idHint === token || i.key === token));
    const id = token;
    const key = compKey(kind, id);
    if (!graph.components[key]) {
      graph.components[key] = {
        kind,
        id,
        type: item?.type ?? token.split("/")[0],
        settings: { ...(item?.defaults ?? {}) },
      };
    }
    return id;
  };
  for (const [id, recv, proc, exp] of spec.pipelines) {
    graph.pipelines.push({
      id,
      receivers: recv.map((t) => ensure("receiver", t)),
      processors: proc.map((t) => ensure("processor", t)),
      exporters: exp.map((t) => ensure("exporter", t)),
    });
  }
  graph.extensions = (spec.extensions ?? []).map((t) => ensure("extension", t));
  return graph;
}

const O2 = "otlphttp/openobserve";
const CORE = ["memory_limiter", "k8sattributes", "batch"];

export const SEEDS: Record<string, () => EditorGraph> = {
  "k8s-cluster-telemetry": () =>
    seed({
      pipelines: [
        ["metrics", ["kubeletstats", "hostmetrics"], CORE, [O2]],
        ["logs", ["filelog"], CORE, [O2]],
        ["logs/k8s", ["k8s_events", "k8sobjects"], ["memory_limiter", "batch"], [O2, "kafka"]],
      ],
      extensions: ["file_storage", "health_check"],
    }),
  "linux-host-baseline": () =>
    seed({
      pipelines: [
        ["metrics", ["hostmetrics"], ["memory_limiter", "resourcedetection", "batch"], [O2]],
        ["logs", ["filelog", "journald"], ["memory_limiter", "resourcedetection", "batch"], [O2]],
      ],
      extensions: ["file_storage"],
    }),
  "windows-event-logs": () =>
    seed({
      pipelines: [["logs", ["windowseventlog", "filelog"], ["batch"], [O2]]],
      extensions: ["health_check"],
    }),
  "database-hosts": () =>
    seed({
      pipelines: [
        ["metrics", ["postgresql", "mysql"], ["batch"], [O2]],
        // Invalid on purpose: a pipeline with no exporter.
        ["logs", ["filelog"], ["transform", "batch"], []],
      ],
    }),
  "edge-minimal": () =>
    seed({
      pipelines: [
        ["metrics", ["hostmetrics"], ["batch"], [O2]],
        ["logs", ["filelog"], ["filter", "batch"], [O2]],
      ],
      extensions: ["file_storage"],
    }),
  "org-baseline": () =>
    seed({
      pipelines: [["traces", ["otlp"], ["memory_limiter", "batch"], [O2]]],
      extensions: ["health_check"],
    }),
};
