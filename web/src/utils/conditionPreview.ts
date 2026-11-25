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

// Human-readable preview of a condition/filter rule, shared by the pipeline and
// workflow condition nodes (canvas card + Run-From labels) so they never drift.
// Handles the V2 group format ({filterType:"group", conditions:[...]}), the V1
// backend formats (and/or/not, items), a single condition, and the V0 array.

import { isUnaryOperator, unaryOperatorText } from "@/utils/alerts/conditionsFormatter";

const READABLE_OPERATORS: Record<string, string> = {
  re_match: "matches regex",
  re_not_match: "does not match regex",
};

// Every spelling the backend reads as an extended operator, lower-cased with `_` for spaces.
const EXTENDED_OPERATORS = new Set([
  "in",
  "not_in",
  "starts_with",
  "ends_with",
  "re_match",
  "regex",
  "re_not_match",
  "not_regex",
]);

// The backend honours `case_insensitive` on every operator but legacy `ignore_case` only off the extended ones.
const ignoresCase = (item: any, spelled: string): boolean =>
  item.case_insensitive === true ||
  (item.ignore_case === true && !EXTENDED_OPERATORS.has(spelled.toLowerCase().replace(/ /g, "_")));

const operatorText = (item: any): string => {
  const spelled = String(item.operator || "=");
  const operator = READABLE_OPERATORS[spelled.toLowerCase()] ?? spelled;
  return ignoresCase(item, spelled) ? `${operator} (ignore case)` : operator;
};

const leafPreview = (item: any): string => {
  const column = item.column || "field";
  if (isUnaryOperator(item.operator)) {
    return `${column} ${unaryOperatorText(item.operator)}`;
  }
  const operator = operatorText(item);
  if (Array.isArray(item.value)) {
    return `${column} ${operator} (${item.value.map((v: unknown) => `'${v}'`).join(", ")})`;
  }
  const value =
    item.value !== undefined && item.value !== null && item.value !== "" ? `'${item.value}'` : "''";
  return `${column} ${operator} ${value}`;
};

export const buildConditionPreview = (node: any): string => {
  if (!node) return "";

  // V2 Format: Group
  if (node.filterType === "group" && node.conditions && Array.isArray(node.conditions)) {
    if (node.conditions.length === 0) return "";

    const parts: string[] = [];
    node.conditions.forEach((item: any, index: number) => {
      let conditionStr = "";

      if (item.filterType === "group") {
        const nestedPreview = buildConditionPreview(item);
        if (nestedPreview) conditionStr = `(${nestedPreview})`;
      } else if (item.filterType === "condition") {
        conditionStr = leafPreview(item);
      }

      if (index > 0 && item.logicalOperator) {
        parts.push(`${item.logicalOperator.toLowerCase()} ${conditionStr}`);
      } else {
        parts.push(conditionStr);
      }
    });

    return parts.join(" ");
  }

  // V1 Backend Format: OR node
  if (node.or && Array.isArray(node.or)) {
    return node.or
      .map((item: any) => {
        const nested = buildConditionPreview(item);
        return nested ? `(${nested})` : "";
      })
      .filter(Boolean)
      .join(" or ");
  }

  // V1 Backend Format: AND node
  if (node.and && Array.isArray(node.and)) {
    return node.and
      .map((item: any) => {
        const nested = buildConditionPreview(item);
        return nested ? `(${nested})` : "";
      })
      .filter(Boolean)
      .join(" and ");
  }

  // V1 Backend Format: NOT node
  if (node.not) {
    const nested = buildConditionPreview(node.not);
    return nested ? `not (${nested})` : "";
  }

  // V1 Frontend Format: items array
  if (node.items && Array.isArray(node.items)) {
    const operator = node.label?.toLowerCase() || "and";
    return node.items
      .map((item: any) => buildConditionPreview(item))
      .filter(Boolean)
      .join(` ${operator} `);
  }

  // Single condition
  if (node.column && node.operator) {
    return leafPreview(node);
  }

  // V0 Format: Array
  if (Array.isArray(node)) {
    return node
      .filter((c: any) => c.column && c.operator)
      .map(leafPreview)
      .join(" and ");
  }

  return "";
};

export const getTruncatedConditions = (conditionData: any, maxLength = 20): string => {
  const text = buildConditionPreview(conditionData);
  return text.length > maxLength ? text.substring(0, maxLength) + "..." : text;
};
