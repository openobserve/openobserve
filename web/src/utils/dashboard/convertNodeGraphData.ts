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

import type { DefaultLabelFormatterCallbackParams } from "echarts";
import { color as echartsColor } from "echarts/core";
import { chartColor } from "@/utils/chartTheme";
import { escapeHtml } from "@/utils/html";
import { formatLargeNumber } from "@/utils/formatters";
import { getDataValue } from "./aliasUtils";
import { calculateWidthText } from "./chartDimensionUtils";
import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";
import { paintByPalette } from "./categoryNodes";

export const NODE_GRAPH_LAYOUTS = ["force", "circular"] as const;
export const DEFAULT_NODE_GRAPH_LAYOUT: (typeof NODE_GRAPH_LAYOUTS)[number] = "force";
const NODE_SIZE_MIN = 14;
const NODE_SIZE_MAX = 40;
const EDGE_WIDTH_MIN = 1;
const EDGE_WIDTH_MAX = 6;
const NODE_LABEL_WIDTH = 96;
// eslint-disable-next-line local/no-hardcoded-px -- ECharts label fontSize is a plain canvas px value
const LABEL_FONT_SIZE = "12px";
const LABEL_PADDING: [number, number] = [2, 4];
// One 12px line plus a little slack over ECharts' glyph-based line height.
const LINE_HEIGHT = 14;
const LABEL_HEIGHT = LINE_HEIGHT + 2 * LABEL_PADDING[0];
// ECharts' default gap between a label and its symbol or edge.
const LABEL_DISTANCE = 5;
const LABEL_GAP = 2;
const LABEL_CHIP_OPACITY = 0.85;
const CURVENESS_FORCE = 0.12;
// Chords through the ring centre must bow apart, or their labels all compete for the centre.
const CURVENESS_CIRCULAR = 0.3;
/** Keeps the largest node, with a label of `lines` lines below it, inside the panel. */
const plotInset = (lines: number) => ({
  top: NODE_SIZE_MAX / 2 + 4,
  bottom: NODE_SIZE_MAX / 2 + LABEL_DISTANCE + lines * LINE_HEIGHT + 2 * LABEL_PADDING[0],
  left: NODE_LABEL_WIDTH / 2 + 8,
  right: NODE_LABEL_WIDTH / 2 + 8,
});
const FALLBACK_PANEL = { width: 800, height: 400 };
// A dashboard holds a handful of node graphs, so a few layouts cover every panel on screen.
const FORCE_LAYOUT_CACHE_SIZE = 16;
const SELF_MARK = "↻";

/** `self` holds a node's traffic to itself, which has no edge to draw. */
export interface GraphNode {
  name: string;
  value: number;
  self?: number;
  symbolSize?: number;
  itemStyle?: { color: string };
  label?: { show: boolean; position?: Side; width?: number; overflow?: "truncate" };
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
type Side = "bottom" | "top" | "right" | "left";

/** Nodes the user dropped elsewhere, by name, as fractions of the panel width and height. */
export type MovedNodes = Map<string, Point>;

type GraphOptions = { series?: Record<string, unknown>[] } & Record<string, unknown>;

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

/** Sums rows into one edge per source → target pair; self traffic stays on the node as `self`. */
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
  const self = new Map<string, number>();
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
    if (edge.source === edge.target) self.set(edge.source, edge.value);
  });
  const nodes = order.map((name) => {
    const node: GraphNode = { name, value: Math.max(incoming.get(name)!, outgoing.get(name)!) };
    if (self.has(name)) node.self = self.get(name);
    return node;
  });
  return { nodes, edges: [...edges.values()].filter((edge) => edge.source !== edge.target) };
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
  // A symmetric start would settle back into a ring and rows arrive unordered, so the seeded start uses the sorted names.
  const names = nodes.map((node) => node.name).sort();
  const random = seededRandom(hashNames(names));
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    xs[i] = random() - 0.5;
    ys[i] = random() - 0.5;
  }
  const index = new Map(names.map((name, i) => [name, i]));
  const links = edges
    .map((edge) => [index.get(edge.source)!, index.get(edge.target)!])
    .filter(([from, to]) => from !== to)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const k = Math.sqrt(1 / count);
  const k2 = k * k;
  // Each iteration is O(n²), so large graphs settle in fewer steps.
  const iterations = Math.max(20, Math.min(300, Math.round(3_000_000 / (count * count))));
  const shiftX = new Float64Array(count);
  const shiftY = new Float64Array(count);
  for (let step = 0; step < iterations; step++) {
    const temperature = 0.1 * (1 - step / iterations);
    shiftX.fill(0);
    shiftY.fill(0);
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const dx = xs[i] - xs[j];
        const dy = ys[i] - ys[j];
        const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
        const push = k2 / (distance * distance);
        shiftX[i] += dx * push;
        shiftY[i] += dy * push;
        shiftX[j] -= dx * push;
        shiftY[j] -= dy * push;
      }
    }
    for (const [from, to] of links) {
      const dx = xs[from] - xs[to];
      const dy = ys[from] - ys[to];
      const pull = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01) / k;
      shiftX[from] -= dx * pull;
      shiftY[from] -= dy * pull;
      shiftX[to] += dx * pull;
      shiftY[to] += dy * pull;
    }
    for (let i = 0; i < count; i++) {
      // Gravity keeps disconnected parts from drifting to the edges.
      const sx = shiftX[i] - xs[i] * k;
      const sy = shiftY[i] - ys[i] * k;
      const length = Math.max(Math.sqrt(sx * sx + sy * sy), 1e-9);
      const move = Math.min(length, temperature);
      xs[i] += (sx / length) * move;
      ys[i] += (sy / length) * move;
    }
  }
  return nodes.map((node) => {
    const i = index.get(node.name)!;
    return [xs[i], ys[i]];
  });
};

const forceLayouts = new Map<string, Map<string, Point>>();

/** Values and display options never move a node, so a layout is reused while names and links match. */
const cachedForcePositions = (nodes: GraphNode[], edges: GraphEdge[]): Point[] => {
  const key = [
    nodes
      .map((node) => JSON.stringify(node.name))
      .sort()
      .join(),
    edges
      .map((edge) => JSON.stringify([edge.source, edge.target]))
      .sort()
      .join(),
  ].join("|");
  let byName = forceLayouts.get(key);
  if (byName) {
    forceLayouts.delete(key);
  } else {
    const points = forcePositions(nodes, edges);
    byName = new Map(nodes.map((node, i) => [node.name, points[i]]));
  }
  forceLayouts.set(key, byName);
  if (forceLayouts.size > FORCE_LAYOUT_CACHE_SIZE) {
    forceLayouts.delete(forceLayouts.keys().next().value!);
  }
  return nodes.map((node) => byName.get(node.name)!);
};

type Inset = ReturnType<typeof plotInset>;
type Panel = { width: number; height: number };

const bounds = (positions: Point[]) => {
  const xs = positions.map(([x]) => x);
  const ys = positions.map(([, y]) => y);
  return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
};

/** Narrows the plot to the layout's own aspect ratio, centred, so a ring stays a circle in a wide or tall panel. */
const keepAspect = (positions: Point[], panel: Panel, inset: Inset): Inset => {
  const [minX, maxX, minY, maxY] = bounds(positions);
  const width = Math.max(panel.width - inset.left - inset.right, 1);
  const height = Math.max(panel.height - inset.top - inset.bottom, 1);
  if (!(maxX > minX && maxY > minY)) return inset;
  const fit = Math.min(width / (maxX - minX), height / (maxY - minY));
  const extraX = (width - (maxX - minX) * fit) / 2;
  const extraY = (height - (maxY - minY) * fit) / 2;
  return {
    top: inset.top + extraY,
    bottom: inset.bottom + extraY,
    left: inset.left + extraX,
    right: inset.right + extraX,
  };
};

/** Maps layout coordinates onto the inset plot the way the chart does, in pixels. */
const toPlot = (positions: Point[], panel: Panel, inset: Inset): Point[] => {
  const [minX, maxX, minY, maxY] = bounds(positions);
  const width = Math.max(panel.width - inset.left - inset.right, 1);
  const height = Math.max(panel.height - inset.top - inset.bottom, 1);
  // The chart stretches the nodes' bounding box onto the plot, so anything but a full fit would distort the symbols.
  return positions.map(([x, y]) => [
    inset.left + (maxX > minX ? ((x - minX) / (maxX - minX)) * width : width / 2),
    inset.top + (maxY > minY ? ((y - minY) / (maxY - minY)) * height : height / 2),
  ]);
};

/** Plot equals the nodes' bounding box, so each node draws at its own pixel position, unscaled. */
const insetAround = (positions: Point[], panel: Panel): Inset => {
  const [minX, maxX, minY, maxY] = bounds(positions);
  // ECharts widens a zero span by 1 on each side before fitting it, so the plot widens with it.
  const padX = maxX === minX ? 1 : 0;
  const padY = maxY === minY ? 1 : 0;
  return {
    top: minY - padY,
    bottom: panel.height - maxY - padY,
    left: minX - padX,
    right: panel.width - maxX - padX,
  };
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
  const reach = Math.hypot(a.halfWidth, a.halfHeight) + Math.hypot(b.halfWidth, b.halfHeight) + gap;
  if (Math.hypot(a.x - b.x, a.y - b.y) > reach) return false;
  if (a.angle === 0 && b.angle === 0) {
    return (
      Math.abs(a.x - b.x) < a.halfWidth + b.halfWidth + gap &&
      Math.abs(a.y - b.y) < a.halfHeight + b.halfHeight + gap
    );
  }
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

const insidePanel = (box: Box, panel: Panel) =>
  corners(box).every(([x, y]) => x >= 0 && y >= 0 && x <= panel.width && y <= panel.height);

const symbolOf = (node: GraphNode): Circle => ({
  x: node.x!,
  y: node.y!,
  radius: (node.symbolSize ?? NODE_SIZE_MIN) / 2,
});

const textWidth = (text: string) => calculateWidthText(text, LABEL_FONT_SIZE);

const SIDES: Side[] = ["bottom", "top", "right", "left"];

/** Mirrors ECharts' label chip box, so collisions are checked against what is actually drawn. */
const nodeLabelBox = (node: GraphNode, lines: string[], side: Side): Box => {
  const reach = (node.symbolSize ?? NODE_SIZE_MIN) / 2 + LABEL_DISTANCE;
  const halfHeight = (lines.length * LINE_HEIGHT) / 2 + LABEL_PADDING[0];
  const halfWidth =
    Math.max(...lines.map((line) => Math.min(textWidth(line), NODE_LABEL_WIDTH))) / 2 +
    LABEL_PADDING[1];
  const offset: Record<Side, Point> = {
    bottom: [0, reach + halfHeight],
    top: [0, -reach - halfHeight],
    right: [reach + halfWidth, 0],
    left: [-reach - halfWidth, 0],
  };
  const [dx, dy] = offset[side];
  return { x: node.x! + dx, y: node.y! + dy, halfWidth, halfHeight, angle: 0 };
};

/** On a ring the side facing away from the centre goes first, so names fan out from the chords. */
const outwardFirst = (node: GraphNode, centre: Point): Side[] => {
  const [dx, dy] = [node.x! - centre[0], node.y! - centre[1]];
  const out: Side =
    Math.abs(dy) >= Math.abs(dx) ? (dy < 0 ? "top" : "bottom") : dx < 0 ? "left" : "right";
  return [out, ...SIDES.filter((side) => side !== out)];
};

/** Indexes by larger value first, then by name, so the same graph always keeps the same labels. */
const indexesByValue = (items: { value: number }[], name: (index: number) => string) =>
  items
    .map((_, index) => index)
    .sort((a, b) => items[b].value - items[a].value || (name(a) < name(b) ? -1 : 1));

interface NodeLabel {
  box: Box;
  side: Side;
}

/** Larger nodes pick a clear side first; a name with no clear side shows on hover instead of overlapping. */
const placeNodeLabels = (
  nodes: GraphNode[],
  linesOf: (node: GraphNode) => string[],
  sidesOf: (node: GraphNode) => Side[],
  panel: Panel,
): (NodeLabel | null)[] => {
  const symbols = nodes.map(symbolOf);
  const placed: (NodeLabel | null)[] = nodes.map(() => null);
  const taken: Box[] = [];
  const fits = (box: Box, index: number) =>
    insidePanel(box, panel) &&
    !symbols.some((circle, other) => other !== index && hitsCircle(box, circle)) &&
    !taken.some((other) => overlap(box, other));
  indexesByValue(nodes, (index) => nodes[index].name).forEach((index) => {
    const lines = linesOf(nodes[index]);
    for (const side of sidesOf(nodes[index])) {
      const box = nodeLabelBox(nodes[index], lines, side);
      if (!fits(box, index)) continue;
      taken.push(box);
      placed[index] = { box, side };
      return;
    }
  });
  return placed;
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

/** Largest edges keep a static label first; one that would overlap or leave the panel shows on hover. */
export const fittingEdgeLabels = (
  edges: GraphEdge[],
  nodes: GraphNode[],
  curveness: number,
  format: (value: unknown) => string,
  panel: Panel,
  nodeLabels: Box[],
): boolean[] => {
  const byName = new Map(nodes.map((node) => [node.name, node]));
  const symbols = nodes.map(symbolOf);
  const taken = [...nodeLabels];
  const fits = edges.map(() => false);
  indexesByValue(edges, (index) => `${edges[index].source}\u0000${edges[index].target}`).forEach(
    (index) => {
      const edge = edges[index];
      const from = byName.get(edge.source);
      const to = byName.get(edge.target);
      if (!from || !to) return;
      const box = edgeLabelBox(from, to, curveness, format(edge.value));
      if (!insidePanel(box, panel) || symbols.some((circle) => hitsCircle(box, circle))) return;
      if (taken.some((other) => overlap(box, other))) return;
      taken.push(box);
      fits[index] = true;
    },
  );
  return fits;
};

/** Everything about a node graph but where its nodes are, so it can be redrawn with moved nodes. */
interface Scene {
  nodes: GraphNode[];
  edges: GraphEdge[];
  panel: Panel;
  plot: Inset;
  circular: boolean;
  curveness: number;
  showEdgeLabels: boolean;
  labelLines: (node: GraphNode) => string[];
  chipText: (value: unknown) => string;
}

const drawScene = (scene: Scene, points: Point[]) => {
  const nodes: GraphNode[] = scene.nodes.map((node, i) => ({
    ...node,
    x: points[i][0],
    y: points[i][1],
  }));
  const { plot, panel } = scene;
  const centre: Point = [
    plot.left + (panel.width - plot.left - plot.right) / 2,
    plot.top + (panel.height - plot.top - plot.bottom) / 2,
  ];
  const labels = placeNodeLabels(
    nodes,
    scene.labelLines,
    (node) => (scene.circular ? outwardFirst(node, centre) : SIDES),
    panel,
  );
  nodes.forEach((node, i) => {
    node.label = labels[i] ? { show: true, position: labels[i].side } : { show: false };
    // Only long names get a fixed width, so every other chip hugs its text.
    if (scene.labelLines(node).some((line) => textWidth(line) > NODE_LABEL_WIDTH)) {
      node.label = { ...node.label, width: NODE_LABEL_WIDTH, overflow: "truncate" };
    }
  });
  const edges: GraphEdge[] = scene.edges.map((edge) => ({ ...edge }));
  if (scene.showEdgeLabels) {
    const kept = labels.flatMap((label) => (label ? [label.box] : []));
    const fits = fittingEdgeLabels(edges, nodes, scene.curveness, scene.chipText, panel, kept);
    edges.forEach((edge, index) => {
      edge.label = { show: fits[index] };
      edge.emphasis = { label: { show: true } };
    });
  }
  return { nodes, edges, inset: insetAround(points, panel) };
};

const nodeGraphOptions = (
  scene: Scene,
  drawn: ReturnType<typeof drawScene>,
  format: (value: unknown) => string,
) => {
  // Labels sit on a chip of the panel surface so the edges crossing them do not cut through the text.
  const chip = {
    backgroundColor: echartsColor.modifyAlpha(
      chartColor("--color-surface-base"),
      LABEL_CHIP_OPACITY,
    ),
    padding: LABEL_PADDING,
    borderRadius: 3,
  };
  const line = (label: string, value: unknown) =>
    `${escapeHtml(label)}: <strong>${escapeHtml(format(value))}</strong>`;
  return {
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
        if (params?.dataType === "edge") {
          return line(
            `${params?.data?.source ?? ""} → ${params?.data?.target ?? ""}`,
            params?.value,
          );
        }
        const name = params?.name ?? "";
        const self = params?.data?.self;
        return self === undefined
          ? line(name, params?.value)
          : `${line(name, params?.value)}<br>${line(`${name} → ${name}`, self)}`;
      },
    },
    series: [
      {
        type: "graph",
        // Positions come from the converter's cached layouts, so ECharts' own layout stays off.
        layout: "none",
        data: drawn.nodes,
        links: drawn.edges,
        ...drawn.inset,
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
          formatter: (params: DefaultLabelFormatterCallbackParams) =>
            params?.data
              ? scene.labelLines(params.data as GraphNode).join("\n")
              : (params?.name ?? ""),
        },
        lineStyle: { opacity: 0.55, curveness: scene.curveness },
        edgeLabel: {
          show: scene.showEdgeLabels,
          color: chartColor("--color-text-body"),
          fontSize: 12,
          distance: LABEL_DISTANCE,
          // Edge labels otherwise inherit the faded line opacity, which leaves the chip see-through.
          opacity: 1,
          ...chip,
          formatter: (params: DefaultLabelFormatterCallbackParams) => scene.chipText(params?.value),
        },
        emphasis: {
          focus: "adjacency",
          label: { show: true },
          lineStyle: { opacity: 0.9 },
          edgeLabel: { show: scene.showEdgeLabels },
        },
      },
    ],
  };
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
  if (!nodes.length) return { options: { series: [] }, extras: { panelId: panelSchema?.id } };

  paintByPalette(nodes, config, store?.state?.theme);
  const maxNode = Math.max(...nodes.map((node) => node.value));
  const maxEdge = Math.max(0, ...edges.map((edge) => edge.value));
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
  const plainUnit = !config.unit || config.unit === "default";
  // Edge chips sit inside a small graph, so a unitless large value is shortened there; the tooltip keeps it in full.
  const chipText = (value: unknown) => {
    const numeric = Number(value);
    if (!plainUnit || !Number.isFinite(numeric) || Math.abs(numeric) < 1000) return format(value);
    return (numeric < 0 ? "-" : "") + formatLargeNumber(Math.abs(numeric));
  };
  const layoutName = config.node_graph_layout ?? DEFAULT_NODE_GRAPH_LAYOUT;
  const circular = layoutName === "circular";
  const panel = {
    width: chartPanelRef?.value?.offsetWidth || FALLBACK_PANEL.width,
    height: chartPanelRef?.value?.offsetHeight || FALLBACK_PANEL.height,
  };
  const showEdgeLabels = config.node_graph_show_edge_labels === true;
  // A self edge has no line to carry its value, so with edge values on it goes under the name.
  const labelLines = (node: GraphNode) =>
    showEdgeLabels && node.self !== undefined
      ? [node.name, `${SELF_MARK} ${chipText(node.self)}`]
      : [node.name];
  const inset = plotInset(Math.max(...nodes.map((node) => labelLines(node).length)));
  // Pixel positions make the chart's view transform an identity, so edge labels render at their real size.
  const layout = circular ? ringByName(nodes) : cachedForcePositions(nodes, edges);
  const plot = circular ? keepAspect(layout, panel, inset) : inset;
  const points = toPlot(layout, panel, plot);
  const scene: Scene = {
    nodes,
    edges,
    panel,
    plot,
    circular,
    curveness: circular ? CURVENESS_CIRCULAR : CURVENESS_FORCE,
    showEdgeLabels,
    labelLines,
    chipText,
  };
  // Only nodes, links and plot change, so whatever the renderer added to the options is kept.
  const placeNodes = (options: GraphOptions, moved: MovedNodes): GraphOptions => {
    const drawn = drawScene(
      scene,
      points.map((point, i) => {
        const fraction = moved.get(nodes[i].name);
        if (!fraction) return point;
        // A node dropped past the edge stays whole inside the panel, so it can be picked up again.
        const radius = (nodes[i].symbolSize ?? NODE_SIZE_MIN) / 2;
        const within = (at: number, size: number) => Math.min(Math.max(at, radius), size - radius);
        return [
          within(fraction[0] * panel.width, panel.width),
          within(fraction[1] * panel.height, panel.height),
        ] as Point;
      }),
    );
    const [series, ...rest] = options?.series ?? [];
    return {
      ...options,
      series: [{ ...series, data: drawn.nodes, links: drawn.edges, ...drawn.inset }, ...rest],
    };
  };
  return {
    options: nodeGraphOptions(scene, drawScene(scene, points), format),
    extras: { panelId: panelSchema?.id, nodeGraph: { layout: layoutName, placeNodes } },
  };
};
