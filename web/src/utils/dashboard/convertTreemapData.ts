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
import { getFieldLabel } from "./fieldLabel";
import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";
import { labelColorOn, withLightness } from "./chartLabelContrast";
import { buildTreemapNodes, paintByPalette, type TreemapNode } from "./categoryNodes";

// Deeper trees break into tiles too small to read.
export const TREEMAP_MAX_LEVELS = 5;
// A parent tile is the sum of its children, so only additive aggregations give it a true value.
export const TREEMAP_SIZE_FUNCTIONS: readonly string[] = ["count", "sum"];

const UPPER_LABEL_HEIGHT = 18;
const MIN_LABEL_TILE: [number, number] = [32, 16];
// ECharts pads treemap labels by 5px on each side.
const LABEL_PADDING = 10;
const CHILD_LIGHTNESS: [number, number] = [0.35, 0.6];
const LABEL_FONT_SIZE = 12;

let measureContext: OffscreenCanvasRenderingContext2D | null | undefined;

const rootName = (panelSchema: any): string => {
  const query = panelSchema?.queries?.[0];
  const value = query?.fields?.y?.[0];
  return getFieldLabel(value, panelSchema?.config, query?.customQuery) || value?.alias || "";
};

const labelContext = (): OffscreenCanvasRenderingContext2D | null => {
  if (measureContext === undefined) {
    measureContext =
      typeof OffscreenCanvas === "undefined" ? null : new OffscreenCanvas(1, 1).getContext("2d");
    if (measureContext) {
      const family =
        typeof document === "undefined" ? "" : getComputedStyle(document.body).fontFamily;
      measureContext.font = `${LABEL_FONT_SIZE}px ${family || "sans-serif"}`;
    }
  }
  return measureContext;
};

/** Width of one label line; without a canvas (tests) it falls back to an average glyph width. */
const lineWidth = (line: string): number => {
  const context = labelContext();
  return context ? context.measureText(line).width : line.length * LABEL_FONT_SIZE * 0.6;
};

// zrender makes each line as tall as one wide glyph in the label font when no lineHeight is set.
const lineHeight = (): number => {
  const context = labelContext();
  return context ? context.measureText("国").width : LABEL_FONT_SIZE * 1.2;
};

/** Whether the label's own text fits its tile; ECharts sizes the label box to the tile, so its labelRect always "fits". */
const labelFits = (rect: { width: number; height: number } | undefined, text: unknown): boolean => {
  const width = rect?.width ?? 0;
  const height = rect?.height ?? 0;
  if (width < MIN_LABEL_TILE[0] || height < MIN_LABEL_TILE[1]) return false;
  const lines = String(text ?? "").split("\n");
  const textWidth = Math.max(...lines.map(lineWidth));
  return (
    textWidth <= width - LABEL_PADDING && lines.length * lineHeight() <= height - LABEL_PADDING
  );
};

// Levels below the first child level carry no visual setting, so ECharts paints them in their parent's colour.
const contrastDeeper = (nodes: TreemapNode[], color: string) => {
  const text = labelColorOn(color);
  nodes.forEach((node) => {
    node.label = { color: text };
    node.upperLabel = { color: text };
    contrastDeeper(node.children ?? [], color);
  });
};

/** Gives every tile the label colour that reads on it, following the lightness ECharts maps child tiles to. */
export const contrastLabels = (nodes: TreemapNode[]) => {
  nodes.forEach((node) => {
    const color = node.itemStyle?.color;
    if (!color) return;
    const text = labelColorOn(color);
    node.label = { color: text };
    node.upperLabel = { color: text };
    const children = node.children ?? [];
    if (!children.length) return;
    const values = children.map((child) => child.value);
    const [min, max] = [Math.min(...values), Math.max(...values)];
    const [low, high] = CHILD_LIGHTNESS;
    children.forEach((child) => {
      const share = max > min ? (child.value - min) / (max - min) : 0.5;
      const shade = withLightness(color, low + (high - low) * share);
      child.label = { color: labelColorOn(shade) };
      child.upperLabel = { color: labelColorOn(shade) };
      contrastDeeper(child.children ?? [], shade);
    });
  });
};

/** Converts SQL rows into a treemap: the x field names the outer tiles, the breakdown splits them. */
export const convertTreemapData = (panelSchema: any, data: any, store: any) => {
  const config = panelSchema?.config ?? {};
  const nodes = buildTreemapNodes(panelSchema, Array.isArray(data) ? data : []);
  if (!nodes.length) return { options: { series: [] }, extras: { panelId: panelSchema?.id } };

  paintByPalette(nodes, config, store?.state?.theme);
  contrastLabels(nodes);
  const format = (value: unknown) =>
    formatUnitValue(getUnitValue(value, config.unit, config.unit_custom, config.decimals));
  const nested = nodes.some((node) => node.children?.length);
  const hasDrilldown = (config.drilldown?.length ?? 0) > 0;
  const surface = chartColor("--color-surface-base");

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
        const path: string[] = params?.data?.path ?? [params?.name ?? ""];
        return `${escapeHtml(path.join(" / "))}: <strong>${escapeHtml(format(params?.value))}</strong>`;
      },
    },
    series: [
      {
        type: "treemap",
        // The breadcrumb's root reads the series name.
        name: panelSchema?.title || rootName(panelSchema),
        data: nodes,
        top: 8,
        left: 8,
        right: 8,
        bottom: config.treemap_show_breadcrumb === false ? 8 : 32,
        roam: false,
        // Without a leaf depth the breadcrumb names whatever tile sits under the panel centre; a drilldown blocks zooming, so then every level is drawn.
        leafDepth: !nested ? 1 : hasDrilldown ? undefined : 2,
        // A click opens the drilldown menu, so it must not also zoom the tile away under it.
        nodeClick: hasDrilldown ? false : "zoomToNode",
        breadcrumb: {
          show: config.treemap_show_breadcrumb !== false,
          bottom: 4,
          itemStyle: {
            color: chartColor("--color-surface-subtle"),
            borderColor: chartColor("--color-border-subtle"),
            textStyle: { color: chartColor("--color-text-body") },
          },
          emphasis: { itemStyle: { color: chartColor("--color-border-subtle") } },
        },
        label: {
          show: true,
          color: chartColor("--color-text-inverse"),
          fontSize: LABEL_FONT_SIZE,
          textBorderWidth: 0,
          formatter: (params: any) => `${params.name}\n${format(params.value)}`,
          overflow: "none",
        },
        // labelLayout has no hide option, so a label that does not fit whole is drawn at size 0 instead of as a fragment.
        labelLayout: (params: any) =>
          labelFits(params?.rect, params?.text) ? {} : { fontSize: 0 },
        upperLabel: nested
          ? {
              show: true,
              height: UPPER_LABEL_HEIGHT,
              color: chartColor("--color-text-inverse"),
              textBorderWidth: 0,
              formatter: (params: any) => `${params.name}  ${format(params.value)}`,
            }
          : { show: false },
        itemStyle: { borderColor: surface, borderWidth: 1, gapWidth: 1 },
        levels: [
          {
            itemStyle: { borderColor: surface, borderWidth: nested ? 2 : 1, gapWidth: 2 },
            // The root tile is unfilled, so its label sits on the panel background.
            upperLabel: { color: chartColor("--color-text-body") },
          },
          {
            colorSaturation: CHILD_LIGHTNESS,
            itemStyle: { borderColorSaturation: 0.7, gapWidth: 1 },
          },
        ],
      },
    ],
  };
  return { options, extras: { panelId: panelSchema?.id } };
};
