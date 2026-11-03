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

const STACK_FIELD_NAMES = ["stack", "stacktrace", "stack_trace", "folded", "frames"];
const VALUE_FIELD_NAMES = ["value", "samples", "count", "total", "self"];

/** Folded stack frames are separated by ";", root first, as in Brendan Gregg's collapsed format. */
export const FOLDED_STACK_SEPARATOR = ";";

/** The tree shape FlameGraphView draws. */
export interface FlameGraphNode {
  name: string;
  total: number;
  children?: FlameGraphNode[];
}

export interface FlameGraphPanelData {
  root: FlameGraphNode | null;
  stackField: string | null;
  valueField: string | null;
  /** Rows dropped because the stack was empty or the value was not a positive number. */
  skipped: number;
}

interface MutableNode {
  name: string;
  total: number;
  children: Map<string, MutableNode>;
}

const setField = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const pickStackField = (rows: Record<string, unknown>[]): string | null => {
  const sample = rows.slice(0, 50);
  const named = STACK_FIELD_NAMES.find((name) =>
    sample.some((row) => typeof row[name] === "string"),
  );
  if (named) return named;
  const keys = Object.keys(sample[0] ?? {});
  return (
    keys.find((key) =>
      sample.some((row) => typeof row[key] === "string" && String(row[key]).includes(";")),
    ) ?? null
  );
};

const pickValueField = (rows: Record<string, unknown>[], stackField: string | null) => {
  const sample = rows.slice(0, 50);
  const numeric = (key: string) =>
    key !== stackField && sample.some((row) => toNumber(row[key]) !== null);
  const named = VALUE_FIELD_NAMES.find(numeric);
  if (named) return named;
  return Object.keys(sample[0] ?? {}).find((key) => !key.startsWith("_") && numeric(key)) ?? null;
};

const toTree = (node: MutableNode): FlameGraphNode => {
  const children = [...node.children.values()].map(toTree);
  return children.length
    ? { name: node.name, total: node.total, children }
    : { name: node.name, total: node.total };
};

/** Merges folded stacks (`a;b;c`) and their values into one call tree; equal paths add up. */
export const buildFoldedStackTree = (
  rows: Record<string, unknown>[],
  stackField: string,
  valueField: string | null,
): { root: FlameGraphNode | null; skipped: number } => {
  const root: MutableNode = { name: "root", total: 0, children: new Map() };
  let skipped = 0;
  rows.forEach((row) => {
    const frames = String(row?.[stackField] ?? "")
      .split(FOLDED_STACK_SEPARATOR)
      .map((frame) => frame.trim())
      .filter(Boolean);
    const value = valueField ? toNumber(row?.[valueField]) : 1;
    if (!frames.length || value === null || value <= 0) {
      skipped += 1;
      return;
    }
    root.total += value;
    let current = root;
    frames.forEach((frame) => {
      let child = current.children.get(frame);
      if (!child) {
        child = { name: frame, total: 0, children: new Map() };
        current.children.set(frame, child);
      }
      child.total += value;
      current = child;
    });
  });
  return { root: root.total > 0 ? toTree(root) : null, skipped };
};

/** The flame graph tree of the first visible query: configured columns first, else detected ones. */
export const convertFlameGraphPanelData = (panelSchema: any, data: any): FlameGraphPanelData => {
  const queryIndex = (panelSchema?.queries ?? []).findIndex((query: any) => !query?.config?.hide);
  const raw = Array.isArray(data?.[Math.max(queryIndex, 0)]) ? data[Math.max(queryIndex, 0)] : [];
  const rows = raw.filter((row: unknown) => row && typeof row === "object");
  const config = panelSchema?.config;
  const stackField = setField(config?.flame_graph_stack_field) ?? pickStackField(rows);
  const valueField = setField(config?.flame_graph_value_field) ?? pickValueField(rows, stackField);
  if (!stackField) return { root: null, stackField, valueField, skipped: rows.length };
  const { root, skipped } = buildFoldedStackTree(rows, stackField, valueField);
  return { root, stackField, valueField, skipped };
};
