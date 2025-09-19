import { Parser } from "@openobserve/node-sql-parser/build/datafusionsql.js";

/**
 * Check if a column expression is a simple field reference (just a column name)
 * without any functions or complex expressions.
 */
function isSimpleField(column: any): boolean {
  // If column has an 'expr' property, check its type
  if (column?.expr) {
    // Simple column reference will have type 'column_ref'
    return column?.expr?.type === 'column_ref';
  }
  
  // Direct column reference (sometimes the structure is different)
  return column?.type === 'column_ref';
}

/**
 * Check if complex expressions (with functions/aggregations) have aliases.
 * Simple field references are allowed to not have aliases.
 */
function columnsHaveAlias(columns: any[] | undefined): boolean {
  if (!Array.isArray(columns) || columns?.length === 0) {
    return false;
  }

  return columns?.every((c) => {
    // If it's a simple field, we don't require an alias
    if (isSimpleField(c)) {
      return true;
    }
    
    // For complex expressions (functions, aggregations, etc.), require an alias
    return typeof c?.as === "string" && c?.as?.trim()?.length > 0;
  });
}

/**
 * Returns true if every projection (column) in all SELECT statements of the SQL
 * (including chained UNIONs) has an alias, otherwise false.
 *
 * • Works for plain SELECTs, JOINs inside a SELECT, and UNION / UNION ALL chains
 *   produced by @openobserve/node-sql-parser, which represent UNIONs as a
 *   linked list of SELECT nodes connected via the `_next` property and a
 *   `set_op` describing the set operator.
 * • Any parse failure, non-SELECT root, empty column list, or missing alias
 *   causes the function to return false.
 */
export function allSelectionFieldsHaveAlias(sql: string): boolean {
  const parser = new Parser();

  let ast: any;
  try {
    ast = parser?.astify(sql);
  } catch {
    return false; // invalid SQL – treat as failure
  }

  // Parser returns an array when multiple statements are supplied; we only
  // inspect the first one.
  let node: any = Array.isArray(ast) ? ast?.[0] : ast;

  if (!node || node?.type !== "select") return false;

  // Walk through the primary SELECT and any chained UNION SELECTs via _next.
  while (node) {
    if (!columnsHaveAlias(node?.columns)) return false;

    // If this SELECT is followed by a UNION / UNION ALL etc., continue; the
    // parser places the next SELECT in `_next`.
    if (node?.set_op && node?._next) {
      node = node._next;
      if (!node || node?.type !== "select") return false;
    } else {
      break; // no more UNION parts → exit loop
    }
  }

  return true;
}
