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
import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";

export const STAT_CHANGE_MODES = ["off", "percent", "absolute"] as const;
export const STAT_CHANGE_COLORS = ["standard", "inverted", "neutral"] as const;
export const STAT_TEXT_MODES = ["value", "value_and_name", "name"] as const;

const LINE_GAP = 4;

export interface StatChangeSplit {
  /** Indices of the current-period results, in display order. */
  primary: number[];
  /** For each primary, the index of its comparison result, or -1 when it has none. */
  reference: number[];
}

export interface MetricChange {
  text: string;
  color: string;
}

/** True when a metric panel compares its value with an earlier period. */
export const isStatChangeOn = (panelSchema: any): boolean =>
  panelSchema?.type === "metric" &&
  (panelSchema?.config?.stat_change === "percent" ||
    panelSchema?.config?.stat_change === "absolute");

/** Time shifts the executor runs for a query; a comparing metric with none of its own compares with the previous period. */
export const effectiveTimeShifts = (
  panelSchema: any,
  query: any,
  startMicros: number,
  endMicros: number,
): { offSet: string }[] => {
  const own = Array.isArray(query?.config?.time_shift) ? query.config.time_shift : [];
  if (own.length > 0 || !isStatChangeOn(panelSchema)) return own;
  const seconds = Math.round((Number(endMicros) - Number(startMicros)) / 1e6);
  return Number.isFinite(seconds) && seconds > 0 ? [{ offSet: `${seconds}s` }] : own;
};

/** Pairs each current-period result with the first shifted result of the same panel query. */
export const splitStatChangeResults = (metadata: any): StatChangeSplit | null => {
  const queries: any[] = metadata?.queries ?? [];
  if (!Array.isArray(queries) || queries.length === 0) return null;
  const isShifted = (meta: any) => Number(meta?.timeRangeGap?.seconds) > 0;
  const queryOf = (meta: any, index: number) => meta?.panelQueryIndex ?? index;
  const primary = queries.map((_, index) => index).filter((index) => !isShifted(queries[index]));
  const reference = primary.map((index) =>
    queries.findIndex(
      (meta, other) =>
        other !== index &&
        isShifted(meta) &&
        queryOf(meta, other) === queryOf(queries[index], index),
    ),
  );
  return { primary, reference };
};

const changeColor = (delta: number, colorMode: string | undefined): string => {
  if (delta === 0 || colorMode === "neutral") return chartColor("--color-text-secondary");
  const rising = delta > 0;
  const good = colorMode === "inverted" ? !rising : rising;
  return chartColor(good ? "--color-status-positive" : "--color-status-negative");
};

/** The change line for a value against its reference, or null when there is nothing to compare. */
export const buildMetricChange = (
  current: unknown,
  reference: unknown,
  config: any,
): MetricChange | null => {
  if (current === null || current === undefined || current === "") return null;
  if (reference === null || reference === undefined || reference === "") return null;
  const now = Number(current);
  const before = Number(reference);
  if (!Number.isFinite(now) || !Number.isFinite(before)) return null;
  const delta = now - before;
  const arrow = delta > 0 ? "▲ " : delta < 0 ? "▼ " : "";
  const decimals = Number.isFinite(Number(config?.decimals)) ? Number(config.decimals) : 2;
  if (config?.stat_change === "percent") {
    if (before === 0) return null;
    const percent = Math.abs((delta / Math.abs(before)) * 100);
    return {
      text: `${arrow}${Number(percent.toFixed(decimals))}%`,
      color: changeColor(delta, config?.stat_change_color),
    };
  }
  const magnitude = formatUnitValue(
    getUnitValue(Math.abs(delta), config?.unit, config?.unit_custom, config?.decimals),
  );
  return { text: `${arrow}${magnitude}`, color: changeColor(delta, config?.stat_change_color) };
};

const metricTextSeries = (options: any): any[] =>
  (Array.isArray(options?.series) ? options.series : []).filter(
    (series: any) => series && "_metricText" in series,
  );

const finitePositive = (value: unknown): number | null => {
  const numeric = Number(value);
  return value !== null && value !== "" && Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

const secondaryFontSize = (valueFontSize: number) =>
  Math.max(11, Math.min(16, Math.round(valueFontSize / 3)));

interface MetricBounds {
  top: number;
  height: number;
  width: number;
}

interface MetricDecoration {
  mode: string | undefined;
  fontSize: number | null;
  change: MetricChange | null;
  name: string;
  bounds: MetricBounds | null;
}

const textNode = (
  text: string,
  fontSize: number,
  x: number,
  y: number,
  fill: string,
  extra = {},
) => ({
  type: "text",
  style: {
    text,
    fontSize,
    fontWeight: 400,
    align: "center",
    verticalAlign: "middle",
    x,
    y,
    fill,
    ...extra,
  },
});

const MIN_FIT_FONT = 8;
const SIDE_PAD = 8;

// The value font already fills a short panel, so the added lines have to share its height.
const fitToBounds = (texts: any[], bounds: MetricBounds | null, added: any[]) => {
  if (!bounds || !(bounds.height > 0) || texts.length === 0) return;
  const fontOf = (node: any) => Number(node.style.fontSize) || 12;
  const top = Math.min(...texts.map((node) => node.style.y - fontOf(node) / 2));
  const bottom = Math.max(...texts.map((node) => node.style.y + fontOf(node) / 2));
  const scale = Math.min(1, bounds.height / (bottom - top));
  const middle = (top + bottom) / 2;
  const target = Math.min(
    Math.max(middle, bounds.top + ((bottom - top) * scale) / 2),
    bounds.top + bounds.height - ((bottom - top) * scale) / 2,
  );
  for (const node of texts) {
    node.style = {
      ...node.style,
      fontSize: Math.max(MIN_FIT_FONT, fontOf(node) * scale),
      y: target + (node.style.y - middle) * scale,
    };
  }
  if (bounds.width > SIDE_PAD * 2) {
    for (const node of added) {
      node.style = { ...node.style, width: bounds.width - SIDE_PAD * 2, overflow: "truncate" };
    }
  }
};

/** Rewrites one rendered metric value (a text node, or a grid cell group) for the panel's text settings. */
const decorateRendered = (node: any, decoration: MetricDecoration): any => {
  if (!node || typeof node !== "object") return node;
  const children: any[] = node.type === "group" ? [...(node.children ?? [])] : [node];
  const texts = children.filter((child) => child?.type === "text");
  const value = texts[0];
  if (!value?.style) return node;
  let label = texts[1];
  value.style = { ...value.style };
  if (decoration.fontSize !== null) value.style.fontSize = decoration.fontSize;
  const valueFont = Number(value.style.fontSize) || 12;
  const extraFont = secondaryFontSize(valueFont);
  const below = (node: any) =>
    node.style.y + (Number(node.style.fontSize) || extraFont) / 2 + extraFont / 2 + LINE_GAP;
  let addedLabel = false;
  if (decoration.mode === "value" || decoration.mode === "name") {
    if (decoration.mode === "name" && decoration.name !== "") value.style.text = decoration.name;
    if (label) children.splice(children.indexOf(label), 1);
    label = undefined;
  } else if (decoration.mode === "value_and_name" && !label && decoration.name !== "") {
    label = textNode(decoration.name, extraFont, value.style.x, below(value), value.style.fill, {
      opacity: 0.65,
    });
    children.push(label);
    addedLabel = true;
  } else if (label && decoration.fontSize !== null) {
    label.style = { ...label.style, y: below(value) };
  }
  const changeNode = decoration.change
    ? textNode(
        decoration.change.text,
        extraFont,
        value.style.x,
        below(label ?? value),
        decoration.change.color,
        { fontWeight: 500 },
      )
    : null;
  if (changeNode) children.push(changeNode);
  const added =
    (decoration.change ? extraFont + LINE_GAP : 0) + (addedLabel ? extraFont + LINE_GAP : 0);
  if (added > 0) {
    for (const child of children) {
      if (child?.type === "text") child.style = { ...child.style, y: child.style.y - added / 2 };
    }
  }
  fitToBounds(
    children.filter((child) => child?.type === "text"),
    decoration.bounds,
    [label, changeNode].filter(Boolean),
  );
  return node.type === "group" ? { ...node, children } : { type: "group", children };
};

/** Applies the metric text settings (stat change, text mode, value size) to converted metric options; a no-op while every key is absent. */
export const applyMetricOptions = (
  options: any,
  panelSchema: any,
  referenceOptions?: any,
): void => {
  if (!options || panelSchema?.type !== "metric") return;
  const config = panelSchema?.config ?? {};
  const mode = (STAT_TEXT_MODES as readonly string[]).includes(config.stat_text_mode)
    ? config.stat_text_mode
    : undefined;
  const fontSize = finitePositive(config.value_font_size);
  const references = isStatChangeOn(panelSchema) ? metricTextSeries(referenceOptions) : [];
  if (!mode && fontSize === null && references.length === 0) return;
  metricTextSeries(options).forEach((series: any, index: number) => {
    const reference = references[index];
    const change = reference
      ? buildMetricChange(series._metricRawValue, reference._metricRawValue, config)
      : null;
    if (!mode && fontSize === null && !change) return;
    const layout = series._metricLayout;
    const decoration: MetricDecoration = {
      mode,
      fontSize,
      change,
      name: String(series._metricLabel ?? series._metricStatName ?? ""),
      bounds: layout
        ? {
            top: Number(layout.top) || 0,
            height: Number(layout.height) || 0,
            width: Number(layout.width) || 0,
          }
        : null,
    };
    const render = series.renderItem;
    if (typeof render !== "function") return;
    series.renderItem = (...args: any[]) => decorateRendered(render(...args), decoration);
    series._metricChange = change;
    if (layout) {
      if (fontSize !== null) layout.fontSize = fontSize;
      const extraFont = secondaryFontSize(Number(layout.fontSize) || 12);
      const lines =
        (change ? 1 : 0) +
        (mode === "value_and_name" && decoration.name !== "" && !layout.labelClearance ? 1 : 0);
      layout.cy -= (lines * (extraFont + LINE_GAP)) / 2;
    }
  });
};
