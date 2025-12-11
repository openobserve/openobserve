/**
 * Shared utility for formatting V2 conditions into strings
 * Used by both UI preview and SQL WHERE clause generation
 */

import type { StreamFieldsMap } from './alertQueryBuilder';

export interface FormatOptions {
  // Whether to generate SQL format (uppercase AND/OR, SQL operators) or display format (lowercase)
  sqlMode?: boolean;
  // Whether to add WHERE prefix (only for SQL mode)
  addWherePrefix?: boolean;
  // Whether to format values (add quotes for strings, handle LIKE operators)
  formatValues?: boolean;
  // Stream fields map for type checking (required if formatValues is true)
  streamFieldsMap?: StreamFieldsMap;
}

/**
 * Check if an item is a group (has conditions array and filterType)
 */
function isGroup(item: any): boolean {
  return item && item.filterType === 'group' && Array.isArray(item.conditions);
}

/**
 * Format a condition value based on its type and operator
 */
function formatValue(
  column: string,
  operator: string,
  value: any,
  streamFieldsMap?: StreamFieldsMap,
): string {
  // If no formatting requested, return as-is with quotes
  if (!streamFieldsMap) {
    return value !== undefined && value !== null && value !== ''
      ? `'${value}'`
      : "''";
  }

  // Check if column is Int64 or operator is contains/not_contains - don't add quotes
  const shouldNotQuote =
    streamFieldsMap[column]?.type === "Int64" ||
    operator === "contains" ||
    operator === "not_contains" ||
    operator === "Contains" ||
    operator === "NotContains";

  return shouldNotQuote ? value : `'${value}'`;
}

/**
 * Get formatted condition string based on operator
 */
function getFormattedCondition(
  column: string,
  operator: string,
  value: string,
  sqlMode: boolean = false,
): string {
  let condition = "";
  const op = operator.toLowerCase();

  switch (op) {
    case "=":
    case "<>":
    case "<":
    case ">":
    case "<=":
    case ">=":
      condition = `${column} ${operator} ${value}`;
      break;
    case "contains":
      condition = sqlMode
        ? `${column} LIKE '%${value}%'`
        : `${column} ${operator} ${value}`;
      break;
    case "not_contains":
    case "notcontains":
      condition = sqlMode
        ? `${column} NOT LIKE '%${value}%'`
        : `${column} ${operator} ${value}`;
      break;
    default:
      condition = `${column} ${operator} ${value}`;
      break;
  }
  return condition;
}

/**
 * Build condition string from V2 format group/condition structure
 * This is the core logic shared between UI preview and SQL generation
 */
export function buildConditionsString(
  group: any,
  options: FormatOptions = {},
): string {
  const {
    sqlMode = false,
    addWherePrefix = false,
    formatValues = false,
    streamFieldsMap,
  } = options;

  // Parse group/condition nodes recursively
  const parseNode = (node: any): string => {
    if (!node) return "";

    // V2 Group: filterType === 'group'
    if (node.filterType === 'group') {
      if (!Array.isArray(node.conditions) || node.conditions.length === 0) return "";

      const parts: string[] = [];

      node.conditions.forEach((item: any, index: number) => {
        let conditionStr = '';

        // Nested group
        if (isGroup(item)) {
          const nestedResult = parseNode(item);
          if (nestedResult) {
            conditionStr = `(${nestedResult})`;
          }
        }
        // Single condition (filterType === 'condition')
        else if (item.filterType === 'condition' && item.column && item.operator && item.value !== undefined) {
          const formattedValue = formatValues
            ? formatValue(item.column, item.operator, item.value, streamFieldsMap)
            : (item.value !== undefined && item.value !== null && item.value !== ''
                ? `'${item.value}'`
                : "''");

          conditionStr = getFormattedCondition(
            item.column,
            item.operator,
            formattedValue,
            sqlMode,
          );
        }

        // Add logical operator before condition (except for first condition at index 0)
        if (conditionStr) {
          if (index > 0 && item.logicalOperator) {
            const operator = sqlMode
              ? item.logicalOperator.toUpperCase()
              : item.logicalOperator.toLowerCase();
            parts.push(`${operator} ${conditionStr}`);
          } else {
            parts.push(conditionStr);
          }
        }
      });

      // Join all parts with spaces (operators are already included)
      return parts.join(' ');
    }

    // V2 Single condition at root level
    if (node.filterType === 'condition' && node.column && node.operator && node.value !== undefined) {
      const formattedValue = formatValues
        ? formatValue(node.column, node.operator, node.value, streamFieldsMap)
        : (node.value !== undefined && node.value !== null && node.value !== ''
            ? `'${node.value}'`
            : "''");

      return getFormattedCondition(
        node.column,
        node.operator,
        formattedValue,
        sqlMode,
      );
    }

    return "";
  };

  const result = parseNode(group);

  // Add WHERE prefix if requested (only for SQL mode)
  if (addWherePrefix && sqlMode && result.trim().length > 0) {
    return "WHERE " + result;
  }

  return result;
}
