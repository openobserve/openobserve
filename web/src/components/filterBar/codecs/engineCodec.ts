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

import {
  newFilterId,
  OPERATORS,
  type FilterCondition,
  type FilterConnector,
  type FilterGroup,
  type FilterNode,
  type FilterOperatorId,
} from "@/utils/query/filterBar";
import {
  fieldTypeOf,
  isPlainObject,
  isPristine,
  isTreePristine,
  makeGroup,
  makeRawNode,
  operatorFromWire,
  parsedOperator,
  rawOf,
  restoreScalar,
  stamp,
  toConnector,
  valueStrings,
  type CodecContext,
  type FilterCodec,
} from "./types";

/** The alerts V2 engine tree shared by alerts, pipelines, workflows, online evals and annotation sources. */
export interface EngineCondition {
  filterType: "condition";
  column: string;
  operator: string;
  value: unknown;
  logicalOperator: FilterConnector;
  /** Legacy flag the old UI wrote on every condition; kept as saved and never read as case-insensitive. */
  ignore_case?: boolean;
  case_insensitive?: boolean;
  values?: unknown[];
  id?: string;
}

export interface EngineGroup {
  filterType: "group";
  logicalOperator: FilterConnector;
  conditions: (EngineCondition | EngineGroup)[];
  groupId?: string;
}

/** The spelling written for an operator the user picked; an unchanged operator keeps its saved spelling. */
export const ENGINE_SPELLINGS: Partial<Record<FilterOperatorId, string>> = {
  eq: "=",
  neq: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  contains: "Contains",
  contains_ci: "Contains",
  not_contains: "NotContains",
  is_null: "is_null",
  is_not_null: "is_not_null",
  is_empty: "is_empty",
  is_not_empty: "is_not_empty",
  in: "in",
  not_in: "not_in",
  starts_with: "starts_with",
  ends_with: "ends_with",
  regex: "re_match",
  not_regex: "re_not_match",
};

export interface EngineCodecOptions {
  spellings?: Partial<Record<FilterOperatorId, string>>;
}

type SavedEngine = EngineGroup | Record<string, unknown> | unknown[] | null;

const LIST_OPERATORS = new Set<FilterOperatorId>(["in", "not_in"]);

const isV2Group = (value: unknown): value is EngineGroup =>
  isPlainObject(value) && value.filterType === "group" && Array.isArray(value.conditions);

const isV2Condition = (value: unknown): value is EngineCondition =>
  isPlainObject(value) && value.filterType === "condition";

const listValues = (value: unknown): string[] => {
  if (Array.isArray(value)) return valueStrings(value);
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return valueStrings(parsed);
    } catch {
      // Not JSON: the whole text is one value.
    }
  }
  return valueStrings(value).filter((v) => v !== "");
};

const leafLabel = (item: Record<string, unknown>): string =>
  [item.column, item.operator, item.value]
    .filter((part) => part !== undefined && part !== null && part !== "")
    .map((part) => (typeof part === "string" ? part : JSON.stringify(part)))
    .join(" ");

/** One saved leaf (V0, V1 or V2) as a condition; an operator the tree does not know stays locked. */
function parseLeaf(item: Record<string, unknown>, connector: FilterConnector): FilterNode {
  const known = operatorFromWire(item.operator ?? "=");
  if (!known || !OPERATORS[known] || known === "match_all") {
    return stamp(makeRawNode(leafLabel(item), connector), item);
  }
  const operator: FilterOperatorId =
    known === "contains" && item.case_insensitive === true ? "contains_ci" : known;
  const arity = OPERATORS[operator].arity;
  let values: string[] = [];
  if (LIST_OPERATORS.has(operator)) values = listValues(item.value);
  else if (arity !== "none") values = valueStrings(item.value).filter((v) => v !== "");
  const condition: FilterCondition = {
    kind: "condition",
    id: typeof item.id === "string" && item.id ? item.id : newFilterId(),
    connector,
    field: String(item.column ?? ""),
    operator,
    values: arity === "one" ? values.slice(0, 1) : values,
  };
  return stamp(condition, item);
}

function parseV2(group: EngineGroup, isRoot: boolean): FilterGroup {
  const items = group.conditions.map((item) => {
    if (isV2Group(item)) return parseV2(item, false);
    if (isPlainObject(item)) return parseLeaf(item, toConnector(item.logicalOperator));
    return stamp(makeRawNode(JSON.stringify(item)), item);
  });
  const id = isRoot ? "root" : (group.groupId ?? newFilterId());
  return stamp(makeGroup(items, toConnector(group.logicalOperator), id), group);
}

// A V1 group ANDs or ORs all of its items, so each item (nested groups too) takes the group's connector.
function parseV1(node: Record<string, unknown>, isRoot: boolean, connector: FilterConnector) {
  const label = Array.isArray(node.items)
    ? String(node.label ?? "and")
    : (Object.keys(node).find((key) => key === "and" || key === "or") ?? "and");
  const own = toConnector(label);
  const list = (Array.isArray(node.items) ? node.items : node[label]) as unknown[];
  const items = (Array.isArray(list) ? list : []).map((item): FilterNode => {
    if (isPlainObject(item) && (Array.isArray(item.items) || item.and || item.or)) {
      return parseV1(item, false, own);
    }
    if (isPlainObject(item)) return parseLeaf(item, own);
    return stamp(makeRawNode(JSON.stringify(item), own), item);
  });
  const id = isRoot ? "root" : newFilterId();
  return stamp(makeGroup(items, isRoot ? own : connector, id), node);
}

function parseEngine(saved: SavedEngine | undefined): FilterGroup {
  if (isV2Group(saved)) return parseV2(saved, true);
  if (Array.isArray(saved)) {
    const items = saved.map((item) =>
      isPlainObject(item) ? parseLeaf(item, "AND") : stamp(makeRawNode(JSON.stringify(item)), item),
    );
    return stamp(makeGroup(items, "AND", "root"), saved);
  }
  if (isPlainObject(saved) && (Array.isArray(saved.items) || saved.and || saved.or)) {
    return parseV1(saved, true, "AND");
  }
  return stamp(makeGroup([], "AND", "root"), saved ?? null);
}

function leafValue(
  node: FilterCondition,
  raw: Record<string, unknown> | undefined,
  context: CodecContext,
) {
  const arity = OPERATORS[node.operator].arity;
  const numeric = fieldTypeOf(context, node.field) === "number";
  if (arity === "none") return "";
  if (LIST_OPERATORS.has(node.operator)) {
    const savedNumbers = Array.isArray(raw?.value) && raw.value.some((v) => typeof v === "number");
    return node.values.map((value) => restoreScalar(value, numeric || savedNumbers));
  }
  return restoreScalar(node.values[0] ?? "", typeof raw?.value === "number");
}

const CONTAINS = new Set<FilterOperatorId | undefined>(["contains", "contains_ci"]);

// Case is the case_insensitive flag, not part of the spelling, so contains and contains_ci share one.
const sameFamily = (a: FilterOperatorId | undefined, b: FilterOperatorId) =>
  a === b || (CONTAINS.has(a) && CONTAINS.has(b));

function serializeLeaf(
  node: FilterCondition,
  context: CodecContext,
  spellings: Partial<Record<FilterOperatorId, string>>,
): EngineCondition {
  const raw = rawOf<Record<string, unknown>>(node);
  if (isPristine(node) && isV2Condition(raw)) return raw;
  const base = isV2Condition(raw) ? raw : undefined;
  const savedOperator =
    base && sameFamily(parsedOperator(node), node.operator) && typeof base.operator === "string"
      ? base.operator
      : undefined;
  const operator = savedOperator ?? spellings[node.operator] ?? node.operator;
  const out: EngineCondition = {
    ...(base ?? { filterType: "condition" }),
    filterType: "condition",
    column: node.field,
    operator,
    value: leafValue(node, raw, context),
    logicalOperator: node.connector,
  } as EngineCondition;
  if (!base) {
    out.values = [];
    out.id = node.id;
  }
  if (node.operator === "contains_ci") out.case_insensitive = true;
  else delete out.case_insensitive;
  return out;
}

// An unfilled group compiles to a dangling AND/OR in the backend SQL, so one opened mid-edit is left out.
const hasContent = (item: FilterNode): boolean =>
  item.kind !== "group" || isPristine(item) || item.items.some(hasContent);

// A locked part keeps its saved payload; only its connector can change, and a non-object item is written back as is.
function serializeRaw(item: FilterNode): EngineCondition | EngineGroup {
  const saved = rawOf<unknown>(item);
  if (!isPlainObject(saved)) return saved as EngineCondition;
  if (isV2Condition(saved) || isV2Group(saved))
    return isPristine(item) ? saved : { ...saved, logicalOperator: item.connector };
  return { filterType: "condition", ...saved, logicalOperator: item.connector } as EngineCondition;
}

function serializeGroup(
  group: FilterGroup,
  context: CodecContext,
  spellings: Partial<Record<FilterOperatorId, string>>,
  isRoot: boolean,
): EngineGroup {
  const raw = rawOf<Record<string, unknown>>(group);
  if (isTreePristine(group) && isV2Group(raw)) return raw;
  const conditions = group.items.filter(hasContent).map((item): EngineCondition | EngineGroup => {
    if (item.kind === "group") return serializeGroup(item, context, spellings, false);
    if (item.kind === "condition") return serializeLeaf(item, context, spellings);
    return serializeRaw(item);
  });
  if (isV2Group(raw)) {
    return { ...raw, logicalOperator: isRoot ? raw.logicalOperator : group.connector, conditions };
  }
  return {
    filterType: "group",
    logicalOperator: group.connector,
    conditions,
    groupId: isRoot ? newFilterId() : group.id,
  };
}

/** The V2 engine tree; V0 lists and V1 `{and|or}` / `{label, items}` trees load and are written back as V2 once edited. */
export function engineCodec(options: EngineCodecOptions = {}): FilterCodec<SavedEngine> {
  const spellings = { ...ENGINE_SPELLINGS, ...options.spellings };
  return {
    parse: (saved) => parseEngine(saved),
    serialize: (tree, context) => {
      if (isTreePristine(tree)) return rawOf<SavedEngine>(tree) ?? null;
      return serializeGroup(tree, context, spellings, true);
    },
  };
}
