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

import { color as echartsColor } from "echarts/core";
import { chartColor } from "@/utils/chartTheme";
import { escapeHtml } from "@/utils/html";
import { getDataValue } from "./aliasUtils";
import { calculateWidthText } from "./chartDimensionUtils";
import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";
import { paintByPalette } from "./convertTreemapData";

export const NODE_GRAPH_LAYOUTS = ["force", "circular"] as const;
const NODE_SIZE_MIN = 14;
const NODE_SIZE_MAX = 40;
const EDGE_WIDTH_MIN = 1;
const EDGE_WIDTH_MAX = 6;
const NODE_LABEL_WIDTH = 96;
// eslint-disable-next-line local/no-hardcoded-px -- ECharts label fontSize is a plain canvas px value
const LABEL_FONT_SIZE = "12px";
const LABEL_PADDING: [number, number] = [2, 4];
// One 12px line plus a little slack over ECharts' glyph-based line height, and the chip's vertical padding.
const LABEL_HEIGHT = 14 + 2 * LABEL_PADDING[0];
// ECharts' default gap between a label and its symbol or edge.
const LABEL_DISTANCE = 5;
const LABEL_GAP = 2;
const LABEL_CHIP_OPACITY = 0.85;
const CURVENESS_FORCE = 0.12;
// Curves bulge by a share of their length, so long ring edges stay near the ring.
const CURVENESS_CIRCULAR = 0.15;
// The plot is inset so the largest node and its label below it stay inside the panel.
const PLOT_INSET = {
  top: NODE_SIZE_MAX / 2 + 4,
  bottom: NODE_SIZE_MAX / 2 + 20,
  left: NODE_LABEL_WIDTH / 2 + 8,
  right: NODE_LABEL_WIDTH / 2 + 8,
};
const FALLBACK_PANEL = { width: 800, height: 400 };

/** A graph node; `value` is the larger of its incoming and outgoing totals. */
export interface GraphNode {
  name: string;
  value: number;
  symbolSize?: number;
  itemStyle?: { color: string };
  label?: { width: number; overflow: "truncate" };
  x?: number;
  y?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  value: number;
  lineStyle?: { width: number; color?: string };
  label?: { show: boolean };
  emphasis?: { label: { show: boolean } };
}

type Point = [number, number];

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

/** Places nodes evenly on a unit circle, starting at the top. */
export const circularPositions = (count: number): Point[] =>
  Array.from({ length: count }, (_, index) => {
    const angle = (2 * Math.PI * index) / Math.max(count, 1) - Math.PI / 2;
    return [Math.cos(angle), Math.sin(angle)];
  });

/** Ring positions in name order, so the ring does not reshuffle when the query returns rows in another order. */
const ringByName = (nodes: GraphNode[]): Point[] => {
  const ring = circularPositions(nodes.length);
  const slot = new Map(
    nodes
      .map((node) => node.name)
      .sort()
      .map((name, i) => [name, i]),
  );
  return nodes.map((node) => ring[slot.get(node.name)!]);
};

/** A small seeded PRNG (mulberry32), so the same graph always gets the same force layout. */
const seededRandom = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const hashNames = (names: string[]) =>
  names
    .join("\u0000")
    .split("")
    .reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619), 2166136261) >>> 0;

/** A deterministic Fruchterman-Reingold layout from a start seeded by the node names, so a refresh with new values keeps every node in place. */
export const forcePositions = (nodes: GraphNode[], edges: GraphEdge[]): Point[] => {
  const count = nodes.length;
  if (count < 3) return circularPositions(count).map(([x, y]) => [x * 0.5, y * 0.5] as Point);
  // A symmetric start (such as a ring) stays symmetric, so a complete graph would settle back into a ring.
  // The query returns rows in no fixed order, so the simulation runs on names sorted, and its float sums repeat exactly.
  const names = nodes.map((node) => node.name).sort();
  const random = seededRandom(hashNames(names));
  const positions: Point[] = names.map(() => [random() - 0.5, random() - 0.5]);
  const index = new Map(names.map((name, i) => [name, i]));
  const links = edges
    .map((edge) => [index.get(edge.source)!, index.get(edge.target)!])
    .filter(([from, to]) => from !== to)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const k = Math.sqrt(1 / count);
  // Each iteration is O(n²), so large graphs settle in fewer steps.
  const iterations = Math.max(20, Math.min(300, Math.round(3_000_000 / (count * count))));
  for (let step = 0; step < iterations; step++) {
    const temperature = 0.1 * (1 - step / iterations);
    const shift = positions.map(() => [0, 0]);
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const dx = positions[i][0] - positions[j][0];
        const dy = positions[i][1] - positions[j][1];
        const distance = Math.max(Math.hypot(dx, dy), 0.01);
        const push = (k * k) / distance;
        shift[i][0] += (dx / distance) * push;
        shift[i][1] += (dy / distance) * push;
        shift[j][0] -= (dx / distance) * push;
        shift[j][1] -= (dy / distance) * push;
      }
    }
    links.forEach(([from, to]) => {
      const dx = positions[from][0] - positions[to][0];
      const dy = positions[from][1] - positions[to][1];
      const distance = Math.max(Math.hypot(dx, dy), 0.01);
      const pull = (distance * distance) / k;
      shift[from][0] -= (dx / distance) * pull;
      shift[from][1] -= (dy / distance) * pull;
      shift[to][0] += (dx / distance) * pull;
      shift[to][1] += (dy / distance) * pull;
    });
    positions.forEach((position, i) => {
      // Gravity keeps disconnected parts from drifting to the edges.
      shift[i][0] -= position[0] * k;
      shift[i][1] -= position[1] * k;
      const length = Math.max(Math.hypot(shift[i][0], shift[i][1]), 1e-9);
      const move = Math.min(length, temperature);
      position[0] += (shift[i][0] / length) * move;
      position[1] += (shift[i][1] / length) * move;
    });
  }
  return nodes.map((node) => positions[index.get(node.name)!]);
};

/** Maps layout coordinates onto the inset plot the way the chart does, in pixels. */
const toPlot = (positions: Point[], panel: { width: number; height: number }): Point[] => {
  const xs = positions.map(([x]) => x);
  const ys = positions.map(([, y]) => y);
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const width = Math.max(panel.width - PLOT_INSET.left - PLOT_INSET.right, 1);
  const height = Math.max(panel.height - PLOT_INSET.top - PLOT_INSET.bottom, 1);
  // The chart stretches the nodes' bounding box onto the plot, so anything but a full fit would distort the symbols.
  return positions.map(([x, y]) => [
    PLOT_INSET.left + (maxX > minX ? ((x - minX) / (maxX - minX)) * width : width / 2),
    PLOT_INSET.top + (maxY > minY ? ((y - minY) / (maxY - minY)) * height : height / 2),
  ]);
};

/** A rectangle by centre, half sizes and rotation, since ECharts turns edge labels along their edge. */
interface Box {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
  angle: number;
}

interface Circle {
  x: number;
  y: number;
  radius: number;
}

const corners = (box: Box): Point[] => {
  const [cos, sin] = [Math.cos(box.angle), Math.sin(box.angle)];
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => [
    box.x + sx * box.halfWidth * cos - sy * box.halfHeight * sin,
    box.y + sx * box.halfWidth * sin + sy * box.halfHeight * cos,
  ]);
};

/** Separating-axis test for two rotated rectangles, kept `gap` apart. */
const overlap = (a: Box, b: Box, gap = LABEL_GAP) => {
  const [cornersA, cornersB] = [corners(a), corners(b)];
  return [a.angle, a.angle + Math.PI / 2, b.angle, b.angle + Math.PI / 2].every((angle) => {
    const axis = [Math.cos(angle), Math.sin(angle)];
    const project = (points: Point[]) => points.map(([x, y]) => x * axis[0] + y * axis[1]);
    const [pa, pb] = [project(cornersA), project(cornersB)];
    return Math.max(...pa) + gap > Math.min(...pb) && Math.max(...pb) + gap > Math.min(...pa);
  });
};

const hitsCircle = (box: Box, circle: Circle, gap = LABEL_GAP) => {
  const [cos, sin] = [Math.cos(box.angle), Math.sin(box.angle)];
  const [dx, dy] = [circle.x - box.x, circle.y - box.y];
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;
  const nearX = Math.max(-box.halfWidth, Math.min(box.halfWidth, localX));
  const nearY = Math.max(-box.halfHeight, Math.min(box.halfHeight, localY));
  return Math.hypot(localX - nearX, localY - nearY) < circle.radius + gap;
};

const textWidth = (text: string) => calculateWidthText(text, LABEL_FONT_SIZE);

/** The chip ECharts draws under a node name: centred below the symbol, as wide as the text up to the label width. */
const nodeLabelBox = (node: GraphNode): Box => {
  const radius = (node.symbolSize ?? NODE_SIZE_MIN) / 2;
  return {
    x: node.x!,
    y: node.y! + radius + LABEL_DISTANCE + LABEL_HEIGHT / 2,
    halfWidth: Math.min(textWidth(node.name), NODE_LABEL_WIDTH) / 2 + LABEL_PADDING[1],
    halfHeight: LABEL_HEIGHT / 2,
    angle: 0,
  };
};

const quadraticAt = (p0: Point, p1: Point, p2: Point, t: number): Point => [
  (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
  (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1],
];

/** The chip ECharts draws for an edge value: the edge is first cut where it enters the target symbol (for the arrow), then the label sits `distance` above the cut curve's midpoint, turned along it. */
const edgeLabelBox = (from: GraphNode, to: GraphNode, curveness: number, text: string): Box => {
  const p0: Point = [from.x!, from.y!];
  const p2: Point = [to.x!, to.y!];
  const p1: Point = [
    (p0[0] + p2[0]) / 2 - (p0[1] - p2[1]) * curveness,
    (p0[1] + p2[1]) / 2 - (p2[0] - p0[0]) * curveness,
  ];
  const radius = (to.symbolSize ?? NODE_SIZE_MIN) / 2;
  let [low, high] = [0, 1];
  for (let i = 0; i < 32; i++) {
    const mid = (low + high) / 2;
    const point = quadraticAt(p0, p1, p2, mid);
    if (Math.hypot(point[0] - p2[0], point[1] - p2[1]) > radius) low = mid;
    else high = mid;
  }
  const t = (low + high) / 2;
  const cutControl: Point = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
  const cutEnd = quadraticAt(p0, p1, p2, t);
  const middle = quadraticAt(p0, cutControl, cutEnd, 0.5);
  let angle = Math.atan2(cutEnd[1] - p0[1], cutEnd[0] - p0[0]);
  // ECharts flips right-to-left edges so text reads upright, which also moves the label to the other side.
  if (cutEnd[0] < p0[0]) angle += Math.PI;
  const lift = LABEL_DISTANCE + LABEL_HEIGHT / 2;
  return {
    x: middle[0] + Math.sin(angle) * lift,
    y: middle[1] - Math.cos(angle) * lift,
    halfWidth: textWidth(text) / 2 + LABEL_PADDING[1],
    halfHeight: LABEL_HEIGHT / 2,
    angle,
  };
};

/** Keeps a static label only on edges whose chip stays inside the panel and clear of every node, node name and label already kept, largest values first; the rest show on hover. */
export const fittingEdgeLabels = (
  edges: GraphEdge[],
  nodes: GraphNode[],
  curveness: number,
  format: (value: unknown) => string,
  panel: { width: number; height: number },
): boolean[] => {
  const byName = new Map(nodes.map((node) => [node.name, node]));
  const symbols: Circle[] = nodes.map((node) => ({
    x: node.x!,
    y: node.y!,
    radius: (node.symbolSize ?? NODE_SIZE_MIN) / 2,
  }));
  const taken: Box[] = nodes.map(nodeLabelBox);
  const fits = edges.map(() => false);
  const order = edges.map((_, index) => index).sort((a, b) => edges[b].value - edges[a].value);
  order.forEach((index) => {
    const edge = edges[index];
    const from = byName.get(edge.source);
    const to = byName.get(edge.target);
    if (!from || !to || edge.source === edge.target) return;
    const box = edgeLabelBox(from, to, curveness, format(edge.value));
    const inside = corners(box).every(
      ([x, y]) => x >= 0 && y >= 0 && x <= panel.width && y <= panel.height,
    );
    if (!inside || symbols.some((circle) => hitsCircle(box, circle))) return;
    if (taken.some((other) => overlap(box, other))) return;
    taken.push(box);
    fits[index] = true;
  });
  return fits;
};

/** Converts SQL source/target/value rows into a node graph with directed, weighted edges. */
export const convertNodeGraphData = (
  panelSchema: any,
  data: any,
  store: any,
  chartPanelRef?: any,
) => {
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
  const curveness = circular ? CURVENESS_CIRCULAR : CURVENESS_FORCE;
  const panel = {
    width: chartPanelRef?.value?.offsetWidth || FALLBACK_PANEL.width,
    height: chartPanelRef?.value?.offsetHeight || FALLBACK_PANEL.height,
  };
  // Pixel positions make the chart's view transform an identity, so edge labels render at their real size.
  const points = toPlot(circular ? ringByName(nodes) : forcePositions(nodes, edges), panel);
  nodes.forEach((node, index) => {
    [node.x, node.y] = points[index];
    // Only long names get a fixed width, so every other chip hugs its text.
    if (textWidth(node.name) > NODE_LABEL_WIDTH) {
      node.label = { width: NODE_LABEL_WIDTH, overflow: "truncate" };
    }
  });
  const showEdgeLabels = config.node_graph_show_edge_labels === true;
  // Labels sit on a chip of the panel surface so the edges crossing them do not cut through the text.
  const chip = {
    backgroundColor: echartsColor.modifyAlpha(
      chartColor("--color-surface-base"),
      LABEL_CHIP_OPACITY,
    ),
    padding: LABEL_PADDING,
    borderRadius: 3,
  };
  if (showEdgeLabels) {
    const fits = fittingEdgeLabels(edges, nodes, curveness, format, panel);
    edges.forEach((edge, index) => {
      edge.label = { show: fits[index] };
      edge.emphasis = { label: { show: true } };
    });
  }

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
        // Positions are computed here so the chart fits them inside the plot at any panel size.
        layout: "none",
        data: nodes,
        links: edges,
        ...PLOT_INSET,
        draggable: true,
        edgeSymbol: ["none", "arrow"],
        edgeSymbolSize: 8,
        label: {
          show: true,
          position: "bottom",
          color: chartColor("--color-text-body"),
          fontSize: 12,
          distance: LABEL_DISTANCE,
          ...chip,
        },
        lineStyle: { opacity: 0.55, curveness },
        edgeLabel: {
          show: showEdgeLabels,
          color: chartColor("--color-text-body"),
          fontSize: 12,
          distance: LABEL_DISTANCE,
          // Edge labels otherwise inherit the faded line opacity, which leaves the chip see-through.
          opacity: 1,
          ...chip,
          formatter: (params: any) => format(params?.value),
        },
        emphasis: {
          focus: "adjacency",
          lineStyle: { opacity: 0.9 },
          edgeLabel: { show: showEdgeLabels },
        },
      },
    ],
  };
  return { options, extras: { panelId: panelSchema?.id } };
};
