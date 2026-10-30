// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { toRaw } from "vue";
import {
  newFilterId,
  type FilterCondition,
  type FilterConnector,
  type FilterField,
  type FilterGroup,
  type FilterNode,
  type FilterOperatorId,
  type FilterRawNode,
} from "@/utils/query/filterBar";

export interface CodecContext {
  fields: FilterField[];
}

/** Reads a page's saved filter into the tree and writes the tree back in that same format. */
export interface FilterCodec<T = unknown> {
  /** Never throws: anything it cannot show becomes a locked node that is saved back as loaded. */
  parse: (saved: T | null | undefined, context: CodecContext) => FilterGroup;
  serialize: (tree: FilterGroup, context: CodecContext) => T;
}

/** What the user can change on a node; a node whose state still matches its stamp is written back as loaded. */
export const nodeSig = (node: FilterNode): string => {
  if (node.kind === "group")
    return JSON.stringify(["g", node.connector, node.items.map((i) => i.id)]);
  if (node.kind === "raw") return JSON.stringify(["r", node.connector]);
  return JSON.stringify(["c", node.field, node.operator, node.values, node.connector]);
};

/** Records the saved payload a node came from; call after the node (and a group's items) is final. */
export function stamp<T extends FilterNode>(node: T, raw: unknown): T {
  node.meta = { raw, sig: nodeSig(node) };
  return node;
}

/** Stamps a node and everything under it that has no stamp yet, for formats parsed whole. */
export function stampTree<T extends FilterNode>(node: T, raw: unknown): T {
  if (node.kind === "group") node.items.forEach((item) => item.meta || stampTree(item, null));
  return stamp(node, raw);
}

export const isPristine = (node: FilterNode): boolean =>
  Boolean(node.meta) && node.meta!.sig === nodeSig(node);

/** The node and everything under it is exactly as loaded. */
export const isTreePristine = (node: FilterNode): boolean =>
  isPristine(node) && (node.kind !== "group" || node.items.every(isTreePristine));

/** The payload a node was parsed from, unwrapped from any reactive proxy. */
export const rawOf = <T = unknown>(node: FilterNode): T | undefined =>
  node.meta ? (toRaw(node.meta.raw) as T) : undefined;

/** The operator a node was parsed with, so a codec can keep the saved spelling while it is unchanged. */
export const parsedOperator = (node: FilterCondition): FilterOperatorId | undefined => {
  if (!node.meta) return undefined;
  const state = JSON.parse(node.meta.sig) as [string, string, FilterOperatorId];
  return state[2];
};

/** The field a node was parsed with. */
export const parsedField = (node: FilterCondition): string | undefined => {
  if (!node.meta) return undefined;
  return (JSON.parse(node.meta.sig) as [string, string])[1];
};

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const makeGroup = (
  items: FilterNode[],
  connector: FilterConnector = "AND",
  id: string = newFilterId(),
): FilterGroup => ({ kind: "group", id, connector, items });

export const makeRawNode = (
  label: string,
  connector: FilterConnector = "AND",
  sql?: string,
): FilterRawNode => ({
  kind: "raw",
  id: newFilterId(),
  connector,
  label,
  ...(sql === undefined ? {} : { sql }),
});

export const toConnector = (value: unknown): FilterConnector =>
  String(value ?? "AND").toUpperCase() === "OR" ? "OR" : "AND";

/** A saved value as the strings a chip shows; null and undefined are no value. */
export const valueStrings = (value: unknown): string[] => {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? v : String(v)));
  return [typeof value === "string" ? value : String(value)];
};

const NUMBER_PATTERN = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;

/** Writes a numeric string back as a number where the saved value (or the field) was numeric. */
export const restoreScalar = (value: string, wasNumber: boolean): string | number =>
  wasNumber && NUMBER_PATTERN.test(value.trim()) ? Number(value) : value;

export const fieldTypeOf = (context: CodecContext, name: string) =>
  context.fields.find((field) => field.name === name)?.type ?? "string";

export const fieldPayload = (context: CodecContext, name: string): unknown =>
  context.fields.find((field) => field.name === name)?.payload;

// Normalised: lower case with spaces and underscores dropped, so "Not Contains", "NotContains" and "not_contains" meet.
const WIRE_OPERATORS: Record<string, FilterOperatorId> = {
  "=": "eq",
  "==": "eq",
  "!=": "neq",
  "<>": "neq",
  ">": "gt",
  ">=": "gte",
  "<": "lt",
  "<=": "lte",
  eq: "eq",
  equals: "eq",
  ne: "neq",
  neq: "neq",
  notequals: "neq",
  gt: "gt",
  gte: "gte",
  lt: "lt",
  lte: "lte",
  contains: "contains",
  strmatch: "contains",
  strmatchignorecase: "contains_ci",
  notcontains: "not_contains",
  startswith: "starts_with",
  endswith: "ends_with",
  in: "in",
  notin: "not_in",
  rematch: "regex",
  regex: "regex",
  renotmatch: "not_regex",
  notregex: "not_regex",
  isnull: "is_null",
  isnotnull: "is_not_null",
  isempty: "is_empty",
  isnotempty: "is_not_empty",
  matchall: "match_all",
};

/** The tree operator for any spelling the app or the backend saves; null when unknown. */
export const operatorFromWire = (operator: unknown): FilterOperatorId | null => {
  if (typeof operator !== "string") return null;
  const trimmed = operator.trim();
  if (Object.hasOwn(WIRE_OPERATORS, trimmed)) return WIRE_OPERATORS[trimmed];
  const key = trimmed.toLowerCase().replace(/[\s_]/g, "");
  return Object.hasOwn(WIRE_OPERATORS, key) ? WIRE_OPERATORS[key] : null;
};

/** Every condition of the tree in order; locked parts and groups are skipped. */
export const leafConditions = (node: FilterNode): FilterCondition[] => {
  if (node.kind === "condition") return [node];
  if (node.kind === "raw") return [];
  return node.items.flatMap(leafConditions);
};
