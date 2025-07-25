import { Parser } from "@openobserve/node-sql-parser/build/datafusionsql.js";


/**
 * Check if every column expression in the SELECT list has a non-empty alias.
 */
function columnsHaveAlias(columns: any[] | undefined): boolean {
  return (
    Array.isArray(columns) &&
    columns.length > 0 &&
    columns.every((c) => typeof c.as === "string" && c.as.trim().length > 0)
  );
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
    ast = parser.astify(sql);
  } catch {
    return false; // invalid SQL – treat as failure
  }

  // Parser returns an array when multiple statements are supplied; we only
  // inspect the first one.
  let node: any = Array.isArray(ast) ? ast[0] : ast;

  if (!node || node.type !== "select") return false;

  // Walk through the primary SELECT and any chained UNION SELECTs via _next.
  while (node) {
    if (!columnsHaveAlias(node.columns)) return false;

    // If this SELECT is followed by a UNION / UNION ALL etc., continue; the
    // parser places the next SELECT in `_next`.
    if (node.set_op && node._next) {
      node = node._next;
      if (!node || node.type !== "select") return false;
    } else {
      break; // no more UNION parts → exit loop
    }
  }

  return true;
}
