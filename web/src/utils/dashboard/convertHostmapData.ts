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

import { gt } from "@/types/i18n";
import { format as echartsFormat } from "echarts/core";
import { chartColor } from "@/utils/chartTheme";
import { escapeHtml } from "@/utils/html";
import { addCommasToNumber } from "@/utils/formatters";
import { getCachedSemanticGroups } from "@/utils/semanticGroupsCache";
import { getDataValue } from "./aliasUtils";
import { getContrastColor } from "./chartColorUtils";
import { getSeriesColor, shadeColor } from "./colorPalette";
import { buildPromqlSeriesNames } from "./promql/shared/legendBuilder";
import { legendFallbackOf } from "./promql/formula";
import {
  buildValueMappingCache,
  formatNumericValue,
  lookupValueMappingFull,
} from "./tableConfigUtils";
import { normalizeThresholds, resolveStepValues, stepColorFor } from "./thresholds";
import { STATE_TIMELINE_ROW_ZOOM_IDS } from "./convertStateTimelineData";
import { BG_SWATCHES, TEXT_SWATCHES } from "@/composables/dashboard/useColumnFormatting";

/** Fallback for the server's max_dashboard_hostmap_cells. */
export const HOSTMAP_MAX_CELLS = 5000;
export const HOSTMAP_MAX_GROUP_LEVELS = 2;
export const HOSTMAP_REDUCTIONS = ["last", "avg", "min", "max"] as const;
/** A numeric Value field starts as its max, the reading a hot cell needs; a count says nothing per entity. */
export const HOSTMAP_NUMERIC_Y_FUNCTION = "max";
/** The colour scale a host map uses until the panel picks one by value. */
export const HOSTMAP_DEFAULT_COLOR = {
  mode: "continuous-green-yellow-red",
  fixedColor: ["green", "yellow", "red"],
  seriesBy: "last",
};
/** The smallest cell drawn; below it inner group frames drop, then the overflow is counted in a notice. */
export const HOSTMAP_MIN_CELL = 10;
export const HOSTMAP_MAX_CELL = 56;
const TOOLTIP_MAX_LABELS = 12;
const GAP_RATIO = 0.12;
const FRAME_PAD = 4;
const TITLE_HEIGHT = 16;
const BLOCK_GAP = 6;
// Keeps group frames off the panel edges.
const EDGE_PAD = 4;
const SIZE_TIE = 0.5;
const LEGEND_ROOM = 32;
const TOP_PAD = 2;
const MIN_LABEL_CELL = 26;
const SEARCH_STEPS = 18;
const CONTRAST_THRESHOLD = 0.5;
const SQRT3 = Math.sqrt(3);
const HEX_HEIGHT = 2 / SQRT3;
const HEX_ROW_PITCH = SQRT3 / 2;
const GROUP_SEPARATOR = " › ";
// Average glyph advance of the chart font as a share of its size, to fit text without a canvas.
const CHAR_WIDTH = 0.6;
const TITLE_FONT_SIZES = [11, 10, 9];
const CELL_FONT_SIZES = [11, 10, 9, 8];
const SWATCH = 8;
const SCROLLBAR_ROOM = 16;
const SWATCH_GAP = 4;
// Room for a group's swatch and the first few characters of its name.
const MIN_FRAME_WIDTH = FRAME_PAD * 2 + 2 + SWATCH + SWATCH_GAP + 40;
// These units print the raw number, so the colour is picked from the number as shown.
const RAW_DISPLAY_UNITS = new Set(["", "default", "custom", "percent"]);
// No whitespace, so a group path can sit in a drilldown URL.
const DRILLDOWN_GROUP_SEPARATOR = "/";
// Metric stream columns that are not series labels.
const HOSTMAP_NON_LABEL_FIELDS = new Set(["_timestamp", "value"]);

export type HostmapReduction = (typeof HOSTMAP_REDUCTIONS)[number];
export type HostmapSort = "name" | "value";
export type HostmapShape = "square" | "hexagon";
export type HostmapCellLabel = "none" | "name" | "value";

export interface HostmapEntity {
  name: string;
  groups: string[];
  value: number | null;
  /** The latest non-numeric value when no sample is a number, such as a status string. */
  text?: string;
  labels: Record<string, string>;
  /** How many cells share this name inside the same group. */
  duplicates?: number;
}

export interface HostmapGroup {
  name: string;
  path: string[];
  worst: number | null;
  children: HostmapGroup[];
  cells: HostmapEntity[];
}

export interface HostmapCellBox {
  x: number;
  y: number;
  size: number;
}

export interface HostmapFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  path: string[];
  worst: number | null;
  depth: number;
}

export interface HostmapLayout {
  cellSize: number;
  cells: HostmapCellBox[];
  frames: HostmapFrame[];
  /** Height of everything laid out; above the box height the panel scrolls. */
  contentHeight: number;
  /** Even the smallest readable cells do not fit the box height. */
  overflows: boolean;
}

interface Measured {
  node: HostmapGroup;
  width: number;
  height: number;
  pad: number;
  title: number;
  cols: number;
  rows: number;
  children: { measured: Measured; dx: number; dy: number }[];
}

/** Natural order, so gpu2 sorts before gpu10. */
export const naturalCompare = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** A finite number from a cell value or a PromQL sample string; anything else is no data. */
export const toHostmapNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const reduceHostmapValues = (
  values: (number | null)[],
  reduction: HostmapReduction,
): number | null => {
  const numbers = values.filter((value): value is number => value !== null);
  if (!numbers.length) return null;
  switch (reduction) {
    case "avg":
      return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
    case "min":
      return numbers.reduce((min, value) => Math.min(min, value), Infinity);
    case "max":
      return numbers.reduce((max, value) => Math.max(max, value), -Infinity);
    default:
      return numbers[numbers.length - 1];
  }
};

/** The column a builder field reads; builder aliases are only x_axis_1 or breakdown_1. */
export const hostmapFieldColumn = (field: any): string =>
  field?.column || field?.args?.[0]?.value?.field || field?.alias;

const reductionOf = (config: any): HostmapReduction =>
  HOSTMAP_REDUCTIONS.includes(config?.hostmap_reduction) ? config.hostmap_reduction : "last";

const decimalsOf = (config: any): number => {
  const decimals = config?.decimals;
  if (decimals === null || decimals === undefined || decimals === "") return 2;
  const number = Number(decimals);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : 2;
};

const sortOf = (value: unknown): HostmapSort => (value === "value" ? "value" : "name");

const promqlGroupLabels = (config: any): string[] =>
  (Array.isArray(config?.hostmap_group_by) ? config.hostmap_group_by : [])
    .map((label: unknown) => (typeof label === "string" ? label.trim() : ""))
    .filter(Boolean)
    .slice(0, HOSTMAP_MAX_GROUP_LEVELS);

const toEpochMs = (value: unknown): number => {
  if (typeof value === "number") return value > 1e14 ? value / 1000 : value;
  if (typeof value === "string" && value !== "") {
    const parsed = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
};

/** One entity per PromQL series; its labels name it and group it. */
export const promqlHostmapEntities = (
  panelSchema: any,
  data: any[],
  metadata: any,
  store: any,
): HostmapEntity[] => {
  const config = panelSchema?.config ?? {};
  const reduction = reductionOf(config);
  const entityLabel =
    typeof config.hostmap_entity_label === "string" ? config.hostmap_entity_label.trim() : "";
  const groupLabels = promqlGroupLabels(config);
  // A time-shifted window is not an entity of its own.
  const primaries = (Array.isArray(data) ? data : [])
    .map((entry, index) => ({ entry, index }))
    .filter(({ index }) => !metadata?.queries?.[index]?.timeRangeGap?.seconds);
  const queryIndexOf = (index: number) => metadata?.queries?.[index]?.panelQueryIndex ?? index;
  const names = buildPromqlSeriesNames(
    primaries.map(({ entry, index }) => ({
      metrics: (entry?.result ?? []).map((m: any) => m?.metric).filter(Boolean),
      template: panelSchema.queries?.[queryIndexOf(index)]?.config?.promql_legend,
      fallback: legendFallbackOf(panelSchema.queries, queryIndexOf(index)),
      expr: panelSchema.queries?.[queryIndexOf(index)]?.query,
    })),
    getCachedSemanticGroups(store?.state?.selectedOrganization?.identifier ?? "") ?? [],
  );
  const entities: HostmapEntity[] = [];
  primaries.forEach(({ entry }) => {
    (entry?.result ?? []).forEach((series: any) => {
      const samples = series?.values ?? (series?.value ? [series.value] : []);
      const labels: Record<string, string> = {};
      Object.entries(series?.metric ?? {}).forEach(([key, value]) => {
        labels[key] = String(value);
      });
      const named = entityLabel ? labels[entityLabel] : undefined;
      entities.push({
        name: named ?? names.get(series?.metric) ?? "",
        groups: groupLabels.map((label) => labels[label] ?? ""),
        value: reduceHostmapValues(
          samples.map((sample: any) => toHostmapNumber(sample?.[1])),
          reduction,
        ),
        labels,
      });
    });
  });
  return entities;
};

/** One entity per entity and group in each SQL query; rows sharing them are its samples, reduced. */
export const sqlHostmapEntities = (panelSchema: any, data: any[], store: any): HostmapEntity[] => {
  const reduction = reductionOf(panelSchema?.config);
  const timestampColumn = store?.state?.zoConfig?.timestamp_column || "_timestamp";
  const series = new Map<
    string,
    {
      entity: HostmapEntity;
      samples: { t: number; value: number | null; text: string | null }[];
    }
  >();
  (panelSchema?.queries ?? []).forEach((query: any, index: number) => {
    const x = query?.fields?.x?.[0];
    const y = query?.fields?.y?.[0];
    if (!x || !y || !Array.isArray(data?.[index])) return;
    const groupFields = (query.fields.breakdown ?? []).slice(0, HOSTMAP_MAX_GROUP_LEVELS);
    const read = new Set<string>([
      x.alias,
      ...groupFields.map((field: any) => field.alias),
      ...(query.fields.y ?? []).map((field: any) => field.alias),
    ]);
    data[index].forEach((row: any, rowIndex: number) => {
      const name = String(getDataValue(row, x.alias) ?? "");
      const groups = groupFields.map((field: any) => String(getDataValue(row, field.alias) ?? ""));
      const labels: Record<string, string> = { [hostmapFieldColumn(x)]: name };
      groupFields.forEach((field: any, level: number) => {
        labels[hostmapFieldColumn(field)] = groups[level];
      });
      Object.entries(row ?? {}).forEach(([key, value]) => {
        if (read.has(key) || key === timestampColumn) return;
        if (value === null || value === undefined || typeof value === "object") return;
        labels[key] = String(value);
      });
      const key = JSON.stringify([index, groups, name]);
      if (!series.has(key)) {
        series.set(key, { entity: { name, groups, value: null, labels }, samples: [] });
      }
      const target = series.get(key)!;
      target.entity.labels = labels;
      const time = toEpochMs(row?.[timestampColumn]);
      const raw = getDataValue(row, y.alias);
      const value = toHostmapNumber(raw);
      target.samples.push({
        t: Number.isFinite(time) ? time : rowIndex,
        value,
        text:
          value === null && raw !== null && raw !== undefined && raw !== "" ? String(raw) : null,
      });
    });
  });
  return [...series.values()].map(({ entity, samples }) => {
    const ordered = [...samples].sort((a, b) => a.t - b.t);
    const value = reduceHostmapValues(
      ordered.map((sample) => sample.value),
      reduction,
    );
    const text = value === null ? ordered.findLast((sample) => sample.text !== null)?.text : null;
    return text ? { ...entity, value, text } : { ...entity, value };
  });
};

/** Drops group levels that are empty on every entity, such as a breakdown the query no longer returns. */
export const dropEmptyGroupLevels = (entities: HostmapEntity[]): HostmapEntity[] => {
  const depth = entities.reduce((most, entity) => Math.max(most, entity.groups.length), 0);
  const kept = Array.from({ length: depth }, (_, level) => level).filter((level) =>
    entities.some((entity) => (entity.groups[level] ?? "") !== ""),
  );
  if (kept.length === depth) return entities;
  return entities.map((entity) => ({
    ...entity,
    groups: kept.map((level) => entity.groups[level] ?? ""),
  }));
};

/** Cuts the middle out of a name, keeping its distinguishing tail: a-node05 becomes a-…e05. */
export const middleTruncate = (text: string, max: number): string => {
  if (text.length <= max) return text;
  if (max <= 1) return max === 1 ? "…" : "";
  const tail = Math.ceil((max - 1) * 0.6);
  return `${text.slice(0, max - 1 - tail)}…${text.slice(text.length - tail)}`;
};

/** The text and font size that fit a width: a smaller font first, then a middle cut. */
export const fitHostmapLabel = (
  text: string,
  width: number,
  sizes: number[] = TITLE_FONT_SIZES,
): { text: string; fontSize: number } => {
  for (const fontSize of sizes) {
    if (text.length * fontSize * CHAR_WIDTH <= width) return { text, fontSize };
  }
  const fontSize = sizes[sizes.length - 1];
  return { text: middleTruncate(text, Math.floor(width / (fontSize * CHAR_WIDTH))), fontSize };
};

/** Counts the cells that share a name inside one group, so a tooltip can say so. */
export const markHostmapDuplicates = (entities: HostmapEntity[]): HostmapEntity[] => {
  const counts = new Map<string, number>();
  const keyOf = (entity: HostmapEntity) => JSON.stringify([entity.groups, entity.name]);
  entities.forEach((entity) => counts.set(keyOf(entity), (counts.get(keyOf(entity)) ?? 0) + 1));
  return entities.map((entity) => {
    const count = counts.get(keyOf(entity)) ?? 1;
    return count > 1 ? { ...entity, duplicates: count } : entity;
  });
};

const maxValue = (values: (number | null)[]) =>
  values.reduce<number | null>(
    (max, value) => (value === null ? max : max === null ? value : Math.max(max, value)),
    null,
  );

/** Highest value first, no data last, then by name. */
const byValue = <T extends { name: string }>(valueOf: (item: T) => number | null) => {
  return (a: T, b: T) => {
    const va = valueOf(a);
    const vb = valueOf(b);
    if (va !== vb) {
      if (va === null) return 1;
      if (vb === null) return -1;
      return vb - va;
    }
    return naturalCompare(a.name, b.name);
  };
};

/** Nests entities into up to two group levels, each level and its cells in the chosen order. */
export const buildHostmapTree = (
  entities: HostmapEntity[],
  levels: number,
  groupSort: HostmapSort,
  cellSort: HostmapSort,
): HostmapGroup => {
  const build = (items: HostmapEntity[], depth: number, path: string[]): HostmapGroup => {
    const name = path[path.length - 1] ?? "";
    if (depth >= levels) {
      const cells = [...items].sort(
        cellSort === "value"
          ? byValue<HostmapEntity>((cell) => cell.value)
          : (a, b) => naturalCompare(a.name, b.name),
      );
      return { name, path, worst: maxValue(cells.map((c) => c.value)), children: [], cells };
    }
    const byGroup = new Map<string, HostmapEntity[]>();
    items.forEach((item) => {
      const group = item.groups[depth] ?? "";
      if (!byGroup.has(group)) byGroup.set(group, []);
      byGroup.get(group)!.push(item);
    });
    const children = [...byGroup.entries()]
      .map(([group, members]) => build(members, depth + 1, [...path, group]))
      .sort(
        groupSort === "value"
          ? byValue<HostmapGroup>((group) => group.worst)
          : (a, b) => naturalCompare(a.name, b.name),
      );
    return {
      name,
      path,
      worst: maxValue(children.map((child) => child.worst)),
      children,
      cells: [],
    };
  };
  return build(entities, 0, []);
};

/** The cells of a tree in display order. */
export const flattenHostmapTree = (root: HostmapGroup): HostmapEntity[] =>
  root.children.length ? root.children.flatMap(flattenHostmapTree) : root.cells;

/** The tree with only its first `cap` cells in display order; emptied groups drop out. */
export const capHostmapTree = (root: HostmapGroup, cap: number): HostmapGroup => {
  let left = cap;
  const walk = (node: HostmapGroup): HostmapGroup | null => {
    if (left <= 0) return null;
    if (!node.children.length) {
      const cells = node.cells.slice(0, left);
      left -= cells.length;
      return cells.length ? { ...node, cells } : null;
    }
    const children = node.children.map(walk).filter((child): child is HostmapGroup => !!child);
    return children.length ? { ...node, children } : null;
  };
  return walk(root) ?? { ...root, children: [], cells: [] };
};

const gridHeight = (rows: number, size: number, hex: boolean) =>
  hex ? (rows - 1) * size * HEX_ROW_PITCH + size * HEX_HEIGHT : rows * size;

/** Lays a node out for one plan: plan[depth] is how many child blocks a group puts per row, the last entry is the cell columns of a leaf group. */
const measure = (
  node: HostmapGroup,
  size: number,
  hex: boolean,
  depth: number,
  plan: number[],
): Measured => {
  const pad = depth === 0 ? 0 : FRAME_PAD;
  const title = depth === 0 ? 0 : TITLE_HEIGHT;
  if (!node.children.length) {
    const count = node.cells.length;
    const cols = Math.max(1, Math.min(count, plan[plan.length - 1]));
    const rows = Math.max(1, Math.ceil(count / cols));
    // Offset hexagon rows stick out by half a cell.
    const width = cols * size + (hex && rows > 1 ? size / 2 : 0);
    return {
      node,
      width: Math.max(width + pad * 2, depth === 0 ? 0 : MIN_FRAME_WIDTH),
      height: gridHeight(rows, size, hex) + pad * 2 + title,
      pad,
      title,
      cols,
      rows,
      children: [],
    };
  }
  const measuredChildren = node.children.map((child) => measure(child, size, hex, depth + 1, plan));
  const perRow = Math.max(1, Math.min(measuredChildren.length, plan[depth]));
  // Siblings share column widths and row heights, so blocks line up in a grid instead of a ragged flow.
  const colWidths = Array.from({ length: perRow }, () => 0);
  const rowHeights: number[] = [];
  measuredChildren.forEach((child, index) => {
    const col = index % perRow;
    const row = Math.floor(index / perRow);
    colWidths[col] = Math.max(colWidths[col], child.width);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, child.height);
  });
  const colX = colWidths.map((_, col) =>
    colWidths.slice(0, col).reduce((sum, width) => sum + width + BLOCK_GAP, 0),
  );
  const rowY = rowHeights.map((_, row) =>
    rowHeights.slice(0, row).reduce((sum, height) => sum + height + BLOCK_GAP, 0),
  );
  const children = measuredChildren.map((measured, index) => ({
    measured,
    dx: colX[index % perRow],
    dy: rowY[Math.floor(index / perRow)],
  }));
  const gaps = (n: number) => Math.max(0, n - 1) * BLOCK_GAP;
  return {
    node,
    width: Math.max(
      colWidths.reduce((a, b) => a + b, 0) + gaps(perRow) + pad * 2,
      depth === 0 ? 0 : MIN_FRAME_WIDTH,
    ),
    height: rowHeights.reduce((a, b) => a + b, 0) + gaps(rowHeights.length) + pad * 2 + title,
    pad,
    title,
    cols: 0,
    rows: 0,
    children,
  };
};

const place = (
  measured: Measured,
  x: number,
  y: number,
  size: number,
  hex: boolean,
  depth: number,
  out: HostmapLayout,
) => {
  if (depth > 0) {
    out.frames.push({
      x,
      y,
      width: measured.width,
      height: measured.height,
      title: measured.node.name,
      path: measured.node.path,
      worst: measured.node.worst,
      depth,
    });
  }
  const left = x + measured.pad;
  const top = y + measured.pad + measured.title;
  if (!measured.children.length) {
    measured.node.cells.forEach((_, index) => {
      const row = Math.floor(index / measured.cols);
      const col = index % measured.cols;
      out.cells.push({
        x: left + col * size + (hex && row % 2 ? size / 2 : 0),
        y: top + (hex ? row * size * HEX_ROW_PITCH : row * size),
        size,
      });
    });
    return;
  }
  measured.children.forEach(({ measured: child, dx, dy }) =>
    place(child, left + dx, top + dy, size, hex, depth + 1, out),
  );
};

/** Per-row counts worth trying for n items: one per distinct row count, so 64 items try 64, 32, 22, 16… */
const perRowCandidates = (n: number): number[] => {
  const counts = new Set<number>();
  for (let rows = 1; rows <= n; rows++) counts.add(Math.ceil(n / rows));
  return [...counts];
};

/** Every plan for the tree: one per-row candidate per group level plus the leaf cell columns. */
const layoutPlans = (root: HostmapGroup): number[][] => {
  const widest: number[] = [];
  const walk = (node: HostmapGroup, depth: number) => {
    const n = node.children.length || node.cells.length;
    widest[depth] = Math.max(widest[depth] ?? 1, n);
    node.children.forEach((child) => walk(child, depth + 1));
  };
  walk(root, 0);
  return widest.reduce<number[][]>(
    (plans, n) => plans.flatMap((plan) => perRowCandidates(n).map((k) => [...plan, k])),
    [[]],
  );
};

/** The largest cell size from the readable minimum up at which a plan fits the box, or null when even that overflows. */
const largestSizeFor = (
  root: HostmapGroup,
  plan: number[],
  width: number,
  height: number,
  hex: boolean,
  floor = HOSTMAP_MIN_CELL,
) => {
  const fits = (size: number) => {
    const measured = measure(root, size, hex, 0, plan);
    return measured.width <= width && measured.height <= height ? measured : null;
  };
  const biggest = fits(HOSTMAP_MAX_CELL);
  if (biggest) return { measured: biggest, size: HOSTMAP_MAX_CELL };
  let best = fits(floor);
  if (!best) return null;
  let low = floor;
  let high = HOSTMAP_MAX_CELL;
  for (let step = 0; step < SEARCH_STEPS; step++) {
    const mid = (low + high) / 2;
    const measured = fits(mid);
    if (measured) {
      best = measured;
      low = mid;
    } else {
      high = mid;
    }
  }
  return { measured: best, size: low };
};

/** The plan with the biggest cells; near-equal sizes prefer the one that leaves the least empty box. */
const bestFit = (root: HostmapGroup, width: number, height: number, hex: boolean) => {
  let best: { measured: Measured; size: number } | null = null;
  for (const plan of layoutPlans(root)) {
    // A plan that cannot reach the current best size is skipped after one measure.
    const floor = best ? Math.max(HOSTMAP_MIN_CELL, best.size - SIZE_TIE) : HOSTMAP_MIN_CELL;
    const fit = largestSizeFor(root, plan, width, height, hex, floor);
    if (!fit) continue;
    const area = (m: Measured) => m.width * m.height;
    if (
      !best ||
      fit.size > best.size + SIZE_TIE ||
      (fit.size > best.size - SIZE_TIE && area(fit.measured) < area(best.measured))
    ) {
      best = fit;
    }
  }
  return best;
};

/** When nothing fits at the readable minimum: the plan that fits the width and scrolls the least. */
const scrollingFit = (root: HostmapGroup, width: number, hex: boolean) => {
  let best: Measured | null = null;
  let fallback: Measured | null = null;
  for (const plan of layoutPlans(root)) {
    const measured = measure(root, HOSTMAP_MIN_CELL, hex, 0, plan);
    if (!fallback || measured.width < fallback.width) fallback = measured;
    if (measured.width <= width && (!best || measured.height < best.height)) best = measured;
  }
  return (best ?? fallback)!;
};

/** Positions every cell and group frame in a width by height box at the largest readable cell size that fits; every group level keeps its frame, so a crowded map grows taller instead. */
export const layoutHostmap = (
  root: HostmapGroup,
  width: number,
  height: number,
  shape: HostmapShape,
): HostmapLayout => {
  const hex = shape === "hexagon";
  const inset = EDGE_PAD;
  const innerWidth = Math.max(0, width - inset * 2);
  const innerHeight = Math.max(0, height - inset * 2);
  const fit = bestFit(root, innerWidth, innerHeight, hex);
  const measured = fit?.measured ?? scrollingFit(root, innerWidth, hex);
  const size = fit?.size ?? HOSTMAP_MIN_CELL;
  const layout: HostmapLayout = {
    cellSize: size,
    cells: [],
    frames: [],
    contentHeight: measured.height + inset * 2,
    overflows: !fit,
  };
  const left = inset + Math.max(0, (innerWidth - measured.width) / 2);
  place(measured, left, inset, size, hex, 0, layout);
  return layout;
};

/** A mapping's cell fill: the table's pale background swatches paint as their full-strength text swatch, and a text colour alone fills the cell. */
export const hostmapMappingFill = (mapping: any): string | null => {
  const background = typeof mapping?.color === "string" ? mapping.color : "";
  if (background) {
    const swatch = BG_SWATCHES.indexOf(background.toLowerCase());
    return swatch >= 0 ? TEXT_SWATCHES[swatch] : background;
  }
  return mapping?.textColor || null;
};

/** Resolves a cell's colour: a value mapping first, then a threshold step, then the colour scale. */
const buildColorResolver = (config: any, values: number[], theme: string) => {
  const mappingCache = buildValueMappingCache(config?.mappings);
  const min = values.length ? Math.min(...values) : 0;
  const rawMax = values.length ? Math.max(...values) : 1;
  // A flat fleet still needs a non-empty domain to pick a colour from.
  const max = rawMax === min ? min + 1 : rawMax;
  const normalized = normalizeThresholds(config?.thresholds);
  const thresholds = normalized ? resolveStepValues(normalized, { min, max: rawMax }) : null;
  const mode = config?.color?.mode;
  const colorCfg =
    !mode || mode === "palette-classic"
      ? HOSTMAP_DEFAULT_COLOR
      : {
          ...config.color,
          fixedColor: config.color.fixedColor?.length
            ? config.color.fixedColor
            : mode.startsWith("continuous")
              ? HOSTMAP_DEFAULT_COLOR.fixedColor
              : config.color.fixedColor,
        };
  const decimals = decimalsOf(config);
  // A reduced value such as 2.0000001 still matches a mapping written as the shown "2".
  const mappingOf = (value: number) =>
    lookupValueMappingFull(value, mappingCache) ??
    (mappingCache
      ? lookupValueMappingFull(String(Number(value.toFixed(decimals))), mappingCache)
      : null);
  const scaleColor = (value: number, name: string) =>
    getSeriesColor(colorCfg as any, name, [value], min, max, theme) ??
    chartColor("--color-text-secondary");
  const roundsToShown = RAW_DISPLAY_UNITS.has(config?.unit ?? "");
  /** Fill and mapping of a value; a number is judged as shown, so a cell reading 85 never takes the band below 85. */
  const styleOf = (value: number | null, text: string | undefined, name: string) => {
    if (value === null) {
      const mapping = text === undefined ? null : lookupValueMappingFull(text, mappingCache);
      return { fill: hostmapMappingFill(mapping), mapping };
    }
    const shown = roundsToShown ? Number(value.toFixed(decimals)) : value;
    const mapping = mappingOf(shown);
    const fill =
      hostmapMappingFill(mapping) ||
      (thresholds ? stepColorFor(shown, thresholds, null) : null) ||
      scaleColor(shown, name);
    return { fill: fill as string, mapping };
  };
  return {
    min,
    max: rawMax,
    colorCfg,
    thresholds,
    styleOf,
  };
};

const legendEntries = (config: any, thresholds: any, format: (value: number) => string) => {
  const entries: { name: string; color: string }[] = [];
  (Array.isArray(config?.mappings) ? config.mappings : []).forEach((mapping: any) => {
    const color = hostmapMappingFill(mapping);
    if (!color) return;
    const range =
      mapping.from !== undefined && mapping.from !== "" && mapping.to !== undefined
        ? `${mapping.from}–${mapping.to}`
        : "";
    const name = mapping.text || mapping.pattern || range || mapping.value;
    if (name === undefined || name === null || name === "") return;
    entries.push({ name: String(name), color });
  });
  if (thresholds) {
    if (thresholds.baseColor && thresholds.steps.length) {
      entries.push({
        name: gt("dashboard.utils.hostmapBelow", { value: format(thresholds.steps[0].value) }),
        color: thresholds.baseColor,
      });
    }
    thresholds.steps.forEach((step: any) =>
      entries.push({
        name: gt("dashboard.utils.hostmapAtLeast", { value: format(step.value) }),
        color: step.color,
      }),
    );
  }
  // The legend keys entries by name, so a repeated name gets an invisible suffix.
  const used = new Set<string>();
  return entries.map((entry) => {
    let name = entry.name;
    while (used.has(name)) name += "​";
    used.add(name);
    return { ...entry, name };
  });
};

/** Colours of the continuous scale legend, or null when the scale has no value order. */
const scaleStops = (colorCfg: any, min: number, max: number): string[] | null => {
  const mode = colorCfg?.mode ?? "";
  if (mode.startsWith("continuous")) return colorCfg.fixedColor;
  if (mode === "shades") {
    const base = colorCfg.fixedColor?.[0] ?? "#53ca53";
    const stops = [shadeColor(base, min, min, max), shadeColor(base, max, min, max)];
    return stops.every(Boolean) ? (stops as string[]) : null;
  }
  return null;
};

const hexagonPoints = (cx: number, cy: number, radius: number) =>
  Array.from({ length: 6 }, (_, corner) => {
    const angle = (Math.PI / 180) * (60 * corner - 90);
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  });

/** Drilldown variables for a clicked cell: its name, value, group path and labels. */
export const hostmapDrilldownSeries = (params: any) => ({
  __name: params?.data?.name ?? "",
  __value: params?.data?.cellValue ?? "",
  __group: (params?.data?.groups ?? []).join(DRILLDOWN_GROUP_SEPARATOR),
  labels: params?.data?.labels ?? {},
});

/** The labels a panel's cells are known to carry, offered as drilldown variables. */
export const hostmapLabelNames = (panel: any): string[] => {
  if (panel?.queryType === "promql") {
    const entity = panel?.config?.hostmap_entity_label;
    const named = typeof entity === "string" && entity.trim() ? [entity.trim()] : [];
    return [...new Set([...named, ...promqlGroupLabels(panel?.config)])];
  }
  const query = panel?.queries?.[0];
  return [
    ...new Set(
      [
        ...(query?.fields?.x ?? []).slice(0, 1),
        ...(query?.fields?.breakdown ?? []).slice(0, HOSTMAP_MAX_GROUP_LEVELS),
      ]
        .map(hostmapFieldColumn)
        .filter(Boolean),
    ),
  ];
};

/** Label names to suggest for a PromQL host map: labels a `by (...)` clause keeps come first, then the stream's other labels. */
export const hostmapLabelSuggestions = (query: string, streamFields: string[]): string[] => {
  const kept = [...(query ?? "").matchAll(/\bby\s*\(([^)]*)\)/g)].flatMap((match) =>
    match[1].split(",").map((label) => label.trim()),
  );
  const labels = streamFields.filter(
    (name) => name && !name.startsWith("__") && !HOSTMAP_NON_LABEL_FIELDS.has(name),
  );
  return [...new Set([...kept.filter(Boolean), ...labels])];
};

/** The column a logs drilldown filters on: the entity field of the first query. */
export const hostmapEntityColumn = (panelSchema: any): string | undefined => {
  if (panelSchema?.queryType === "promql") {
    const label = panelSchema?.config?.hostmap_entity_label;
    return typeof label === "string" && label.trim() ? label.trim() : undefined;
  }
  const x = panelSchema?.queries?.[0]?.fields?.x?.[0];
  return x ? hostmapFieldColumn(x) : undefined;
};

const capNotice = (shown: number, total: number) =>
  total > shown
    ? gt("dashboard.utils.hostmapCellCap", {
        shown: addCommasToNumber(shown),
        total: addCommasToNumber(total),
      })
    : "";

/** Converts SQL rows or PromQL series into a host map: one coloured cell per entity, framed by group. */
export const convertHostmapData = (
  panelSchema: any,
  data: any,
  store: any,
  metadata?: any,
  chartPanelRef?: any,
) => {
  if (!Array.isArray(data) || !panelSchema) return { options: null };
  const config = panelSchema.config ?? {};
  const isPromQL = panelSchema.queryType === "promql";
  const entities = markHostmapDuplicates(
    dropEmptyGroupLevels(
      isPromQL
        ? promqlHostmapEntities(panelSchema, data, metadata, store)
        : sqlHostmapEntities(panelSchema, data, store),
    ),
  );
  // The renderer reads an empty series list as "No Data", as it does for line panels.
  if (!entities.length) return { options: { series: [] }, extras: { panelId: panelSchema.id } };

  const levels = Math.min(
    HOSTMAP_MAX_GROUP_LEVELS,
    entities.reduce((most, entity) => Math.max(most, entity.groups.length), 0),
  );
  const cap = Math.max(
    1,
    Number(store?.state?.zoConfig?.max_dashboard_hostmap_cells) || HOSTMAP_MAX_CELLS,
  );
  const fullTree = buildHostmapTree(
    entities,
    levels,
    sortOf(config.hostmap_group_sort),
    sortOf(config.hostmap_cell_sort),
  );
  const tree = entities.length > cap ? capHostmapTree(fullTree, cap) : fullTree;
  const cells = flattenHostmapTree(tree);

  const shape: HostmapShape = config.hostmap_cell_shape === "hexagon" ? "hexagon" : "square";
  const cellLabel: HostmapCellLabel = ["name", "value"].includes(config.hostmap_cell_label)
    ? config.hostmap_cell_label
    : "none";
  const showLegend = config.show_legends !== false;
  const decimals = decimalsOf(config);
  const noValue =
    config.no_value_replacement !== undefined && config.no_value_replacement !== ""
      ? String(config.no_value_replacement)
      : gt("dashboard.utils.hostmapNoData");
  const format = (value: number) =>
    formatNumericValue(value, null, config.unit, config.unit_custom, decimals);

  const numbers = cells.map((cell) => cell.value).filter((v): v is number => v !== null);
  const colors = buildColorResolver(config, numbers, store?.state?.theme);
  const heading = chartColor("--color-text-heading");
  const noDataFill = chartColor("--color-surface-subtle");
  const noDataBorder = chartColor("--color-border-strong");
  const cellBorder = chartColor("--color-border-subtle");

  // A text value with no mapping cannot be coloured; when every cell is one, the field is wrong.
  const unmapped = (cell: HostmapEntity, fill: string | null) =>
    cell.value === null && cell.text !== undefined && fill === null;
  // A mapping's text colour reads on a custom background only; a swatch or text-coloured fill takes a contrast colour.
  const ownTextColor = (mapping: any, fill: string) =>
    mapping?.textColor && mapping?.color === fill && mapping.textColor !== fill
      ? mapping.textColor
      : null;
  const items = cells.map((cell, index) => {
    const { fill, mapping } = colors.styleOf(cell.value, cell.text, cell.name);
    const formatted =
      cell.value !== null ? format(cell.value) : cell.text !== undefined ? cell.text : noValue;
    const text = mapping?.text ? String(mapping.text) : formatted;
    return {
      unmappedText: unmapped(cell, fill),
      value: [index],
      name: cell.name,
      groups: cell.groups,
      labels: cell.labels,
      cellValue: cell.value,
      duplicates: cell.duplicates ?? 1,
      text,
      formatted,
      fill,
      textColor:
        fill === null
          ? chartColor("--color-text-secondary")
          : ownTextColor(mapping, fill) || getContrastColor(fill, heading, CONTRAST_THRESHOLD),
    };
  });
  if (items.every((item) => item.unmappedText)) {
    throw new Error(gt("dashboard.utils.hostmapValueNotNumeric"));
  }

  const entries = showLegend ? legendEntries(config, colors.thresholds, format) : [];
  const stops =
    showLegend && !entries.length && numbers.length
      ? scaleStops(colors.colorCfg, colors.min, colors.max)
      : null;
  const hasNoData = items.some((item) => item.fill === null);
  const legendRoom = showLegend && (entries.length || stops || hasNoData) ? LEGEND_ROOM : 0;

  const panelWidth = chartPanelRef?.value?.offsetWidth ?? 0;
  const panelHeight = chartPanelRef?.value?.offsetHeight ?? 0;
  const visibleHeight = Math.max(0, panelHeight - legendRoom - TOP_PAD);
  // Too many cells for the panel at a readable size: lay out once for the known size and scroll it.
  const scrolled =
    panelWidth && panelHeight && layoutHostmap(tree, panelWidth, visibleHeight, shape).overflows
      ? layoutHostmap(tree, panelWidth - SCROLLBAR_ROOM, visibleHeight, shape)
      : null;
  let memo: { key: string; layout: HostmapLayout } | null = null;
  const layoutFor = (width: number, height: number) => {
    if (scrolled) return scrolled;
    const key = `${width}x${height}`;
    if (memo?.key !== key) {
      memo = {
        key,
        layout: layoutHostmap(tree, width, Math.max(0, height - legendRoom - TOP_PAD), shape),
      };
    }
    return memo.layout;
  };
  // Layout space to pixels: a scrolled map goes through its axes, whose scale is one pixel per unit.
  const originOf = (api: any) => {
    if (!scrolled) return { dx: 0, dy: TOP_PAD };
    const [dx, dy] = api.coord([0, 0]);
    return { dx, dy };
  };

  const renderCell = (params: any, api: any) => {
    const layout = layoutFor(api.getWidth(), api.getHeight());
    const box = layout.cells[params.dataIndex];
    const item = items[params.dataIndex];
    if (!box || !item) return null;
    const gap = Math.max(1, box.size * GAP_RATIO);
    const inner = box.size - gap;
    const { dx, dy } = originOf(api);
    const cx = dx + box.x + box.size / 2;
    const cy = dy + box.y + (shape === "hexagon" ? (box.size * HEX_HEIGHT) / 2 : box.size / 2);
    const style =
      item.fill === null
        ? { fill: noDataFill, stroke: noDataBorder, lineWidth: 1, lineDash: [2, 2] }
        : { fill: item.fill, stroke: cellBorder, lineWidth: 0.5 };
    const emphasis = { style: { stroke: heading, lineWidth: 2 } };
    const cellShape =
      shape === "hexagon"
        ? {
            type: "polygon",
            shape: { points: hexagonPoints(cx, cy, inner / SQRT3) },
            style,
            emphasis,
          }
        : {
            type: "rect",
            shape: { x: cx - inner / 2, y: cy - inner / 2, width: inner, height: inner, r: 1 },
            style,
            emphasis,
          };
    if (cellLabel === "none" || inner < MIN_LABEL_CELL) return cellShape;
    const label = fitHostmapLabel(
      cellLabel === "name" ? item.name : item.text,
      inner - 4,
      CELL_FONT_SIZES.filter((size) => size <= inner / 2),
    );
    return {
      type: "group",
      children: [
        cellShape,
        {
          type: "text",
          silent: true,
          style: {
            text: label.text,
            x: cx,
            y: cy,
            align: "center",
            verticalAlign: "middle",
            fill: item.textColor,
            fontSize: label.fontSize,
          },
        },
      ],
    };
  };

  // The swatch shows a group's highest value, so a hot rack stands out even when its cells are small.
  const swatchOf = (worst: number | null) =>
    worst === null ? null : colors.styleOf(worst, undefined, "").fill;
  const groupName = (group: string) =>
    group === "" ? gt("dashboard.utils.hostmapNoGroup") : group;
  const renderFrame = (params: any, api: any) => {
    const frame = layoutFor(api.getWidth(), api.getHeight()).frames[params.dataIndex];
    if (!frame) return null;
    const { dx, dy } = originOf(api);
    const fx = dx + frame.x;
    const fy = dy + frame.y;
    const swatch = swatchOf(frame.worst);
    const top = fy + FRAME_PAD + TITLE_HEIGHT / 2;
    const textLeft = fx + FRAME_PAD + 2 + SWATCH + SWATCH_GAP;
    const title = fitHostmapLabel(
      groupName(frame.title),
      Math.max(0, fx + frame.width - FRAME_PAD - 2 - textLeft),
    );
    return {
      type: "group",
      children: [
        {
          type: "rect",
          silent: true,
          shape: {
            x: fx + 0.5,
            y: fy + 0.5,
            width: frame.width - 1,
            height: frame.height - 1,
            r: 3,
          },
          style: {
            fill: "transparent",
            stroke: chartColor(
              frame.depth === 1 ? "--color-border-default" : "--color-border-subtle",
            ),
            lineWidth: 1,
          },
        },
        {
          type: "rect",
          shape: {
            x: fx + FRAME_PAD + 2,
            y: top - SWATCH / 2,
            width: SWATCH,
            height: SWATCH,
            r: 2,
          },
          style:
            swatch === null
              ? { fill: noDataFill, stroke: noDataBorder, lineWidth: 1, lineDash: [2, 2] }
              : { fill: swatch },
        },
        {
          type: "text",
          style: {
            text: title.text,
            x: textLeft,
            y: top,
            verticalAlign: "middle",
            fill: chartColor("--color-text-secondary"),
            fontSize: title.fontSize,
          },
        },
      ],
    };
  };
  // Every group but the root draws one frame, and place() visits them in this same order.
  const frameCount = (node: HostmapGroup): number =>
    node.children.reduce((sum, child) => sum + 1 + frameCount(child), 0);

  const frameTooltip = (dataIndex: number) => {
    const frame = (scrolled ?? memo?.layout)?.frames[dataIndex];
    if (!frame) return "";
    const marker = echartsFormat.getTooltipMarker(swatchOf(frame.worst) ?? noDataBorder);
    const highest = frame.worst === null ? noValue : format(frame.worst);
    return [
      `<strong>${escapeHtml(frame.path.map(groupName).join(GROUP_SEPARATOR))}</strong>`,
      `${marker}${escapeHtml(gt("dashboard.utils.hostmapGroupHighest", { value: highest }))}`,
    ].join("<br/>");
  };
  const tooltipFormatter = (params: any) => {
    if (params?.seriesIndex === 1) return frameTooltip(params.dataIndex);
    const item = params?.data;
    if (params?.seriesIndex !== 0 || !item) return "";
    const marker = echartsFormat.getTooltipMarker(item.fill ?? noDataBorder);
    const value =
      item.text !== item.formatted ? `${item.text} (${item.formatted})` : item.formatted;
    const lines = [`<strong>${escapeHtml(item.name)}</strong>`];
    if (item.groups.length) {
      const path = item.groups.map((group: string) =>
        group === "" ? gt("dashboard.utils.hostmapNoGroup") : group,
      );
      lines.push(escapeHtml(path.join(GROUP_SEPARATOR)));
    }
    lines.push(`${marker}${escapeHtml(value)}`);
    if (item.unmappedText) lines.push(escapeHtml(gt("dashboard.utils.hostmapTextUnmapped")));
    if (item.duplicates > 1) {
      lines.push(
        escapeHtml(
          gt("dashboard.utils.hostmapDuplicate", { count: item.duplicates }, item.duplicates),
        ),
      );
    }
    const labels = Object.entries(item.labels as Record<string, string>);
    labels.slice(0, TOOLTIP_MAX_LABELS).forEach(([key, label]) => {
      lines.push(`${escapeHtml(key)}: ${escapeHtml(label)}`);
    });
    if (labels.length > TOOLTIP_MAX_LABELS) {
      const more = labels.length - TOOLTIP_MAX_LABELS;
      lines.push(escapeHtml(gt("dashboard.utils.hostmapMoreLabels", { count: more }, more)));
    }
    return lines.join("<br/>");
  };

  const legendSeries: any[] = entries.map(({ name, color }) => ({
    type: "custom",
    coordinateSystem: "none",
    name,
    data: [],
    renderItem: () => null,
    itemStyle: { color },
  }));
  if (showLegend && hasNoData) {
    legendSeries.push({
      type: "custom",
      coordinateSystem: "none",
      name: noValue,
      data: [],
      renderItem: () => null,
      itemStyle: {
        color: noDataFill,
        borderColor: noDataBorder,
        borderType: "dashed",
        borderWidth: 1,
      },
    });
  }
  const scaleSeriesIndex = 2 + legendSeries.length;

  // A scrolled map sits on hidden 1:1 axes, so a y dataZoom window of the visible height scrolls it.
  const placement = scrolled
    ? { coordinateSystem: "cartesian2d", clip: true }
    : { coordinateSystem: "none" };
  const scrollAxes = scrolled
    ? {
        grid: { left: 0, right: SCROLLBAR_ROOM, top: TOP_PAD, bottom: legendRoom },
        xAxis: { type: "value", show: false, min: 0, max: panelWidth - SCROLLBAR_ROOM },
        yAxis: {
          type: "value",
          show: false,
          inverse: true,
          min: 0,
          max: Math.max(visibleHeight, scrolled.contentHeight),
        },
        dataZoom: [
          {
            id: STATE_TIMELINE_ROW_ZOOM_IDS[0],
            type: "slider",
            yAxisIndex: 0,
            orient: "vertical",
            right: 2,
            top: TOP_PAD,
            bottom: legendRoom,
            width: 10,
            startValue: 0,
            endValue: visibleHeight,
            zoomLock: true,
            showDetail: false,
            showDataShadow: false,
            brushSelect: false,
            filterMode: "none",
          },
          {
            id: STATE_TIMELINE_ROW_ZOOM_IDS[1],
            type: "inside",
            yAxisIndex: 0,
            zoomOnMouseWheel: false,
            moveOnMouseWheel: true,
            moveOnMouseMove: false,
            preventDefaultMouseMove: false,
            filterMode: "none",
          },
        ],
      }
    : {};

  const options: any = {
    backgroundColor: "transparent",
    animation: false,
    ...scrollAxes,
    tooltip: {
      show: true,
      trigger: "item",
      appendToBody: true,
      className: "o2-echarts-tooltip",
      textStyle: { color: chartColor("--color-tooltip-text"), fontSize: 12 },
      backgroundColor: chartColor("--color-tooltip-bg"),
      borderColor: chartColor("--color-tooltip-border"),
      borderWidth: 1,
      padding: [8, 12],
      formatter: tooltipFormatter,
    },
    legend: {
      show: showLegend && legendSeries.length > 0,
      type: "scroll",
      bottom: 0,
      ...(stops ? { right: 0 } : { left: "center" }),
      selectedMode: false,
      textStyle: { color: chartColor("--color-text-secondary") },
      data: legendSeries.map((series) => series.name),
    },
    ...(stops
      ? {
          visualMap: {
            type: "continuous",
            show: true,
            seriesIndex: scaleSeriesIndex,
            min: colors.min,
            max: colors.max === colors.min ? colors.min + 1 : colors.max,
            calculable: false,
            hoverLink: false,
            orient: "horizontal",
            left: 0,
            bottom: 4,
            itemWidth: 10,
            itemHeight: 120,
            text: [format(colors.max), format(colors.min)],
            textStyle: { color: chartColor("--color-text-secondary") },
            inRange: { color: stops },
          },
        }
      : {}),
    series: [
      {
        type: "custom",
        ...placement,
        renderItem: renderCell,
        data: items,
        tooltip: { trigger: "item" },
      },
      {
        type: "custom",
        ...placement,
        renderItem: renderFrame,
        data: Array.from({ length: frameCount(tree) }, (_, index) => ({ value: [index] })),
        z: 1,
        tooltip: { trigger: "item" },
      },
      ...legendSeries,
      ...(stops
        ? [
            {
              type: "custom",
              coordinateSystem: "none",
              name: "",
              data: [],
              renderItem: () => null,
              silent: true,
            },
          ]
        : []),
    ],
  };

  const limiting = metadata?.seriesLimiting;
  const seriesTotal =
    isPromQL && limiting && (limiting.uniqueSeriesSeen ?? 0) > limiting.metricsStored
      ? limiting.uniqueSeriesSeen
      : entities.length;
  const total = Math.max(seriesTotal, entities.length);
  const shown = cells.length;
  const notice = capNotice(shown, total);
  return {
    options,
    extras: {
      panelId: panelSchema.id,
      // The renderer treats these dataZoom ids as row scrolling, never as a time range.
      ...(scrolled ? { rowScroll: true } : {}),
      ...(notice
        ? {
            seriesLimit: {
              shown,
              total,
              cap,
              displayCapMessage: notice,
            },
          }
        : {}),
    },
  };
};
