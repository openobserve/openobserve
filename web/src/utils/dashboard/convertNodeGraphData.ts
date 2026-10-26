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

import { chartColor } from "@/utils/chartTheme";
import { escapeHtml } from "@/utils/html";
import { getDataValue } from "./aliasUtils";
import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";
import { paintByPalette } from "./convertTreemapData";

export const NODE_GRAPH_LAYOUTS = ["force", "circular"] as const;
const NODE_SIZE_MIN = 14;
const NODE_SIZE_MAX = 40;
const EDGE_WIDTH_MIN = 1;
const EDGE_WIDTH_MAX = 6;

/** A graph node; `value` is the larger of its incoming and outgoing totals. */
export interface GraphNode {
  name: string;
  value: number;
  symbolSize?: number;
  itemStyle?: { color: string };
}

export interface GraphEdge {
  source: string;
  target: string;
  value: number;
  lineStyle?: { width: number; color?: string };
}

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

/** Sums rows into one edge per source → target pair and sizes each node by the traffic through it. */
export const buildGraph = (
  panelSchema: any,
  data: any[],
): { nodes: GraphNode[]; edges: GraphEdge[] } => {
  const edges = new Map<string, GraphEdge>();
  (panelSchema?.queries ?? []).forEach((query: any, index: number) => {
    const rows = data?.[index];
    const { source, target, value } = query?.fields ?? {};
    if (!Array.isArray(rows) || !source || !target || !value || query?.config?.hide) return;
    rows.forEach((row: any) => {
      const from = getDataValue(row, source.alias);
      const to = getDataValue(row, target.alias);
      const amount = toNumber(getDataValue(row, value.alias));
      if (from == null || from === "" || to == null || to === "" || amount === null) return;
      const key = JSON.stringify([String(from), String(to)]);
      const edge = edges.get(key) ?? { source: String(from), target: String(to), value: 0 };
      edge.value += amount;
      edges.set(key, edge);
    });
  });
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  const order: string[] = [];
  edges.forEach((edge) => {
    [edge.source, edge.target].forEach((name) => {
      if (!incoming.has(name)) {
        incoming.set(name, 0);
        outgoing.set(name, 0);
        order.push(name);
      }
    });
    outgoing.set(edge.source, outgoing.get(edge.source)! + edge.value);
    incoming.set(edge.target, incoming.get(edge.target)! + edge.value);
  });
  const nodes = order.map((name) => ({
    name,
    value: Math.max(incoming.get(name)!, outgoing.get(name)!),
  }));
  return { nodes, edges: [...edges.values()] };
};

const scale = (value: number, max: number, low: number, high: number) =>
  max > 0 ? low + (high - low) * Math.sqrt(Math.max(0, value) / max) : low;

/** Converts SQL source/target/value rows into a node graph with directed, weighted edges. */
export const convertNodeGraphData = (panelSchema: any, data: any, store: any) => {
  const config = panelSchema?.config ?? {};
  const { nodes, edges } = buildGraph(panelSchema, Array.isArray(data) ? data : []);
  if (!edges.length) return { options: { series: [] }, extras: { panelId: panelSchema?.id } };

  paintByPalette(nodes, config, store?.state?.theme);
  const maxNode = Math.max(...nodes.map((node) => node.value));
  const maxEdge = Math.max(...edges.map((edge) => edge.value));
  nodes.forEach((node) => {
    node.symbolSize = scale(node.value, maxNode, NODE_SIZE_MIN, NODE_SIZE_MAX);
  });
  const colorOf = new Map(nodes.map((node) => [node.name, node.itemStyle?.color]));
  edges.forEach((edge) => {
    edge.lineStyle = {
      width: scale(edge.value, maxEdge, EDGE_WIDTH_MIN, EDGE_WIDTH_MAX),
      color: colorOf.get(edge.source),
    };
  });
  const format = (value: unknown) =>
    formatUnitValue(getUnitValue(value, config.unit, config.unit_custom, config.decimals));
  const circular = config.node_graph_layout === "circular";

  const options = {
    backgroundColor: "transparent",
    tooltip: {
      show: true,
      trigger: "item",
      appendToBody: true,
      className: "o2-echarts-tooltip",
      textStyle: { color: chartColor("--color-tooltip-text"), fontSize: 12 },
      backgroundColor: chartColor("--color-tooltip-bg"),
      borderColor: chartColor("--color-tooltip-border"),
      formatter: (params: any) => {
        const label =
          params?.dataType === "edge"
            ? `${params?.data?.source ?? ""} → ${params?.data?.target ?? ""}`
            : (params?.name ?? "");
        return `${escapeHtml(label)}: <strong>${escapeHtml(format(params?.value))}</strong>`;
      },
    },
    series: [
      {
        type: "graph",
        layout: circular ? "circular" : "force",
        data: nodes,
        links: edges,
        // Circular labels sit beside the outer nodes, so the ring needs room for them.
        top: circular ? 32 : 24,
        bottom: circular ? 32 : 24,
        left: circular ? 96 : 24,
        right: circular ? 96 : 24,
        draggable: !circular,
        force: { repulsion: 600, gravity: 0.06, edgeLength: [120, 240], layoutAnimation: false },
        circular: { rotateLabel: false },
        edgeSymbol: ["none", "arrow"],
        edgeSymbolSize: 8,
        label: {
          show: true,
          position: "right",
          color: chartColor("--color-text-body"),
          overflow: "truncate",
        },
        lineStyle: { opacity: 0.55, curveness: circular ? 0.3 : 0.12 },
        edgeLabel: {
          show: config.node_graph_show_edge_labels === true,
          color: chartColor("--color-text-secondary"),
          formatter: (params: any) => format(params?.value),
        },
        emphasis: { focus: "adjacency", lineStyle: { opacity: 0.9 } },
      },
    ],
  };
  return { options, extras: { panelId: panelSchema?.id } };
};
