/**
 * Alert SQL Query Utilities
 * Extracted from AddAlert.vue to reduce file complexity
 */

import type { TranslateFn } from "@/types/i18n";
import { maxParenDepth, SQL_PARSE_MAX_DEPTH } from "@/utils/query/sqlComplexity";

export interface SqlUtilsContext {
  parser: any;
  sqlQueryErrorMsg: any;
  t: TranslateFn;
}
type ComparisonOperator = ">=" | "<=" | ">" | "<" | "=" | "!=" | "<>";

export const getParser = (sqlQuery: string, context: SqlUtilsContext): boolean => {
  const { parser, sqlQueryErrorMsg, t } = context;
  // astify() is exponential in paren nesting depth — skip a pathologically
  // nested query rather than freeze the tab. Same "assume OK" fallback as the
  // catch below: this only checks for a bare `SELECT *`, and the backend
  // still validates the query regardless.
  if (maxParenDepth(sqlQuery) > SQL_PARSE_MAX_DEPTH) return true;
  try {
    // As default is a reserved keyword in sql-parser, we are replacing it with default1
    const regex = /\bdefault\b/g;
    const columns = parser.astify(sqlQuery.replace(regex, "default1")).columns;
    for (const column of columns) {
      if (column.expr.column === "*") {
        sqlQueryErrorMsg.value = t("alerts.selectAllColumnsNotAllowed");
        return false;
      }
    }
    return true;
  } catch (error) {
    // In catch block we are returning true, as we just wanted to validate if user have added * in the query to select all columns
    // select field from default // here default is not wrapped in "" so node sql parser will throw error as default is a reserved keyword. But our Backend supports this query without quotes
    // Query will be validated in the backend
    console.log(error);
    return true;
  }
};

/**
 * Adds or appends a HAVING clause to a SQL query in the correct position
 *
 * Strategy:
 * 1. Parse SQL into AST using node-sql-parser
 * 2. Add HAVING condition to the AST
 * 3. Let node-sql-parser generate the SQL with correct clause ordering
 * 4. If parsing fails, fall back to regex-based insertion
 *
 * @param sqlQuery - The original SQL query
 * @param yAxisColumn - The column name to use in the HAVING clause
 * @param operator - The comparison operator (e.g., '>=', '<=', '>', '<', '=')
 * @param threshold - The threshold value for comparison
 * @param parser - The node-sql-parser instance
 * @returns The modified SQL query with the HAVING clause properly inserted
 */
export const addHavingClauseToQuery = (
  sqlQuery: string,
  yAxisColumn: string,
  operator: string,
  threshold: number,
  parser: any,
): string => {
  // === Input Validation ===
  if (!sqlQuery || typeof sqlQuery !== "string" || sqlQuery.trim().length === 0) {
    throw new Error("Invalid SQL query: must be a non-empty string");
  }

  // Validate column name - allow qualified names (table.column) and quoted identifiers
  if (!yAxisColumn || typeof yAxisColumn !== "string") {
    throw new Error("Column name must be a non-empty string");
  }

  // Validate operator
  const validOperators: ComparisonOperator[] = [">=", "<=", ">", "<", "=", "!=", "<>"];
  if (!validOperators.includes(operator as ComparisonOperator)) {
    throw new Error(`Invalid operator: ${operator}. Must be one of: ${validOperators.join(", ")}`);
  }

  // Validate threshold
  if (typeof threshold !== "number" || !isFinite(threshold)) {
    throw new Error(`Invalid threshold: ${threshold}. Must be a finite number`);
  }

  if (!parser || typeof parser.astify !== "function" || typeof parser.sqlify !== "function") {
    throw new Error("Invalid parser: must have astify and sqlify methods");
  }

  // astify() is exponential in paren nesting depth — a pathologically nested
  // query would freeze the tab, so go straight to the regex fallback instead
  // of attempting the AST parse at all.
  if (maxParenDepth(sqlQuery) > SQL_PARSE_MAX_DEPTH) {
    return fallbackHavingInsertion(sqlQuery, yAxisColumn, operator, threshold);
  }

  try {
    // Parse the SQL query into an AST
    const ast = parser.astify(sqlQuery);

    // Handle array of statements (e.g., UNION queries)
    if (Array.isArray(ast)) {
      // UNION queries are complex - adding HAVING to the wrong SELECT can break the query
      // Use fallback method instead
      console.warn("UNION query detected, using fallback method");
      throw new Error("UNION queries require fallback method");
    }

    // Validate that query has GROUP BY (HAVING requires it)
    if (!ast.groupby || ast.groupby.length === 0) {
      console.warn("Adding HAVING clause to query without GROUP BY may cause SQL error");
    }

    // Create the new HAVING condition
    const newHavingCondition = {
      type: "binary_expr",
      operator: operator,
      left: {
        type: "column_ref",
        table: null,
        column: yAxisColumn, // node-sql-parser handles quoting
      },
      right: {
        type: "number",
        value: threshold,
      },
    };

    // If there's already a HAVING clause, check if it's a duplicate before combining
    if (ast.having) {
      // Check if the exact condition already exists
      const sqlified = parser.sqlify(ast, { database: "PostgreSQL" });
      const conditionPattern = new RegExp(
        `${yAxisColumn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*${operator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*${threshold}`,
        "i",
      );

      if (conditionPattern.test(sqlified)) {
        return sqlified; // Return the query as-is
      }

      // Keep existing condition on the left with parentheses for proper grouping
      // Example: HAVING (a OR b) AND new_condition
      ast.having = {
        type: "binary_expr",
        operator: "AND",
        left: {
          ...ast.having,
          parentheses: true, // Preserve original condition grouping
        },
        right: newHavingCondition,
      };
    } else {
      // Add the new HAVING clause
      ast.having = newHavingCondition;
    }

    // Convert AST back to SQL with PostgreSQL dialect (uses double quotes)
    const modifiedQuery = parser.sqlify(ast, {
      database: "PostgreSQL",
    });

    return modifiedQuery;
  } catch (error) {
    // If parsing fails, fall back to regex-based insertion
    console.warn("Failed to parse SQL query for HAVING clause insertion:", error);
    console.warn("Query:", sqlQuery);
    console.warn("Column:", yAxisColumn, "Operator:", operator, "Threshold:", threshold);
    console.warn("Using fallback regex method...");
    return fallbackHavingInsertion(sqlQuery, yAxisColumn, operator, threshold);
  }
};

/**
 * Fallback method using regex when AST parsing fails
 * This method has limitations and should only be used as a last resort
 */
function fallbackHavingInsertion(
  sqlQuery: string,
  yAxisColumn: string,
  operator: string,
  threshold: number,
): string {
  const havingClause = `HAVING ${yAxisColumn} ${operator} ${threshold}`;
  const sqlLower = sqlQuery.toLowerCase();

  // Warn about subqueries - fallback may not work correctly
  if (sqlQuery.match(/\(\s*SELECT/i)) {
    console.warn("Query contains subqueries. Fallback HAVING insertion may not work correctly.");
    console.warn(
      "The HAVING clause will be added to the outermost query, which may not be the intended location.",
    );
  }

  // Check if GROUP BY exists - HAVING requires it
  const groupByMatch = sqlQuery.match(/\s+GROUP\s+BY\s+/i);
  if (!groupByMatch) {
    console.warn("Adding HAVING without GROUP BY - this will likely cause a SQL error");
  }

  // Check if HAVING already exists
  if (sqlLower.includes("having")) {
    // Check if the exact condition already exists in the HAVING clause
    const existingConditionPattern = new RegExp(
      `having\\s+.*${yAxisColumn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*${operator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*${threshold}`,
      "i",
    );

    if (existingConditionPattern.test(sqlQuery)) {
      return sqlQuery; // Return unchanged
    }

    // Find the existing HAVING clause and append with AND
    // Match HAVING ... up to ORDER BY/LIMIT/OFFSET or end of string
    return sqlQuery.replace(
      /(having\s+.+?)(\s+(?:order\s+by|limit|offset)|$)/i,
      `$1 AND ${yAxisColumn} ${operator} ${threshold}$2`,
    );
  }

  // Find the position to insert HAVING clause
  // Priority: after GROUP BY, before ORDER BY, before LIMIT, before OFFSET

  // Try to find ORDER BY
  const orderByMatch = sqlQuery.match(/\s+ORDER\s+BY\s+/i);
  if (orderByMatch && orderByMatch.index !== undefined) {
    return (
      sqlQuery.slice(0, orderByMatch.index) +
      ` ${havingClause}` +
      sqlQuery.slice(orderByMatch.index)
    );
  }

  // Try to find LIMIT
  const limitMatch = sqlQuery.match(/\s+LIMIT\s+/i);
  if (limitMatch && limitMatch.index !== undefined) {
    return (
      sqlQuery.slice(0, limitMatch.index) + ` ${havingClause}` + sqlQuery.slice(limitMatch.index)
    );
  }

  // Try to find OFFSET (without LIMIT)
  const offsetMatch = sqlQuery.match(/\s+OFFSET\s+/i);
  if (offsetMatch && offsetMatch.index !== undefined) {
    return (
      sqlQuery.slice(0, offsetMatch.index) + ` ${havingClause}` + sqlQuery.slice(offsetMatch.index)
    );
  }

  // If no ORDER BY, LIMIT, or OFFSET found, append at the end
  return `${sqlQuery.trim()} ${havingClause}`;
}

const AGGREGATE_CALL =
  /\b(?:count|sum|avg|min|max|median|mean|approx_\w+|stddev\w*|var(?:iance|_\w+)?|array_agg|string_agg|bool_and|bool_or|first_value|last_value|percentile_\w+)\s*\(/i;

/** The query's outermost level: literals, comments and everything inside parentheses blanked to "()". */
function outermostSql(sql: string): string {
  const flat = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
  let depth = 0;
  let out = "";
  for (const ch of flat) {
    if (ch === "(") {
      if (depth === 0) out += "(";
      depth++;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
      if (depth === 0) out += ")";
    } else if (depth === 0) out += ch;
  }
  return out;
}

/** True when the query aggregates without GROUP BY or HAVING, so every run returns exactly one row. */
export function alwaysOneRow(sql: string): boolean {
  const top = outermostSql(sql ?? "");
  if ((top.match(/\bselect\b/gi) ?? []).length !== 1) return false;
  if (/\b(?:union|intersect|except|group\s+by|having|over)\b/i.test(top)) return false;
  const list = /\bselect\b([\s\S]*?)(?:\bfrom\b|$)/i.exec(top)?.[1] ?? "";
  return AGGREGATE_CALL.test(list);
}

/** Whether a result of one row meets the "query returns [operator] [threshold] rows" limit. */
export function oneRowMeetsLimit(operator: unknown, threshold: unknown): boolean {
  const n = Number(threshold);
  if (threshold === "" || threshold === null || !Number.isFinite(n)) return false;
  switch (operator) {
    case ">=":
      return 1 >= n;
    case ">":
      return 1 > n;
    case "<=":
      return 1 <= n;
    case "<":
      return 1 < n;
    case "=":
      return n === 1;
    case "!=":
      return n !== 1;
    default:
      return false;
  }
}

/** The SQL with quoted text and everything inside parentheses blanked, so offsets still line up. */
function maskNested(sql: string): string {
  let out = "";
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      out += " ";
      if (ch === quote && sql[i + 1] === quote) {
        out += " ";
        i++;
      } else if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      out += " ";
    } else if (ch === "(" || ch === ")") {
      depth = Math.max(0, depth + (ch === "(" ? 1 : -1));
      out += " ";
    } else out += depth > 0 ? " " : ch;
  }
  return out;
}

const clauseOf = (sql: string, start: RegExp, end: RegExp): string | null => {
  const masked = maskNested(sql);
  const head = start.exec(masked);
  if (!head) return null;
  const from = head.index + head[0].length;
  const stop = end.exec(masked.slice(from));
  return sql.slice(from, stop ? from + stop.index : sql.length).trim() || null;
};

const splitTop = (text: string, separator: RegExp): string[] => {
  const parts: string[] = [];
  let last = 0;
  for (const match of maskNested(text).matchAll(separator)) {
    parts.push(text.slice(last, match.index));
    last = (match.index ?? 0) + match[0].length;
  }
  parts.push(text.slice(last));
  return parts.map((part) => part.trim()).filter(Boolean);
};

const squash = (text: string) => text.replace(/["`\s]/g, "").toLowerCase();
const CLAUSE_END = /\b(?:group\s+by|having|order\s+by|limit|qualify|union|window)\b|;/i;
const COMPARISON = /^([\s\S]+?)\s*(>=|<=|!=|<>|>|<|=)\s*(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)$/i;

/** The outer query's WHERE clause as written, or null when it has none. */
export function sqlWhereText(sql: string): string | null {
  return clauseOf(sql ?? "", /\bwhere\b/i, CLAUSE_END);
}

type HavingCondition = { column: string; operator: string; value: number };
const HAVING_END = /\b(?:order\s+by|limit|qualify|union|window)\b|;/i;

function havingThreshold(sql: string) {
  const masked = maskNested(sql);
  const head = /\bhaving\b/i.exec(masked);
  if (!head) return null;
  const from = head.index + head[0].length;
  const stop = HAVING_END.exec(masked.slice(from));
  const to = stop ? from + stop.index : sql.length;
  const having = sql.slice(from, to).trim();
  if (!having || /\bor\b/i.test(maskNested(having))) return null;
  const list = clauseOf(sql, /^\s*select\b(?:\s+distinct\b)?/i, /\bfrom\b/i) ?? "";
  const columns = splitTop(list, /,/g).map((item) => {
    const named = /^([\s\S]+?)\s+as\s+([\w"`]+)$/i.exec(item);
    return named
      ? { expr: squash(named[1]), name: named[2].replace(/["`]/g, "") }
      : { expr: squash(item), name: item.replace(/["`]/g, "") };
  });
  const parts = splitTop(having, /\band\b/gi);
  let found: HavingCondition | null = null;
  let term = -1;
  // The last comparison wins: a minimum-volume guard is written before the threshold it guards.
  for (const [index, part] of parts.entries()) {
    const comparison = COMPARISON.exec(part);
    if (!comparison) continue;
    const lhs = squash(comparison[1]);
    const operator = comparison[2] === "<>" ? "!=" : comparison[2];
    const value = Number(comparison[3]);
    for (const column of columns) {
      const scaled = /^(.+)([/*])(\d+(?:\.\d+)?)$/.exec(column.expr);
      const factor = scaled && scaled[1] === lhs ? Number(scaled[3]) : 0;
      if (column.expr === lhs || squash(column.name) === lhs) {
        found = { column: column.name, operator, value };
      } else if (factor > 0) {
        const restated = scaled![2] === "/" ? value / factor : value * factor;
        found = { column: column.name, operator, value: Number(restated.toPrecision(12)) };
      } else continue;
      term = index;
      break;
    }
  }
  return found ? { condition: found, parts, term, head: head.index, from, to } : null;
}

/** A HAVING comparison restated on a column the query returns, for a per-row condition. A column
 * that scales the compared expression (`expr / 1000.0 AS p95_ms`) gets the value scaled with it. */
export function sqlHavingCondition(sql: string): HavingCondition | null {
  return havingThreshold(sql ?? "")?.condition ?? null;
}

/** A grouped query whose HAVING ends the statement, split into the SQL without its threshold term
 * (sorted worst first) and that threshold as a per-group condition on a named column. */
export function sqlHavingToCondition(
  sql: string,
): { sql: string; condition: HavingCondition } | null {
  const text = (sql ?? "").trim();
  const match = havingThreshold(text);
  const { condition } = match ?? {};
  if (!match || !condition || match.to !== text.length) return null;
  if (!/\bgroup\s+by\b/i.test(maskNested(text.slice(0, match.head)))) return null;
  if (![">", ">=", "<", "<="].includes(condition.operator) || !/^\w+$/.test(condition.column))
    return null;
  const rest = match.parts.filter((_, index) => index !== match.term);
  const kept = rest.length
    ? `${text.slice(0, match.from)} ${rest.join(" AND ")}`
    : text.slice(0, match.head).trimEnd();
  // The alert reads a bounded page of rows, so the groups past the threshold must come first.
  const order = condition.operator.startsWith(">") ? "DESC" : "ASC";
  return { sql: `${kept} ORDER BY ${condition.column} ${order}`, condition };
}

const SQL_OPERATORS = new Set([">", ">=", "<", "<=", "=", "!="]);

/** The per-group condition put back into the grouped query's HAVING, so one alert fires on the same
 * groups; drops the sort `sqlHavingToCondition` added, so the two round-trip. */
export function sqlConditionToHaving(
  sql: string,
  condition: { column?: string; operator?: string; value?: unknown },
): string | null {
  const { column = "", operator = "" } = condition;
  const value = Number(condition.value);
  if (condition.value === "" || condition.value === null || !Number.isFinite(value)) return null;
  if (!column || !SQL_OPERATORS.has(operator)) return null;
  const text = (sql ?? "").trim();
  if (!/\bgroup\s+by\b/i.test(maskNested(text))) return null;
  const list = clauseOf(text, /^\s*select\b(?:\s+distinct\b)?/i, /\bfrom\b/i) ?? "";
  const expr = splitTop(list, /,/g)
    .map((item) => /^([\s\S]+?)\s+as\s+([\w"`]+)$/i.exec(item) ?? [item, item, item])
    .find((match) => squash(match[2]) === squash(column))?.[1]
    .trim();
  if (!expr) return null;
  const name = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sort = new RegExp(`\\s+order\\s+by\\s+["\`]?${name}["\`]?\\s+(?:asc|desc)$`, "i");
  const body = text.replace(sort, "");
  const masked = maskNested(body);
  const having = /\bhaving\b/i.exec(masked);
  const from = having ? having.index + having[0].length : /\bgroup\s+by\b/i.exec(masked)!.index;
  const stop = HAVING_END.exec(masked.slice(from));
  const at = stop ? from + stop.index : body.length;
  const tail = body.slice(at).trim();
  const term = `${expr} ${operator} ${value}`;
  const kept = body.slice(from, at).trim();
  // AND binds tighter than OR, so an existing OR keeps its own parentheses.
  const guarded = /\bor\b/i.test(maskNested(kept)) ? `(${kept})` : kept;
  const head = having
    ? `${body.slice(0, from).trimEnd()} ${guarded} AND ${term}`
    : `${body.slice(0, at).trimEnd()} HAVING ${term}`;
  return tail ? `${head} ${tail}` : head;
}
