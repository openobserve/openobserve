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

import { getDataValue } from "./aliasUtils";
import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";
import { getColorPalette, getSeriesHash } from "./colorPalette";
import { chartColor } from "@/utils/chartTheme";
import { escapeHtml } from "@/utils/html";

/** What the sankey could not draw as given: loops redirected to return nodes, and rows it skipped. */
export interface SankeyNotice {
  returnLinks: number;
  skippedRows: number;
}

interface SankeyQuery {
  fields?: {
    source?: { alias: string };
    target?: { alias: string };
    value?: { alias: string };
  };
}

interface SankeyConfig {
  unit?: string;
  unit_custom?: string;
  decimals?: number;
  color?: { mode?: string };
}

interface SankeyPanelSchema {
  queries?: SankeyQuery[];
  config?: SankeyConfig;
}

interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

interface SankeyNode {
  name: string;
  rawName: string;
  isReturn?: boolean;
  itemStyle: { color: string };
  label?: { position: "left" };
}

interface SankeyItemData {
  rawName?: string;
  rawSource?: string;
  rawTarget?: string;
  isReturn?: boolean;
}

interface SankeyFormatterParams {
  dataType?: string;
  data?: SankeyItemData;
  value?: unknown;
}

// The NUL prefix keeps a return node's id from colliding with any real node name.
const RETURN_NODE_PREFIX = "\u0000↩";
const RETURN_MARK = "↩";
const LINK_OPACITY = 0.4;

const returnNodeId = (name: string) => `${RETURN_NODE_PREFIX}${name}`;

// Code-point order, so the layout does not vary with the browser locale.
const compareNames = (a: string, b: string) => {
  if (a < b) return -1;
  return a > b ? 1 : 0;
};

// Heaviest first, so the DFS keeps big flows as forward links and a lighter one closes the loop.
const compareOutgoing = (a: SankeyLink, b: SankeyLink) =>
  b.value - a.value || compareNames(a.target, b.target);

const collectLinks = (panelSchema: SankeyPanelSchema, searchQueryData: unknown[]) => {
  const links = new Map<string, SankeyLink>();
  let skippedRows = 0;
  (panelSchema.queries ?? []).forEach((query, index) => {
    const rows = searchQueryData[index];
    const sourceAlias = query?.fields?.source?.alias;
    const targetAlias = query?.fields?.target?.alias;
    const valueAlias = query?.fields?.value?.alias;
    if (!Array.isArray(rows) || !sourceAlias || !targetAlias || !valueAlias) return;
    rows.forEach((row: Record<string, unknown>) => {
      const source = getDataValue(row, sourceAlias);
      const target = getDataValue(row, targetAlias);
      const value = Number(getDataValue(row, valueAlias));
      const sourceName = source === null || source === undefined ? "" : String(source);
      const targetName = target === null || target === undefined ? "" : String(target);
      if (sourceName === "" || targetName === "" || !Number.isFinite(value) || value <= 0) {
        skippedRows++;
        return;
      }
      const key = JSON.stringify([sourceName, targetName]);
      const existing = links.get(key);
      if (existing) existing.value += value;
      else links.set(key, { source: sourceName, target: targetName, value });
    });
  });
  return { links, skippedRows };
};

const findBackEdges = (nodes: string[], links: SankeyLink[]): Set<SankeyLink> => {
  const outgoing = new Map<string, SankeyLink[]>();
  const inflow = new Map<string, number>();
  nodes.forEach((node) => {
    outgoing.set(node, []);
    inflow.set(node, 0);
  });
  links.forEach((link) => {
    outgoing.get(link.source)!.push(link);
    inflow.set(link.target, inflow.get(link.target)! + link.value);
  });
  outgoing.forEach((edges) => edges.sort(compareOutgoing));

  const state = new Map<string, "active" | "done">();
  const backEdges = new Set<SankeyLink>();
  // Links into a DFS root become the return links, so a loop is entered where the least flows in.
  const roots = [...nodes].sort((a, b) => inflow.get(a)! - inflow.get(b)! || compareNames(a, b));

  roots.forEach((root) => {
    if (state.has(root)) return;
    state.set(root, "active");
    const stack: { node: string; next: number }[] = [{ node: root, next: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const edges = outgoing.get(frame.node)!;
      if (frame.next >= edges.length) {
        state.set(frame.node, "done");
        stack.pop();
        continue;
      }
      const link = edges[frame.next++];
      const targetState = state.get(link.target);
      if (targetState === "active") backEdges.add(link);
      else if (!targetState) {
        state.set(link.target, "active");
        stack.push({ node: link.target, next: 0 });
      }
    }
  });
  return backEdges;
};

const formatValue = (value: unknown, config?: SankeyConfig) =>
  formatUnitValue(
    getUnitValue(value, config?.unit as string, config?.unit_custom as string, config?.decimals),
  );

const nodeColorResolver = (config?: SankeyConfig) => {
  const palette = getColorPalette();
  const byIndex = config?.color?.mode === "palette-classic";
  const colors = new Map<string, string>();
  return (name: string) => {
    let color = colors.get(name);
    if (color === undefined) {
      color = byIndex
        ? palette[colors.size % palette.length]
        : palette[getSeriesHash(name, palette)];
      colors.set(name, color);
    }
    return color;
  };
};

// ECharts' sankey layout rejects cycles, so a link that closes one ends at a return node instead.
export const convertSankeyData = (panelSchema: SankeyPanelSchema, searchQueryData: unknown) => {
  const hasValidQuery = panelSchema.queries?.some(
    (query) => query.fields?.source && query.fields?.target && query.fields?.value,
  );

  if (
    !Array.isArray(searchQueryData) ||
    searchQueryData.length === 0 ||
    !searchQueryData[0] ||
    !hasValidQuery
  ) {
    return { options: null };
  }

  const collected = collectLinks(panelSchema, searchQueryData);
  const summed = [...collected.links.values()].sort(
    (a, b) => compareNames(a.source, b.source) || compareNames(a.target, b.target),
  );
  if (!summed.length) {
    const sankeyNotice: SankeyNotice = { returnLinks: 0, skippedRows: collected.skippedRows };
    return { options: null, extras: { sankeyNotice } };
  }

  const nodeNames = new Set<string>();
  summed.forEach((link) => {
    nodeNames.add(link.source);
    nodeNames.add(link.target);
  });
  const sortedNames = [...nodeNames].sort(compareNames);
  const backEdges = findBackEdges(sortedNames, summed);

  const colorOf = nodeColorResolver(panelSchema.config);
  const nodes: SankeyNode[] = sortedNames.map((name) => ({
    name,
    rawName: name,
    itemStyle: { color: colorOf(name) },
  }));
  const returnNodes = new Set<string>();
  const links = summed.map((link) => {
    const isReturn = backEdges.has(link);
    if (isReturn && !returnNodes.has(link.target)) {
      returnNodes.add(link.target);
      nodes.push({
        name: returnNodeId(link.target),
        rawName: link.target,
        isReturn: true,
        itemStyle: { color: colorOf(link.target) },
      });
    }
    return {
      source: link.source,
      target: isReturn ? returnNodeId(link.target) : link.target,
      value: link.value,
      rawSource: link.source,
      rawTarget: link.target,
      isReturn,
      lineStyle: { curveness: 0.5 },
    };
  });

  // Sinks sit in the last column, so their labels go inside the chart instead of past its edge.
  const sources = new Set(summed.map((link) => link.source));
  nodes.forEach((node) => {
    if (node.isReturn || !sources.has(node.name)) node.label = { position: "left" };
  });

  const config = panelSchema.config;
  const displayName = (data?: SankeyItemData) =>
    data?.isReturn ? `${data.rawName} ${RETURN_MARK}` : String(data?.rawName ?? "");

  const options = {
    tooltip: {
      trigger: "item",
      formatter: function (params: SankeyFormatterParams) {
        const name =
          params.dataType === "edge"
            ? `${params.data?.rawSource} > ${params.data?.rawTarget}${params.data?.isReturn ? ` ${RETURN_MARK}` : ""}`
            : displayName(params.data);
        return `${escapeHtml(name)} : ${escapeHtml(formatValue(params.value, config))}`;
      },
    },
    backgroundColor: "transparent",
    series: [
      {
        type: "sankey",
        layout: "none",
        data: nodes,
        links,
        emphasis: {
          focus: "adjacency",
        },
        lineStyle: { color: "source", opacity: LINK_OPACITY },
        label: {
          color: chartColor("--color-text-body"),
          textBorderColor: chartColor("--color-surface-base"),
          textBorderWidth: 3,
          formatter: (params: SankeyFormatterParams) =>
            `${displayName(params.data)}: ${formatValue(params.value, config)}`,
        },
      },
    ],
  };

  const sankeyNotice: SankeyNotice = {
    returnLinks: backEdges.size,
    skippedRows: collected.skippedRows,
  };
  return { options, extras: { sankeyNotice } };
};
