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
        const column = item.column || "field";
        const operator = item.operator || "=";
        const value =
          item.value !== undefined && item.value !== null && item.value !== ""
            ? `'${item.value}'`
            : "''";
        conditionStr = `${column} ${operator} ${value}`;
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
    const column = node.column || "field";
    const operator = node.operator || "=";
    const value =
      node.value !== undefined && node.value !== null && node.value !== ""
        ? `'${node.value}'`
        : "''";
    return `${column} ${operator} ${value}`;
  }

  // V0 Format: Array
  if (Array.isArray(node)) {
    return node
      .filter((c: any) => c.column && c.operator)
      .map((c: any) => {
        const column = c.column || "field";
        const operator = c.operator || "=";
        const value =
          c.value !== undefined && c.value !== null && c.value !== "" ? `'${c.value}'` : "''";
        return `${column} ${operator} ${value}`;
      })
      .join(" and ");
  }

  return "";
};

// Preview truncated to `maxLength` (default 20, matching the pipeline node card).
export const getTruncatedConditions = (conditionData: any, maxLength = 20): string => {
  const text = buildConditionPreview(conditionData);
  return text.length > maxLength ? text.substring(0, maxLength) + "..." : text;
};
