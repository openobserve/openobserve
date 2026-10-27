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
import { getSeriesColor } from "./colorPalette";
import { getFieldLabel } from "./fieldLabel";
import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";
import { echartsPaletteColor } from "./thresholds";
import { labelColorOn, withLightness } from "./chartLabelContrast";

const UPPER_LABEL_HEIGHT = 18;
const CHILD_LIGHTNESS: [number, number] = [0.35, 0.6];

/** A treemap node; leaves carry the summed value, parents add up their children. */
export interface TreemapNode {
  name: string;
  value: number;
  path: string[];
  children?: TreemapNode[];
  itemStyle?: { color: string };
  label?: { color?: string; show?: boolean };
  upperLabel?: { color: string };
}

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const byValue = (a: TreemapNode, b: TreemapNode) => b.value - a.value;

const rootName = (panelSchema: any): string => {
  const query = panelSchema?.queries?.[0];
  const value = query?.fields?.y?.[0];
  return getFieldLabel(value, panelSchema?.config, query?.customQuery) || value?.alias || "";
};

/** Nests rows by the x fields and then the breakdown field, summing the first y field into the leaves. */
export const buildTreemapNodes = (panelSchema: any, data: any[]): TreemapNode[] => {
  const root: TreemapNode = { name: "", value: 0, path: [], children: [] };
  (panelSchema?.queries ?? []).forEach((query: any, index: number) => {
    const rows = data?.[index];
    const value = query?.fields?.y?.[0];
    const levels = [...(query?.fields?.x ?? []), ...(query?.fields?.breakdown ?? [])];
    if (!Array.isArray(rows) || !value || !levels.length || query?.config?.hide) return;
    rows.forEach((row: any) => {
      const amount = toNumber(getDataValue(row, value.alias));
      if (amount === null || amount <= 0) return;
      let node = root;
      levels.forEach((level: any) => {
        const name = String(getDataValue(row, level.alias) ?? "");
        let child = node.children!.find((candidate) => candidate.name === name);
        if (!child) {
          child = { name, value: 0, path: [...node.path, name], children: [] };
          node.children!.push(child);
        }
        child.value += amount;
        node = child;
      });
    });
  });
  const tidy = (nodes: TreemapNode[]): TreemapNode[] =>
    nodes
      .sort(byValue)
      .map((node) =>
        node.children?.length
          ? { ...node, children: tidy(node.children) }
          : { name: node.name, value: node.value, path: node.path },
      );
  return tidy(root.children!);
};

/** Colours each named item from the panel Color palette, shading by value range; a classic palette falls back to the chart colours. */
export const paintByPalette = (
  items: { name: string; value: number; itemStyle?: { color: string } }[],
  config: any,
  theme: string,
) => {
  const values = items.map((item) => item.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  items.forEach((item, index) => {
    item.itemStyle = {
      color:
        getSeriesColor(
          config?.color ?? null,
          item.name,
          [item.value],
          min,
          max,
          theme,
          config?.color?.colorBySeries,
          config,
        ) ?? echartsPaletteColor(index),
    };
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
      child.label = { color: labelColorOn(withLightness(color, low + (high - low) * share)) };
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
        // Without a leaf depth the breadcrumb names whatever tile sits under the panel centre instead of the view root.
        leafDepth: nested ? 2 : 1,
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
          textBorderWidth: 0,
          formatter: (params: any) => `${params.name}\n${format(params.value)}`,
          overflow: "truncate",
        },
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
