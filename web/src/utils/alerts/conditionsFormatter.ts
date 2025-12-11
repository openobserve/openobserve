/**
 * =============================================================================
 * SHARED UTILITY FOR FORMATTING V2 CONDITIONS INTO STRINGS
 * =============================================================================
 *
 * This module provides the core logic for converting V2 condition structures
 * into string representations. It's used by:
 * 1. UI Preview (FilterGroup.vue) - for displaying conditions in human-readable format
 * 2. SQL Generation (alertQueryBuilder.ts) - for building WHERE clauses in SQL queries
 *
 * =============================================================================
 * V2 FORMAT STRUCTURE:
 * =============================================================================
 *
 * Group:
 * {
 *   filterType: 'group',
 *   logicalOperator: 'AND' | 'OR',  // NOT USED in WHERE clause generation!
 *                                    // Only used in UI as default when adding new items to this group
 *                                    // Each item's own logicalOperator determines the actual operator used
 *   groupId: 'uuid',
 *   conditions: [...]                // Array of conditions or nested groups
 * }
 *
 * Condition:
 * {
 *   filterType: 'condition',
 *   column: 'age',
 *   operator: '>' | '=' | 'contains' | etc,
 *   value: any,
 *   logicalOperator: 'AND' | 'OR',  // Connects this item to PREVIOUS sibling (not used for index 0)
 *   id: 'uuid'
 * }
 *
 * =============================================================================
 * KEY INSIGHT: LOGICAL OPERATOR PLACEMENT
 * =============================================================================
 *
 * IMPORTANT: The group's logicalOperator field is NOT used when building the WHERE clause!
 *
 * Instead, each item (condition or nested group) has its own logicalOperator field that
 * determines the operator that appears BEFORE that item (except for the first item at index 0).
 *
 * The group's logicalOperator is only used in the UI as a default value when adding new
 * items to that group. It has no effect on the actual SQL generation.
 *
 * Example:
 * {
 *   filterType: 'group',
 *   logicalOperator: 'AND',  // ← This is IGNORED when building WHERE clause
 *   conditions: [
 *     { column: 'age', operator: '>', value: 30, logicalOperator: 'AND' },     // index 0: NO operator before
 *     { column: 'city', operator: '=', value: 'NYC', logicalOperator: 'AND' }, // index 1: AND before (from item's own field)
 *     { column: 'status', operator: '=', value: 'active', logicalOperator: 'OR' } // index 2: OR before (from item's own field)
 *   ]
 * }
 *
 * Result: "age > 30 AND city = 'NYC' OR status = 'active'"
 *          ↑ no operator  ↑ uses item[1].logicalOperator  ↑ uses item[2].logicalOperator
 *
 * =============================================================================
 * COMPLEX EXAMPLE: STEP-BY-STEP WALKTHROUGH
 * =============================================================================
 *
 * INPUT V2 STRUCTURE:
 * {
 *   filterType: 'group',
 *   logicalOperator: 'AND',  // ← ROOT GROUP: This field is IGNORED (not used in WHERE clause)
 *   conditions: [
 *     {
 *       filterType: 'condition',
 *       column: 'age',
 *       operator: '>',
 *       value: 18,
 *       logicalOperator: 'AND'
 *     },
 *     {
 *       filterType: 'condition',
 *       column: 'age',
 *       operator: '<',
 *       value: 65,
 *       logicalOperator: 'AND'
 *     },
 *     {
 *       filterType: 'group',
 *       logicalOperator: 'OR',      // ← NESTED GROUP: Also IGNORED (not used in WHERE clause)
 *                                    //   Only used in UI as default for new items added to this nested group
 *       conditions: [
 *         {
 *           filterType: 'condition',
 *           column: 'city',
 *           operator: '=',
 *           value: 'NYC',
 *           logicalOperator: 'OR'    // ← NESTED GROUP ITEM 0: This is IGNORED (index 0 never has operator prefix)
 *         },
 *         {
 *           filterType: 'condition',
 *           column: 'city',
 *           operator: '=',
 *           value: 'LA',
 *           logicalOperator: 'OR'    // ← NESTED GROUP ITEM 1: This IS USED (appears before this condition)
 *         }
 *       ],
 *       logicalOperator: 'AND'     // ← THIS IS USED: Connects THIS nested group to previous items in parent
 *     },
 *     {
 *       filterType: 'condition',
 *       column: 'status',
 *       operator: 'contains',
 *       value: 'premium',
 *       logicalOperator: 'AND'
 *     }
 *   ]
 * }
 *
 * PROCESSING STEPS (with sqlMode=true, formatValues=true):
 *
 * Step 1: Process condition at index 0
 *   - Input: { column='age', operator='>', value=18, logicalOperator='AND' }
 *   - Call formatValue('age', '>', 18, streamFieldsMap)
 *     → Check: streamFieldsMap['age']?.type === 'Int64' → TRUE
 *     → shouldNotQuote=true
 *     → Return: "18" (no quotes)
 *   - Call getFormattedCondition('age', '>', '18', sqlMode=true)
 *     → operator='>' matches case ">"
 *     → Return: "age > 18"
 *   - index=0, so NO operator prefix
 *   - Push to parts: "age > 18"
 *
 * Step 2: Process condition at index 1
 *   - Input: { column='age', operator='<', value=65, logicalOperator='AND' }
 *   - Call formatValue('age', '<', 65, streamFieldsMap)
 *     → Check: streamFieldsMap['age']?.type === 'Int64' → TRUE
 *     → Return: "65" (no quotes)
 *   - Call getFormattedCondition('age', '<', '65', sqlMode=true)
 *     → Return: "age < 65"
 *   - index=1, logicalOperator='AND', sqlMode=true
 *     → operator = 'AND'.toUpperCase() = "AND"
 *   - Push to parts: "AND age < 65"
 *
 * Step 3: Process nested group at index 2
 *   - Input: filterType='group' → Recursively call parseNode()
 *
 *   Inner Step 3a: Process first condition in nested group (index 0)
 *     - Input: { column='city', operator='=', value='NYC', logicalOperator='OR' }
 *     - formatValue('city', '=', 'NYC', streamFieldsMap)
 *       → Check: streamFieldsMap['city']?.type === 'String'
 *       → shouldNotQuote=false
 *       → Return: "'NYC'" (with quotes)
 *     - getFormattedCondition('city', '=', "'NYC'", sqlMode=true)
 *       → Return: "city = 'NYC'"
 *     - index=0 → NO operator prefix
 *     - Push: "city = 'NYC'"
 *
 *   Inner Step 3b: Process second condition in nested group (index 1)
 *     - Input: { column='city', operator='=', value='LA', logicalOperator='OR' }
 *     - formatValue('city', '=', 'LA', streamFieldsMap)
 *       → Return: "'LA'" (with quotes)
 *     - getFormattedCondition('city', '=', "'LA'", sqlMode=true)
 *       → Return: "city = 'LA'"
 *     - index=1, logicalOperator='OR', sqlMode=true
 *       → operator = "OR"
 *     - Push: "OR city = 'LA'"
 *
 *   Inner result: parts = ["city = 'NYC'", "OR city = 'LA'"]
 *   Inner join: "city = 'NYC' OR city = 'LA'"
 *
 *   - Wrap in parentheses: conditionStr = "(city = 'NYC' OR city = 'LA')"
 *   - Outer index=2, logicalOperator='AND'
 *   - Push to outer parts: "AND (city = 'NYC' OR city = 'LA')"
 *
 * Step 4: Process condition at index 3
 *   - Input: { column='status', operator='contains', value='premium', logicalOperator='AND' }
 *   - formatValue('status', 'contains', 'premium', streamFieldsMap)
 *     → Check: operator === 'contains' → TRUE
 *     → shouldNotQuote=true
 *     → Return: "premium" (no quotes - LIKE will handle it)
 *   - getFormattedCondition('status', 'contains', 'premium', sqlMode=true)
 *     → op.toLowerCase() = 'contains'
 *     → sqlMode=true → Return: "status LIKE '%premium%'"
 *   - index=3, logicalOperator='AND'
 *   - Push to parts: "AND status LIKE '%premium%'"
 *
 * Step 5: Join all parts
 *   parts = [
 *     "age > 18",
 *     "AND age < 65",
 *     "AND (city = 'NYC' OR city = 'LA')",
 *     "AND status LIKE '%premium%'"
 *   ]
 *
 *   Join with single space:
 *   result = "age > 18 AND age < 65 AND (city = 'NYC' OR city = 'LA') AND status LIKE '%premium%'"
 *
 * Step 6: Add WHERE prefix (if addWherePrefix=true)
 *   FINAL OUTPUT:
 *   "WHERE age > 18 AND age < 65 AND (city = 'NYC' OR city = 'LA') AND status LIKE '%premium%'"
 *
 * =============================================================================
 * DISPLAY MODE vs SQL MODE COMPARISON:
 * =============================================================================
 *
 * SAME INPUT, DIFFERENT MODES:
 *
 * DISPLAY MODE (sqlMode=false, formatValues=false):
 *   Options: { sqlMode: false, addWherePrefix: false, formatValues: false }
 *   Output: "age > '18' and age < '65' and (city = 'NYC' or city = 'LA') and status contains 'premium'"
 *
 *   Differences:
 *   - Logical operators: lowercase ('and', 'or')
 *   - Contains operator: kept as-is "status contains 'premium'"
 *   - No WHERE prefix
 *   - All values quoted (no type checking)
 *
 * SQL MODE (sqlMode=true, formatValues=true, addWherePrefix=true):
 *   Options: { sqlMode: true, addWherePrefix: true, formatValues: true, streamFieldsMap }
 *   Output: "WHERE age > 18 AND age < 65 AND (city = 'NYC' OR city = 'LA') AND status LIKE '%premium%'"
 *
 *   Differences:
 *   - Logical operators: uppercase ('AND', 'OR')
 *   - Contains operator: converted to LIKE "status LIKE '%premium%'"
 *   - WHERE prefix included
 *   - Type-aware quoting (Int64 no quotes, String with quotes)
 *
 * =============================================================================
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
