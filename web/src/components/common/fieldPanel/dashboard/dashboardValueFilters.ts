// Copyright 2026 OpenObserve Inc.

import { buildCondition } from "@/utils/dashboard/dashboardAutoQueryBuilder";
import {
  hasVariable,
  joinPanelListText,
  splitPanelListText,
  type DashboardColumn,
  type DashboardFilterCondition,
  type DashboardFilterGroup,
} from "@/components/filterBar/codecs/dashboardFilterCodec";
import type { FilterConnector } from "@/utils/query/filterBar";
import type { ActiveFilterValues } from "../activeFilterValues";
import { isNullValue, MISSING_VALUE_KEY } from "../valueFilterExpression";
import type { DashboardPanelQuery, DashboardPanelState } from "./dashboardPanelState";

type FilterNode = DashboardFilterCondition | DashboardFilterGroup;

export interface ValueFilterColumn {
  field: string;
  streamAlias?: string;
}

const isGroup = (node: FilterNode): node is DashboardFilterGroup => node.filterType === "group";

const columnOf = (condition: DashboardFilterCondition): DashboardColumn =>
  typeof condition.column === "string" ? { field: condition.column } : condition.column;

const sameColumn = (condition: DashboardFilterCondition, column: ValueFilterColumn) => {
  const own = columnOf(condition);
  return own.field === column.field && (own.streamAlias ?? undefined) === column.streamAlias;
};

const NULL_OPERATORS = ["Is Null", "Is Not Null"];

// A whole value the dashboard substitutes, bare or single-quoted, as the codec reads an IN text.
const PLACEHOLDER =
  /^'?(\{\{\s*[\w-]+\s*(:\s*[a-zA-Z]+\s*)?\}\}|\$\{\s*[\w-]+\s*(:\s*[a-zA-Z]+\s*)?\}|\$[\w-]+)'?$/;

// The codec never writes a variable into a list leaf, so only a condition's IN text can hold one.
const isVariableLeaf = (condition: DashboardFilterCondition) =>
  condition.type !== "list" &&
  splitPanelListText(condition.value).some((value) => PLACEHOLDER.test(value));

// Only the leaves the values list writes are its own: a list, an IN / NOT IN, or an Is Null / Is Not Null condition, never one on a `$variable`.
const isValueLeaf = (condition: DashboardFilterCondition) =>
  (condition.type === "list" ||
    condition.operator === "IN" ||
    condition.operator === "NOT IN" ||
    NULL_OPERATORS.includes(condition.operator ?? "")) &&
  !isVariableLeaf(condition);

const leafValues = (condition: DashboardFilterCondition): string[] => {
  if (condition.type === "list") return (condition.values ?? []).map(String);
  if (NULL_OPERATORS.includes(condition.operator ?? "")) return [MISSING_VALUE_KEY];
  return splitPanelListText(condition.value);
};

const isExcludeLeaf = (condition: DashboardFilterCondition) =>
  condition.operator === "NOT IN" || condition.operator === "Is Not Null";

const leavesOf = (group: DashboardFilterGroup): DashboardFilterCondition[] =>
  group.conditions.flatMap((node) => (isGroup(node) ? leavesOf(node) : [node]));

/** Values each column's IN and NOT IN leaves hold at any depth, keyed by the column's row key. */
export const collectValueFilters = (
  filter: DashboardFilterGroup | undefined,
  columns: { key: string; column: ValueFilterColumn }[],
): ActiveFilterValues => {
  const include: Record<string, string[]> = {};
  const exclude: Record<string, string[]> = {};
  const leaves = filter ? leavesOf(filter).filter(isValueLeaf) : [];
  for (const { key, column } of columns) {
    for (const leaf of leaves) {
      if (!sameColumn(leaf, column)) continue;
      const target = isExcludeLeaf(leaf) ? exclude : include;
      // A null-safe exclusion repeats the included null, which is still one picked value.
      target[key] = [...new Set([...(target[key] ?? []), ...leafValues(leaf)])];
    }
  }
  return { include, exclude };
};

const includeLeaf = (column: ValueFilterColumn, values: string[]): DashboardFilterCondition => ({
  type: "list",
  values: [...values],
  column: { ...column },
  operator: null,
  value: null,
  logicalOperator: "AND",
  filterType: "condition",
});

// The SQL builder pastes an IN text holding `$` or `{{` verbatim, so picked literals are SQL-quoted there.
const pickedListText = (values: string[]) =>
  values.some(hasVariable)
    ? values.map((value) => `'${value.replace(/'/g, "''")}'`).join(",")
    : joinPanelListText(values);

const excludeLeaf = (column: ValueFilterColumn, values: string[]): DashboardFilterCondition => ({
  type: "condition",
  values: [],
  column: { ...column },
  operator: "NOT IN",
  value: pickedListText(values),
  logicalOperator: "AND",
  filterType: "condition",
});

const nullLeaf = (
  column: ValueFilterColumn,
  operator: "Is Null" | "Is Not Null",
  logicalOperator: FilterConnector,
): DashboardFilterCondition => ({
  type: "condition",
  values: [],
  column: { ...column },
  operator,
  value: null,
  logicalOperator,
  filterType: "condition",
});

// A row never equals the text 'null', so a picked null is a null test; with other values it is ORed in its own group so the flat AND chain keeps its meaning.
const includeNodes = (column: ValueFilterColumn, include: string[]): FilterNode[] => {
  const values = include.filter((value) => !isNullValue(value));
  if (values.length === include.length) return values.length ? [includeLeaf(column, values)] : [];
  if (!values.length) return [nullLeaf(column, "Is Null", "AND")];
  return [
    {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [includeLeaf(column, values), nullLeaf(column, "Is Null", "OR")],
    },
  ];
};

// `f NOT IN (...)` is unknown on a null row, so with null included the exclusion lets null through.
const excludeNodes = (
  column: ValueFilterColumn,
  exclude: string[],
  nullIncluded: boolean,
): FilterNode[] => {
  const values = exclude.filter((value) => !isNullValue(value));
  const leaf = values.length ? excludeLeaf(column, values) : null;
  const notIn: FilterNode | null =
    leaf && nullIncluded
      ? {
          filterType: "group",
          logicalOperator: "AND",
          conditions: [leaf, nullLeaf(column, "Is Null", "OR")],
        }
      : leaf;
  return [
    ...(notIn ? [notIn] : []),
    ...(values.length < exclude.length ? [nullLeaf(column, "Is Not Null", "AND")] : []),
  ];
};

// Included and excluded values sit side by side, the excludes ANDed onto the includes.
const valueNodes = (
  column: ValueFilterColumn,
  include: string[],
  exclude: string[],
): FilterNode[] => [
  ...includeNodes(column, include),
  ...excludeNodes(column, exclude, include.some(isNullValue)),
];

const ownsLeaf = (column: ValueFilterColumn, node: FilterNode) =>
  !isGroup(node) && isValueLeaf(node) && sameColumn(node, column);

// A group of nothing but the column's value leaves is the one written for an included null, so it is owned whole.
const ownedBy = (column: ValueFilterColumn) => (node: FilterNode) =>
  ownsLeaf(column, node) ||
  (isGroup(node) &&
    node.conditions.length > 0 &&
    node.conditions.every((child) => ownsLeaf(column, child)));

// Depth-first, so the first match is the one a reader of the filter sees first.
const findOwned = (
  group: DashboardFilterGroup,
  owned: (node: FilterNode) => boolean,
): { parent: DashboardFilterGroup; index: number } | null => {
  for (const [index, node] of group.conditions.entries()) {
    if (owned(node)) return { parent: group, index };
    if (isGroup(node)) {
      const found = findOwned(node, owned);
      if (found) return found;
    }
  }
  return null;
};

// Ownership is decided before a group is touched, so an owned group goes whole; a group left empty by the drop goes too.
const dropOwned = (
  group: DashboardFilterGroup,
  owned: (node: FilterNode) => boolean,
  keep: FilterNode | null,
) => {
  group.conditions = group.conditions.filter((node) => {
    if (node === keep) return true;
    if (owned(node)) return false;
    if (!isGroup(node) || !node.conditions.length) return true;
    dropOwned(node, owned, keep);
    return node.conditions.length > 0;
  });
};

/** Replaces the column's value leaves with one for the included and one for the excluded values, where the first of them sat in the filter tree. */
export const writeValueFilter = (
  query: DashboardPanelQuery,
  column: ValueFilterColumn,
  include: string[],
  exclude: string[],
) => {
  if (!query.fields.filter) {
    query.fields.filter = { filterType: "group", logicalOperator: "AND", conditions: [] };
  }
  const root = query.fields.filter;
  const owned = ownedBy(column);
  const at = findOwned(root, owned);
  const nodes = valueNodes(column, include, exclude);
  if (!nodes.length) return;
  if (!at) {
    root.conditions.push(...nodes);
    return;
  }
  // The surviving node is the one read back from the tree, so it compares equal through a reactive proxy.
  const first = at.parent.conditions[at.index];
  nodes[0].logicalOperator = first.logicalOperator;
  dropOwned(root, owned, first);
  at.parent.conditions.splice(at.parent.conditions.indexOf(first), 1, ...nodes);
};

export const removeValueFilter = (query: DashboardPanelQuery, column: ValueFilterColumn) => {
  if (query.fields.filter) dropOwned(query.fields.filter, ownedBy(column), null);
};

const mentionsVariable = (condition: DashboardFilterCondition) =>
  [condition.value, ...(condition.values ?? [])].some(
    (value) => typeof value === "string" && hasVariable(value),
  );

// A field's own conditions would narrow its counts to the picked values; a `$variable` is only substituted when the panel runs.
const pruneFilter = (group: DashboardFilterGroup, fieldName: string): DashboardFilterGroup => ({
  ...group,
  conditions: group.conditions.flatMap((node): FilterNode[] => {
    if (isGroup(node)) return [pruneFilter(node, fieldName)];
    if (columnOf(node).field === fieldName || mentionsVariable(node)) return [];
    return [node];
  }),
});

/** The builder filter as a WHERE fragment for one field's values query, or "" when it has none. */
export const builderWhereFor = (panel: DashboardPanelState, fieldName: string): string => {
  const filter = panel.data.queries[panel.layout.currentQueryIndex]?.fields?.filter;
  if (!filter?.conditions?.length) return "";
  return buildCondition(pruneFilter(filter, fieldName), panel);
};
