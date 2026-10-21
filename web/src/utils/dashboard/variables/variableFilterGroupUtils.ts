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

export type FilterLogicalOperator = "AND" | "OR";

/** One `{ name, operator, value }` row of the legacy `query_data.filter` array. */
export interface LegacyVariableFilter {
  name?: string;
  operator?: string;
  value?: string;
}

/** A leaf in the same shape the panel builder saves, so the backend `PanelFilter` type parses it. */
export interface VariableFilterCondition {
  filterType: "condition";
  type: "condition";
  column: { field?: string | null; streamAlias?: string | null } | null;
  operator?: string | null;
  value?: string | null;
  values: string[];
  logicalOperator: string;
}

export interface VariableFilterGroup {
  filterType: "group";
  logicalOperator: string;
  conditions: VariableFilterNode[];
}

export type VariableFilterNode = VariableFilterCondition | VariableFilterGroup;

export interface VariableFilterQueryData {
  filter?: LegacyVariableFilter[] | null;
  filter_group?: VariableFilterGroup | null;
}

/** Operators that take no value. */
export const FILTER_OPERATORS_WITHOUT_VALUE = ["Is Null", "Is Not Null"];

const logicalOperatorOf = (value: unknown): FilterLogicalOperator =>
  String(value ?? "").toUpperCase() === "OR" ? "OR" : "AND";

export const createFilterCondition = (
  logicalOperator: FilterLogicalOperator = "AND",
): VariableFilterCondition => ({
  filterType: "condition",
  type: "condition",
  column: { field: "" },
  operator: "=",
  value: "",
  values: [],
  logicalOperator,
});

export const createFilterGroup = (
  logicalOperator: FilterLogicalOperator = "AND",
  conditions: VariableFilterNode[] = [createFilterCondition()],
): VariableFilterGroup => ({
  filterType: "group",
  logicalOperator,
  conditions,
});

const isGroupLike = (node: any): boolean =>
  node?.filterType === "group" || (Array.isArray(node?.conditions) && !node?.column);

const normalizeCondition = (node: any): VariableFilterCondition => ({
  filterType: "condition",
  type: "condition",
  column: { field: String(node?.column?.field ?? node?.name ?? "") },
  operator: node?.operator ?? "=",
  value: node?.value == null ? "" : String(node.value),
  values: Array.isArray(node?.values) ? [...node.values] : [],
  logicalOperator: logicalOperatorOf(node?.logicalOperator),
});

/** A deep copy with every key the backend's untagged `PanelFilter` needs to parse. */
export const normalizeFilterGroup = (group: any): VariableFilterGroup => ({
  filterType: "group",
  logicalOperator: logicalOperatorOf(group?.logicalOperator),
  conditions: (Array.isArray(group?.conditions) ? group.conditions : []).map((node: any) =>
    isGroupLike(node) ? normalizeFilterGroup(node) : normalizeCondition(node),
  ),
});

/** The flat legacy array read as one AND group, like the panel schema migration does. */
export const legacyFiltersToGroup = (
  filters?: LegacyVariableFilter[] | null,
): VariableFilterGroup =>
  createFilterGroup(
    "AND",
    (filters ?? []).map((filter) => normalizeCondition({ ...filter, logicalOperator: "AND" })),
  );

/** The variable's filters as a group: `filter_group` wins, else the legacy array. */
export const getVariableFilterGroup = (
  queryData?: VariableFilterQueryData | null,
): VariableFilterGroup =>
  queryData?.filter_group
    ? normalizeFilterGroup(queryData.filter_group)
    : legacyFiltersToGroup(queryData?.filter);

/** True when the group joins any two siblings with OR, at any depth. */
export const filterGroupHasOr = (group?: VariableFilterGroup | null): boolean =>
  (group?.conditions ?? []).some(
    (node, index) =>
      (index > 0 && logicalOperatorOf(node.logicalOperator) === "OR") ||
      (node.filterType === "group" && filterGroupHasOr(node)),
  );

export const filterGroupHasNesting = (group?: VariableFilterGroup | null): boolean =>
  (group?.conditions ?? []).some((node) => node.filterType === "group");

/** A single AND-joined list of plain conditions, which the legacy `filter` array can hold exactly. */
export const isLegacyCompatibleFilterGroup = (group?: VariableFilterGroup | null): boolean =>
  !filterGroupHasNesting(group) && !filterGroupHasOr(group);

export const conditionToLegacyFilter = (
  condition: VariableFilterCondition,
): LegacyVariableFilter => ({
  name: condition.column?.field ?? "",
  operator: condition.operator ?? "",
  value: condition.value ?? "",
});

/** Every leaf condition, depth first. */
export const getFilterGroupConditions = (
  group?: VariableFilterGroup | null,
): VariableFilterCondition[] =>
  (group?.conditions ?? []).flatMap((node) =>
    node.filterType === "group" ? getFilterGroupConditions(node) : [node],
  );

/** AND-only groups save as the legacy `filter` array, anything with OR or nesting as `filter_group`. */
export const filterGroupToQueryData = (
  group?: VariableFilterGroup | null,
): { filter: LegacyVariableFilter[] } | { filter_group: VariableFilterGroup } => {
  const normalized = normalizeFilterGroup(group);
  if (isLegacyCompatibleFilterGroup(normalized)) {
    return {
      filter: (normalized.conditions as VariableFilterCondition[]).map(conditionToLegacyFilter),
    };
  }
  return { filter_group: normalized };
};

/** Every filter value of a variable, from both saved shapes, for `$var` dependency scans. */
export const getVariableFilterValues = (queryData?: VariableFilterQueryData | null): string[] => [
  ...(queryData?.filter ?? []).map((filter: any) => String(filter?.filter || filter?.value || "")),
  ...getFilterGroupConditions(
    queryData?.filter_group ? normalizeFilterGroup(queryData.filter_group) : null,
  ).map((condition) => condition.value ?? ""),
];

export type VariableFilterIssue = "field" | "operator" | "promqlOperator" | "value";

/** What a condition still lacks; the form schema and the chip error state share it. */
export const getFilterConditionIssues = (
  condition: VariableFilterCondition,
  promqlOperators?: readonly string[],
): VariableFilterIssue[] => {
  const issues: VariableFilterIssue[] = [];
  const operator = String(condition.operator ?? "").trim();
  if (!String(condition.column?.field ?? "").trim()) issues.push("field");
  if (!operator) issues.push("operator");
  if (promqlOperators && operator && !promqlOperators.includes(operator))
    issues.push("promqlOperator");
  if (!FILTER_OPERATORS_WITHOUT_VALUE.includes(operator) && !String(condition.value ?? "").length)
    issues.push("value");
  return issues;
};

/** Path of a node under the group, e.g. [1, 0] → `conditions[1].conditions[0]`. */
export const filterNodePath = (base: string, indexes: number[]): string =>
  indexes.reduce((path, index) => `${path}.conditions[${index}]`, base);

/** Walks the group in order and joins each rendered leaf with its operator; subgroups are parenthesised. */
export const renderFilterGroup = (
  group: VariableFilterGroup,
  renderCondition: (condition: VariableFilterCondition) => string,
  wrap = false,
): string => {
  const parts: string[] = [];
  for (const node of group?.conditions ?? []) {
    const text =
      node.filterType === "group"
        ? renderFilterGroup(node, renderCondition, true)
        : renderCondition(node);
    if (!text) continue;
    parts.push(parts.length ? `${logicalOperatorOf(node.logicalOperator)} ${text}` : text);
  }
  const joined = parts.join(" ");
  return wrap && parts.length > 1 ? `(${joined})` : joined;
};
