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

import { compareProfilesNodesByTotal, type ProfilesTreeNode } from "@/services/profiles";

export type SandwichBarRow = {
  id: string;
  name: string;
  total: number;
  x: number;
  width: number;
  depth: number;
  isTotal?: boolean;
};

export const findNodeByPath = (
  root: ProfilesTreeNode | null | undefined,
  path: string | null,
): ProfilesTreeNode | null => {
  if (!root) return null;
  if (!path || path === "root") return root;
  const parts = path.split("/").slice(1);
  let current: ProfilesTreeNode = root;
  for (const part of parts) {
    const index = Number(part);
    const children = [...(current.children ?? [])].sort(compareProfilesNodesByTotal);
    const next = children[index];
    if (!next) return null;
    current = next;
  }
  return current;
};

export const ancestorChainToPath = (root: ProfilesTreeNode, path: string): ProfilesTreeNode[] => {
  if (path === "root") return [root];
  const parts = path.split("/").slice(1);
  const chain: ProfilesTreeNode[] = [root];
  let current = root;
  for (const part of parts) {
    const index = Number(part);
    const children = [...(current.children ?? [])].sort(compareProfilesNodesByTotal);
    const next = children[index];
    if (!next) break;
    chain.push(next);
    current = next;
  }
  return chain;
};

export const buildCallerBars = (
  root: ProfilesTreeNode,
  path: string,
  windowTotal: number,
): SandwichBarRow[] => {
  const chain = ancestorChainToPath(root, path);
  const callers = chain.slice(0, -1);
  const rows: SandwichBarRow[] = [
    {
      id: "window",
      name: "",
      total: windowTotal,
      x: 0,
      width: 100,
      depth: 0,
      isTotal: true,
    },
  ];
  callers.forEach((node, index) => {
    const width = windowTotal > 0 ? (node.total / windowTotal) * 100 : 0;
    rows.push({
      id: `caller-${index}`,
      name: node.name,
      total: node.total,
      x: 0,
      width,
      depth: index + 1,
    });
  });
  return rows;
};

export const buildCalleeBars = (
  pivot: ProfilesTreeNode,
  path: string,
  windowTotal: number,
): SandwichBarRow[] => {
  const pivotWidth = windowTotal > 0 ? (pivot.total / windowTotal) * 100 : 0;
  const rows: SandwichBarRow[] = [
    {
      id: `${path}-pivot`,
      name: pivot.name,
      total: pivot.total,
      x: 0,
      width: pivotWidth,
      depth: 0,
    },
  ];

  const walk = (
    node: ProfilesTreeNode,
    depth: number,
    left: number,
    width: number,
    parentTotal: number,
    nodePath: string,
  ) => {
    if (!node.children?.length || parentTotal <= 0) return;
    const children = [...node.children].sort(compareProfilesNodesByTotal);
    let offset = left;
    for (const [index, child] of children.entries()) {
      const childWidth = width * (child.total / parentTotal);
      if (childWidth <= 0.05) {
        offset += childWidth;
        continue;
      }
      const childPath = `${nodePath}/${index}`;
      rows.push({
        id: childPath,
        name: child.name,
        total: child.total,
        x: offset,
        width: childWidth,
        depth,
      });
      walk(child, depth + 1, offset, childWidth, child.total, childPath);
      offset += childWidth;
    }
  };

  walk(pivot, 1, 0, pivotWidth, pivot.total, path);
  return rows;
};

export const countTreeNodes = (node: ProfilesTreeNode): number => {
  const children = node.children ?? [];
  return 1 + children.reduce((sum, child) => sum + countTreeNodes(child), 0);
};
