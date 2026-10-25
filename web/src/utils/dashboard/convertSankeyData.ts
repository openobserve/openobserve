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
import { getColorPalette, getSeriesColor } from "./colorPalette";
import { chartColor } from "@/utils/chartTheme";
import { escapeHtml } from "@/utils/html";

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
}

// The NUL prefix keeps a return node's id from colliding with any real node name.
const RETURN_NODE_PREFIX = "\u0000↩";
const RETURN_MARK = "↩";
const LINK_OPACITY = 0.4;

const returnNodeId = (name: string) => `${RETURN_NODE_PREFIX}${name}`;

/** Sums rows per source→target pair, keeping only links with a finite positive weight. */
const collectLinks = (panelSchema: any, searchQueryData: any[]): Map<string, SankeyLink> => {
  const links = new Map<string, SankeyLink>();
  panelSchema.queries.forEach((query: any, index: number) => {
    const rows = searchQueryData[index];
    const fields = query?.fields;
    if (!Array.isArray(rows) || !fields?.source || !fields?.target || !fields?.value) return;
    rows.forEach((row: any) => {
      const source = getDataValue(row, fields.source.alias);
      const target = getDataValue(row, fields.target.alias);
      const value = Number(getDataValue(row, fields.value.alias));
      if (source == null || target == null || !Number.isFinite(value) || value <= 0) return;
      const sourceName = String(source);
      const targetName = String(target);
      const key = JSON.stringify([sourceName, targetName]);
      const existing = links.get(key);
      if (existing) existing.value += value;
      else links.set(key, { source: sourceName, target: targetName, value });
    });
  });
  return links;
};

/** Finds the links that close a cycle (self-loops included) with a DFS that visits natural sources first. */
const findBackEdges = (nodes: string[], links: SankeyLink[]): Set<SankeyLink> => {
  const outgoing = new Map<string, SankeyLink[]>();
  const inDegree = new Map<string, number>();
  nodes.forEach((node) => {
    outgoing.set(node, []);
    inDegree.set(node, 0);
  });
  links.forEach((link) => {
    outgoing.get(link.source)!.push(link);
    inDegree.set(link.target, inDegree.get(link.target)! + 1);
  });

  const state = new Map<string, "active" | "done">();
  const backEdges = new Set<SankeyLink>();
  const roots = [
    ...nodes.filter((node) => inDegree.get(node) === 0),
    ...nodes.filter((node) => inDegree.get(node) !== 0),
  ];

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

const formatValue = (value: any, config: any) =>
  formatUnitValue(getUnitValue(value, config?.unit, config?.unit_custom, config?.decimals));

/** Categorical node colours: hashed by name, or by first appearance for the classic palette. */
const nodeColorResolver = (config: any) => {
  const palette = getColorPalette();
  const byIndex = config?.color?.mode === "palette-classic";
  const colors = new Map<string, string>();
  return (name: string) => {
    let color = colors.get(name);
    if (color === undefined) {
      color = byIndex
        ? palette[colors.size % palette.length]
        : (getSeriesColor(null, name, 0, 0, 0, "") ?? palette[0]);
      colors.set(name, color);
    }
    return color;
  };
};

/**
 * Converts SQL rows into a sankey chart. Duplicate links are summed and every link that would
 * close a cycle is redirected to a return node, because the sankey layout only accepts a DAG.
 */
export const convertSankeyData = (panelSchema: any, searchQueryData: any) => {
  const hasValidQuery = panelSchema.queries?.some(
    (query: any) => query.fields?.source && query.fields?.target && query.fields?.value,
  );

  if (
    !Array.isArray(searchQueryData) ||
    searchQueryData.length === 0 ||
    !searchQueryData[0] ||
    !hasValidQuery
  ) {
    return { options: null };
  }

  const summed = [...collectLinks(panelSchema, searchQueryData).values()];
  if (!summed.length) return { options: null };

  const nodeNames = new Set<string>();
  summed.forEach((link) => {
    nodeNames.add(link.source);
    nodeNames.add(link.target);
  });
  const backEdges = findBackEdges([...nodeNames], summed);

  const colorOf = nodeColorResolver(panelSchema.config);
  const nodes: SankeyNode[] = [...nodeNames].map((name) => ({
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

  const config = panelSchema.config;
  const displayName = (data: any) =>
    data?.isReturn ? `${data.rawName} ${RETURN_MARK}` : String(data?.rawName ?? "");

  const options = {
    tooltip: {
      trigger: "item",
      formatter: function (params: any) {
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
          formatter: (params: any) =>
            `${displayName(params.data)}: ${formatValue(params.value, config)}`,
        },
      },
    ],
  };

  return { options, extras: { sankeyReturnLinks: backEdges.size } };
};
