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
import { getDataValue } from "./aliasUtils";
import { getSeriesColor } from "./colorPalette";
import { echartsPaletteColor } from "./thresholds";

/** A category tree node; leaves carry the summed value, parents add up their children. */
export interface TreemapNode {
  name: string;
  /** The group's own value when the shown name stands in for a missing (null) or empty one. */
  rawName?: string | null;
  value: number;
  path: string[];
  /** The groups' own values from the root, when the shown path stands in for a missing or empty one. */
  rawPath?: (string | null)[];
  children?: TreemapNode[];
  itemStyle?: { color: string };
  label?: { color?: string; show?: boolean; rotate?: "radial" | "tangential" };
  upperLabel?: { color: string };
}

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const byValue = (a: TreemapNode, b: TreemapNode) => b.value - a.value;

// A missing and an empty group are different answers, so each gets its own visible tile.
const groupName = (key: string | null): string => {
  if (key === null) return gt("dashboard.utils.categoryNullGroup");
  return key === "" ? gt("dashboard.utils.categoryEmptyGroup") : key;
};

const isStandIn = (key: string | null) => key === null || key === "";

/** Nests rows by the x fields and then the breakdown field, summing the first y field into the leaves and counting the rows left out. */
export const buildTreemapNodes = (
  panelSchema: any,
  data: any[],
): { nodes: TreemapNode[]; skippedRows: number } => {
  const root: TreemapNode = { name: "", value: 0, path: [], rawPath: [], children: [] };
  let skippedRows = 0;
  (panelSchema?.queries ?? []).forEach((query: any, index: number) => {
    const rows = data?.[index];
    const value = query?.fields?.y?.[0];
    const levels = [...(query?.fields?.x ?? []), ...(query?.fields?.breakdown ?? [])];
    if (!Array.isArray(rows) || !value || !levels.length || query?.config?.hide) return;
    rows.forEach((row: any) => {
      const amount = toNumber(getDataValue(row, value.alias));
      // A tile's area is its value, so a row without a positive one cannot be drawn.
      if (amount === null || amount <= 0) {
        skippedRows++;
        return;
      }
      let node = root;
      levels.forEach((level: any) => {
        const raw = getDataValue(row, level.alias);
        const key = raw === null || raw === undefined ? null : String(raw);
        // Tiles are told apart by their own value, so a real "(null)" never joins the missing group.
        let child = node.children!.find(
          (candidate) => candidate.rawPath![candidate.rawPath!.length - 1] === key,
        );
        if (!child) {
          const name = groupName(key);
          child = {
            name,
            ...(isStandIn(key) ? { rawName: key } : {}),
            value: 0,
            path: [...node.path, name],
            rawPath: [...node.rawPath!, key],
            children: [],
          };
          node.children!.push(child);
        }
        child.value += amount;
        node = child;
      });
    });
  });
  const tidy = (nodes: TreemapNode[]): TreemapNode[] =>
    nodes.sort(byValue).map(({ children, rawPath, ...node }) => ({
      ...node,
      ...(rawPath?.some(isStandIn) ? { rawPath } : {}),
      ...(children?.length ? { children: tidy(children) } : {}),
    }));
  return { nodes: tidy(root.children!), skippedRows };
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
