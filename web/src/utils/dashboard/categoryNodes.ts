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
import { getSeriesColor } from "./colorPalette";
import { echartsPaletteColor } from "./thresholds";

/** A category tree node; leaves carry the summed value, parents add up their children. */
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
