/**
 * Shared utility for formatting V2 condition structures into strings. Used by:
 * 1. Display text - human-readable rendering of conditions
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

import type { StreamFieldsMap } from "./alertQueryBuilder";
import { sqlLiteral, sqlLike } from "@/utils/query/sqlFilterBuilder";
import { escapeSingleQuotes } from "@/utils/queryUtils";

export interface FormatOptions {
  // Whether to generate SQL format (uppercase AND/OR, SQL operators) or display format (lowercase)
  sqlMode?: boolean;
  // Whether to add WHERE prefix (only for SQL mode)
  addWherePrefix?: boolean;
  // Whether to format values (add quotes for strings, handle LIKE operators)
  formatValues?: boolean;
  // Stream fields map for type checking (required if formatValues is true)
  streamFieldsMap?: StreamFieldsMap;
  // Quotes the column identifier in the output; omitted by callers that want alerts' existing output unchanged.
  quoteColumn?: (_column: string) => string;
}

// Keys tolerate the backend's serde aliases ("IsNull", ...) alongside the
// canonical lowercase spellings; values are the display text.
const UNARY_OPERATOR_TEXT: Record<string, string> = {
  is_null: "is null",
  isnull: "is null",
  is_not_null: "is not null",
  isnotnull: "is not null",
  is_empty: "is empty",
  isempty: "is empty",
  is_not_empty: "is not empty",
  isnotempty: "is not empty",
};

// "Empty" only differs from "null" on string columns; on any other KNOWN type
// the empty checks degrade to the null checks (matching the backend's
// build_expr, where `col = ''` on e.g. an Int64 column fails coercion). An
// unknown type keeps the string form — the common case for custom columns.
const STRING_TYPES = ["String", "Utf8", "LargeUtf8", "Utf8View"];

/**
 * Unary null/empty-check operators: they take no value, so completeness
 * checks and formatters must not require one.
 */
export function isUnaryOperator(operator: unknown): boolean {
  return typeof operator === "string" && Object.hasOwn(UNARY_OPERATOR_TEXT, operator.toLowerCase());
}

/** Display text for a unary operator ("is null", "is empty", ...). */
export function unaryOperatorText(operator: unknown): string {
  return isUnaryOperator(operator) ? UNARY_OPERATOR_TEXT[(operator as string).toLowerCase()] : "";
}

/**
 * Check if an item is a group (has conditions array and filterType)
 *
 * @param item - The item to check
 * @returns true if item is a group, false otherwise
 */
function isGroup(item: any): boolean {
  return item && item.filterType === "group" && Array.isArray(item.conditions);
}

const NUMERIC_TYPES = ["Int8", "Int16", "Int32", "Int64", "UInt8", "UInt16", "UInt32", "UInt64"];
const FLOAT_TYPES = ["Float16", "Float32", "Float64"];

type ExtendedOperator = "in" | "not_in" | "starts_with" | "ends_with" | "re_match" | "re_not_match";

// Lower case with spaces and underscores dropped, so "Starts With", "startswith" and "starts_with" meet.
const EXTENDED_OPERATORS: Record<string, ExtendedOperator> = {
  in: "in",
  notin: "not_in",
  startswith: "starts_with",
  endswith: "ends_with",
  rematch: "re_match",
  regex: "re_match",
  renotmatch: "re_not_match",
  notregex: "re_not_match",
};

const extendedOperator = (operator: unknown): ExtendedOperator | null => {
  if (typeof operator !== "string") return null;
  const key = operator.toLowerCase().replace(/[\s_]/g, "");
  return Object.hasOwn(EXTENDED_OPERATORS, key) ? EXTENDED_OPERATORS[key] : null;
};

/** The items of an `in` / `not_in` value: an array, a JSON array string, or one scalar. */
export function conditionListValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Not JSON: the whole text is one value.
    }
  }
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

/** Whether a condition carries the value its operator needs (lists need at least one item). */
export function conditionHasValue(operator: unknown, value: unknown): boolean {
  if (isUnaryOperator(operator)) return true;
  const op = extendedOperator(operator);
  if (op === "in" || op === "not_in") return conditionListValues(value).length > 0;
  return value !== undefined && value !== null && value !== "";
}

const isNumericColumn = (columnType: string | undefined) =>
  columnType !== undefined && [...NUMERIC_TYPES, ...FLOAT_TYPES].includes(columnType);

const caseFolds = (ignoreCase: boolean, columnType: string | undefined) =>
  ignoreCase && (columnType === undefined || STRING_TYPES.includes(columnType));

const listLiteral = (item: unknown, numeric: boolean, fold: boolean): string => {
  if (numeric && String(item).trim() !== "" && Number.isFinite(Number(item))) return String(item);
  const text = String(item ?? "");
  return sqlLiteral(fold ? text.toLowerCase() : text);
};

/** SQL for the operators the condition builder added; mirrors the backend's build_extended_expr. */
function extendedSql(
  column: string,
  op: ExtendedOperator,
  value: unknown,
  ignoreCase: boolean,
  columnType: string | undefined,
): string {
  const fold = caseFolds(ignoreCase, columnType);
  const target = fold ? `lower(${column})` : column;
  if (op === "in" || op === "not_in") {
    const items = conditionListValues(value);
    if (!items.length) return "";
    const numeric = isNumericColumn(columnType);
    const literals = items.map((item) => listLiteral(item, numeric, fold)).join(", ");
    return `${target} ${op === "in" ? "IN" : "NOT IN"} (${literals})`;
  }
  // The backend refuses the text operators on a non-text column, so there is no SQL to show.
  if (columnType !== undefined && !STRING_TYPES.includes(columnType)) return "";
  const text = String(value ?? "");
  if (op === "starts_with" || op === "ends_with") {
    return sqlLike(
      target,
      fold ? text.toLowerCase() : text,
      op === "starts_with" ? "start" : "end",
    );
  }
  const pattern = ignoreCase ? `(?i)${text}` : text;
  return `${op}(${column}, '${escapeSingleQuotes(pattern)}')`;
}

/** Case-folded SQL for `case_insensitive` on the original operators; mirrors build_case_insensitive_expr. */
function ignoreCaseSql(column: string, operator: string, value: unknown): string | null {
  const text = String(value ?? "");
  const op = operator.toLowerCase().replace(/[\s_]/g, "");
  if (op === "contains" || op === "strmatch") {
    return `str_match_ignore_case(${column}, ${sqlLiteral(text)})`;
  }
  if (op === "notcontains")
    return sqlLike(`lower(${column})`, text.toLowerCase(), "contains", true);
  if (["=", "!=", "<>", ">", ">=", "<", "<="].includes(op)) {
    return `lower(${column}) ${op} ${sqlLiteral(text.toLowerCase())}`;
  }
  return null;
}

const displayList = (value: unknown) =>
  `(${conditionListValues(value)
    .map((item) => sqlLiteral(item))
    .join(", ")})`;

/** One leaf as text: SQL in sqlMode, readable text otherwise; empty when it cannot be written. */
function formatLeaf(
  item: any,
  column: string,
  options: { sqlMode: boolean; formatValues: boolean; streamFieldsMap?: StreamFieldsMap },
): string {
  const { sqlMode, formatValues, streamFieldsMap } = options;
  const columnType = streamFieldsMap?.[item.column]?.type;
  const extended = extendedOperator(item.operator);
  if (extended) {
    // Like the backend, the operators added with case_insensitive also honour the legacy flag.
    const folds = item.case_insensitive === true || item.ignore_case === true;
    if (sqlMode) return extendedSql(column, extended, item.value, folds, columnType);
    const shown =
      extended === "in" || extended === "not_in" ? displayList(item.value) : sqlLiteral(item.value);
    return `${column} ${item.operator} ${shown}`;
  }
  if (sqlMode && item.case_insensitive === true && caseFolds(true, columnType)) {
    const folded = ignoreCaseSql(column, item.operator, item.value);
    if (folded) return folded;
  }
  const formattedValue = formatValues
    ? formatValue(item.column, item.operator, item.value, streamFieldsMap)
    : sqlLiteral(item.value);
  return getFormattedCondition(column, item.operator, formattedValue, sqlMode, columnType);
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
    return sqlLiteral(value);
  }

  // Check if column is Int64 or operator is contains/not_contains - don't add quotes
  const shouldNotQuote =
    streamFieldsMap[column]?.type === "Int64" || // Numeric types don't need quotes in SQL
    operator === "contains" || // LIKE operator handles quoting
    operator === "not_contains" ||
    operator === "Contains" ||
    operator === "NotContains";

  return shouldNotQuote ? value : sqlLiteral(value);
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
  columnType?: string,
): string {
  if (isUnaryOperator(operator)) {
    const text = unaryOperatorText(operator);
    if (!sqlMode) return `${column} ${text}`;
    const nonString = columnType !== undefined && !STRING_TYPES.includes(columnType);
    switch (text) {
      case "is null":
        return `${column} IS NULL`;
      case "is not null":
        return `${column} IS NOT NULL`;
      case "is empty":
        return nonString ? `${column} IS NULL` : `(${column} IS NULL OR ${column} = '')`;
      default:
        return nonString ? `${column} IS NOT NULL` : `(${column} IS NOT NULL AND ${column} != '')`;
    }
  }

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
      condition = sqlMode ? sqlLike(column, value) : `${column} ${operator} ${value}`;
      break;
    case "not_contains":
    case "notcontains":
      // SQL mode: convert to NOT LIKE operator
      // Display mode: keep as "not_contains"
      condition = sqlMode
        ? sqlLike(column, value, "contains", true)
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
export function buildConditionsString(group: any, options: FormatOptions = {}): string {
  const {
    sqlMode = false,
    addWherePrefix = false,
    formatValues = false,
    streamFieldsMap,
    quoteColumn,
  } = options;
  const outputColumn = (column: string): string => (quoteColumn ? quoteColumn(column) : column);
  const leafOptions = { sqlMode, formatValues, streamFieldsMap };

  // Recursive function to parse group/condition nodes
  const parseNode = (node: any): string => {
    if (!node) return "";

    // Case 1: V2 Group (filterType === 'group')
    if (node.filterType === "group") {
      if (!Array.isArray(node.conditions) || node.conditions.length === 0) return "";

      const parts: string[] = [];

      // Iterate through all conditions in this group
      node.conditions.forEach((item: any, index: number) => {
        let conditionStr = "";

        // Case 1a: Nested group - recursively process
        if (isGroup(item)) {
          const nestedResult = parseNode(item);
          if (nestedResult) {
            // Wrap nested group result in parentheses
            conditionStr = `(${nestedResult})`;
          }
        }
        // Case 1b: Single condition - format and build
        else if (
          item.filterType === "condition" &&
          item.column &&
          item.operator &&
          (item.value !== undefined || isUnaryOperator(item.operator))
        ) {
          conditionStr = formatLeaf(item, outputColumn(item.column), leafOptions);
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
      return parts.join(" ");
    }

    // Case 2: V2 Single condition at root level (no group wrapper)
    if (
      node.filterType === "condition" &&
      node.column &&
      node.operator &&
      (node.value !== undefined || isUnaryOperator(node.operator))
    ) {
      return formatLeaf(node, outputColumn(node.column), leafOptions);
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
