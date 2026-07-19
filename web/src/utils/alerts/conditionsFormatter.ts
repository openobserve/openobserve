/**
 * Shared utility for formatting V2 condition structures into strings. Used by:
 * 1. UI Preview (FilterGroup.vue) - human-readable display of conditions
 * 2. SQL Generation (alertQueryBuilder.ts) - WHERE clauses in SQL queries
 *
 * V2 format:
 *   Group:     { filterType: 'group', logicalOperator, groupId, conditions: [...] }
 *   Condition: { filterType: 'condition', column, operator, value, logicalOperator, id }
 *
 * KEY INSIGHT — logical operator placement:
 * The group's logicalOperator is NOT used when building the WHERE clause; it is
 * only a UI default when adding new items to that group. Each item (condition or
 * nested group) carries its own logicalOperator, which determines the operator
 * that appears BEFORE that item (the first item at index 0 has no operator prefix).
 *
 * Example conditions:
 *   [ { column: 'age',    operator: '>', value: 30,       logicalOperator: 'AND' }, // index 0: no prefix
 *     { column: 'city',   operator: '=', value: 'NYC',    logicalOperator: 'AND' }, // AND before
 *     { column: 'status', operator: '=', value: 'active', logicalOperator: 'OR'  } ]// OR before
 *   → "age > 30 AND city = 'NYC' OR status = 'active'"
 *
 * Display mode (sqlMode=false): lowercase and/or, `contains` kept as-is, all values quoted.
 * SQL mode (sqlMode=true): uppercase AND/OR, `contains` → LIKE, type-aware quoting
 * (Int64 unquoted, String quoted), optional WHERE prefix.
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
 *
 * @param item - The item to check
 * @returns true if item is a group, false otherwise
 */
function isGroup(item: any): boolean {
  return item && item.filterType === 'group' && Array.isArray(item.conditions);
}

/**
 * Format a condition value based on its type and operator
 *
 * QUOTE LOGIC:
 * - Int64 types: NO quotes (e.g., age > 30)
 * - String types: WITH quotes (e.g., city = 'NYC')
 * - Contains operators: NO quotes (LIKE handles it)
 * - Unknown type (no streamFieldsMap): DEFAULT with quotes
 *
 * @param column - The column name
 * @param operator - The comparison operator
 * @param value - The raw value to format
 * @param streamFieldsMap - Optional map of stream fields with type information
 * @returns Formatted value string with or without quotes
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
    streamFieldsMap[column]?.type === "Int64" ||  // Numeric types don't need quotes in SQL
    operator === "contains" ||                     // LIKE operator handles quoting
    operator === "not_contains" ||
    operator === "Contains" ||
    operator === "NotContains";

  return shouldNotQuote ? value : `'${value}'`;
}

/**
 * Get formatted condition string based on operator
 *
 * OPERATOR TRANSLATIONS:
 * - Standard operators (=, <>, <, >, <=, >=): used as-is
 * - contains: in SQL mode becomes "LIKE '%value%'", in display mode stays "contains"
 * - not_contains: in SQL mode becomes "NOT LIKE '%value%'", in display mode stays as-is
 *
 * @param column - The column name
 * @param operator - The comparison operator
 * @param value - The already-formatted value string
 * @param sqlMode - Whether to use SQL syntax (true) or display syntax (false)
 * @returns Complete condition string (e.g., "age > 30" or "name LIKE '%john%'")
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
      // Standard comparison operators - use as-is
      condition = `${column} ${operator} ${value}`;
      break;
    case "contains":
      // SQL mode: convert to LIKE operator
      // Display mode: keep as "contains"
      condition = sqlMode
        ? `${column} LIKE '%${value}%'`
        : `${column} ${operator} ${value}`;
      break;
    case "not_contains":
    case "notcontains":
      // SQL mode: convert to NOT LIKE operator
      // Display mode: keep as "not_contains"
      condition = sqlMode
        ? `${column} NOT LIKE '%${value}%'`
        : `${column} ${operator} ${value}`;
      break;
    default:
      // Fallback for any other operators
      condition = `${column} ${operator} ${value}`;
      break;
  }
  return condition;
}

/**
 * Build condition string from V2 format group/condition structure
 * This is the core logic shared between UI preview and SQL generation
 *
 * ALGORITHM OVERVIEW:
 * 1. Recursively traverse the condition tree (groups and conditions)
 * 2. For each condition: format value → build condition string → add operator prefix (except index 0)
 * 3. For nested groups: recursively process → wrap in parentheses → add operator prefix
 * 4. Join all parts with spaces (operators are inline)
 * 5. Optionally add WHERE prefix
 *
 * @param group - The root group or condition node
 * @param options - Formatting options (SQL mode, value formatting, WHERE prefix)
 * @returns Formatted condition string
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

  // Recursive function to parse group/condition nodes
  const parseNode = (node: any): string => {
    if (!node) return "";

    // Case 1: V2 Group (filterType === 'group')
    if (node.filterType === 'group') {
      if (!Array.isArray(node.conditions) || node.conditions.length === 0) return "";

      const parts: string[] = [];

      // Iterate through all conditions in this group
      node.conditions.forEach((item: any, index: number) => {
        let conditionStr = '';

        // Case 1a: Nested group - recursively process
        if (isGroup(item)) {
          const nestedResult = parseNode(item);
          if (nestedResult) {
            // Wrap nested group result in parentheses
            conditionStr = `(${nestedResult})`;
          }
        }
        // Case 1b: Single condition - format and build
        else if (item.filterType === 'condition' && item.column && item.operator && item.value !== undefined) {
          // Step 1: Format the value (add quotes if needed, based on type)
          const formattedValue = formatValues
            ? formatValue(item.column, item.operator, item.value, streamFieldsMap)
            : (item.value !== undefined && item.value !== null && item.value !== ''
                ? `'${item.value}'`
                : "''");

          // Step 2: Build the condition string (column operator value)
          conditionStr = getFormattedCondition(
            item.column,
            item.operator,
            formattedValue,
            sqlMode,
          );
        }

        // Step 3: Add logical operator prefix (except for first item at index 0)
        if (conditionStr) {
          if (index > 0 && item.logicalOperator) {
            // Format operator based on mode (uppercase for SQL, lowercase for display)
            const operator = sqlMode
              ? item.logicalOperator.toUpperCase()
              : item.logicalOperator.toLowerCase();
            // Add operator BEFORE the condition
            parts.push(`${operator} ${conditionStr}`);
          } else {
            // First item (index 0) has no operator prefix
            parts.push(conditionStr);
          }
        }
      });

      // Join all parts with single space (operators are already inline)
      return parts.join(' ');
    }

    // Case 2: V2 Single condition at root level (no group wrapper)
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

  // Execute the recursive parsing
  const result = parseNode(group);

  // Add WHERE prefix if requested (only for SQL mode with non-empty result)
  if (addWherePrefix && sqlMode && result.trim().length > 0) {
    return "WHERE " + result;
  }

  return result;
}
