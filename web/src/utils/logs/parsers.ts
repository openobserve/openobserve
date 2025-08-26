// Copyright 2023 OpenObserve Inc.
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

import { Parser } from "@openobserve/node-sql-parser/build/datafusionsql";

/**
 * Interface for SQL parser functions
 */
export interface SQLParserFunctions {
  parseSQL: (query: string) => any;
  unparseSQL: (parsedObj: any) => string;
}

/**
 * Interface for value query extraction parameters
 */
export interface ValueQueryParams {
  sqlMode: boolean;
  query: string;
  selectedStreams: string[];
  parseSQL: (query: string) => any;
  unparseSQL: (parsedObj: any) => string;
}

/**
 * Interface for filter column extraction node
 */
export interface FilterColumnNode {
  type: string;
  column?: any;
  left?: any;
  right?: any;
  args?: { type: string; value: any[] };
}

/**
 * Creates SQL parser functions with proper error handling
 * 
 * @param parser - SQL parser instance
 * @returns Object with parseSQL and unparseSQL functions
 * 
 * @example
 * ```typescript
 * const parser = new Parser();
 * const { parseSQL, unparseSQL } = createSQLParserFunctions(parser);
 * const parsed = parseSQL("SELECT * FROM logs WHERE status = 'error'");
 * ```
 */
export function createSQLParserFunctions(parser: Parser | null): SQLParserFunctions {
  const parseSQL = (queryString: string = "") => {
    try {
      if (!parser) {
        return {
          columns: [],
          from: [],
          orderby: null,
          limit: null,
          groupby: null,
          where: null,
        };
      }

      const filteredQuery = queryString
        .split("\n")
        .filter((line: string) => !line.trim().startsWith("--"))
        .join("\n");

      const parsedQuery: any = parser.astify(filteredQuery);
      return parsedQuery || {
        columns: [],
        from: [],
        orderby: null,
        limit: null,
        groupby: null,
        where: null,
      };
    } catch (e: any) {
      return {
        columns: [],
        from: [],
        orderby: null,
        limit: null,
        groupby: null,
        where: null,
      };
    }
  };

  const unparseSQL = (parsedObj: any) => {
    try {
      if (!parser) {
        return "";
      }
      const sql = parser.sqlify(parsedObj);
      return sql || "";
    } catch (e: any) {
      console.info(`Error while unparsing SQL : ${e.message}`);
      return "";
    }
  };

  return { parseSQL, unparseSQL };
}

/**
 * Extracts filter columns from a SQL expression recursively
 * 
 * @param expression - SQL expression object to traverse
 * @returns Array of column objects found in the expression
 * 
 * @example
 * ```typescript
 * const columns = extractFilterColumns(parsedSQL.where);
 * // Returns: [{ expr: { value: "status" } }, { expr: { value: "level" } }]
 * ```
 */
export function extractFilterColumns(expression: any): any[] {
  const columns: any[] = [];

  function traverse(node: FilterColumnNode) {
    if (node.type === "column_ref") {
      columns.push({
        expr: {
          value: node.column,
        },
      });
    } else if (node.type === "binary_expr") {
      traverse(node.left);
      traverse(node.right);
    } else if (node.type === "function") {
      if (node.args && node.args.value) {
        node.args.value.forEach((arg: any) => {
          traverse(arg);
        });
      }
    }
  }

  if (expression) {
    traverse(expression);
  }

  return columns;
}

/**
 * Checks if a SQL order by clause is ascending by timestamp
 * 
 * @param orderby - SQL order by clause object
 * @param timestampColumn - Name of the timestamp column to check
 * @returns true if ordering by timestamp ASC, false otherwise
 * 
 * @example
 * ```typescript
 * const isAsc = isTimestampASC(parsedSQL.orderby, "_timestamp");
 * // Returns: true if ORDER BY _timestamp ASC
 * ```
 */
export function isTimestampASC(orderby: any, timestampColumn: string): boolean {
  if (orderby) {
    for (const order of orderby) {
      if (
        order.expr &&
        order.expr.column === timestampColumn
      ) {
        if (order.type && order.type === "ASC") {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Cleans binary expressions by removing field-only comparisons recursively
 * 
 * @param node - Binary expression node to clean
 * @returns Cleaned expression node or null
 * 
 * @example
 * ```typescript
 * const cleaned = cleanBinaryExpression(parsedSQL.where);
 * // Returns: cleaned expression without field-only comparisons
 * ```
 */
export function cleanBinaryExpression(node: any): any {
  if (!node) return null;

  switch (node.type) {
    case "binary_expr": {
      const left: any = cleanBinaryExpression(node.left);
      const right: any = cleanBinaryExpression(node.right);

      // Remove the operator and keep only the non-null side if the other side is a field-only reference
      if (left && isFieldOnly(left) && isFieldOnly(right)) {
        return null; // Ignore this condition entirely if both sides are fields
      } else if (!left) {
        return right; // Only the right side remains, so return it
      } else if (!right) {
        return left; // Only the left side remains, so return it
      }

      // Return the expression if both sides are valid
      return {
        type: "binary_expr",
        operator: node.operator,
        left: left,
        right: right,
      };
    }

    case "column_ref":
      return {
        type: "column_ref",
        table: node.table || null,
        column:
          node.column && node.column.expr
            ? node.column.expr.value
            : node.column,
      };

    case "single_quote_string":
    case "number":
      return {
        type: node.type,
        value: node.value,
      };

    default:
      return node;
  }
}

/**
 * Helper function to check if a node is a field-only reference
 * 
 * @param node - Node to check
 * @returns true if node is a column reference without literal value
 * 
 * @example
 * ```typescript
 * const isField = isFieldOnly({ type: "column_ref", column: "status" });
 * // Returns: true
 * ```
 */
export function isFieldOnly(node: any): boolean {
  return !!(node && node.type === "column_ref");
}

/**
 * Extracts value queries from complex SQL statements for multi-stream processing
 * 
 * @param params - Parameters for value query extraction
 * @returns Object containing queries for each stream/table
 * 
 * @example
 * ```typescript
 * const queries = extractValueQuery({
 *   sqlMode: true,
 *   query: "SELECT * FROM logs WHERE status = 'error' UNION SELECT * FROM traces WHERE level = 'warn'",
 *   selectedStreams: ["logs", "traces"],
 *   parseSQL: (q) => parser.parse(q),
 *   unparseSQL: (obj) => parser.unparse(obj)
 * });
 * // Returns: { logs: "SELECT * FROM [INDEX_NAME] WHERE status = 'error'", traces: "SELECT * FROM [INDEX_NAME] WHERE level = 'warn'" }
 * ```
 */
export function extractValueQuery(params: ValueQueryParams): Record<string, string> {
  try {
    if (params.sqlMode === false || params.query === "") {
      return {};
    }

    const orgQuery: string = params.query
      .split("\n")
      .filter((line: string) => !line.trim().startsWith("--"))
      .join("\n");
    
    const outputQueries: Record<string, string> = {};
    const parsedSQL = params.parseSQL(orgQuery);

    let query = `select * from INDEX_NAME`;
    const newParsedSQL = params.parseSQL(query);
    
    if (
      Object.hasOwn(parsedSQL, "from") &&
      parsedSQL.from.length <= 1 &&
      parsedSQL._next == null
    ) {
      newParsedSQL.where = parsedSQL.where;

      query = params.unparseSQL(newParsedSQL).replace(/`/g, '"');
      outputQueries[parsedSQL.from[0].table] = query.replace(
        "INDEX_NAME",
        "[INDEX_NAME]",
      );
    } else {
      // parse join queries & union queries
      if (Object.hasOwn(parsedSQL, "from") && parsedSQL.from.length > 1) {
        parsedSQL.where = cleanBinaryExpression(parsedSQL.where);
        // parse join queries and make where null
        params.selectedStreams.forEach((stream: string) => {
          newParsedSQL.where = null;

          query = params.unparseSQL(newParsedSQL).replace(/`/g, '"');
          outputQueries[stream] = query.replace("INDEX_NAME", "[INDEX_NAME]");
        });
      } else if (parsedSQL._next != null) {
        //parse union queries
        if (Object.hasOwn(parsedSQL, "from") && parsedSQL.from) {
          let query = `select * from INDEX_NAME`;
          const newParsedSQL = params.parseSQL(query);

          newParsedSQL.where = parsedSQL.where;

          query = params.unparseSQL(newParsedSQL).replace(/`/g, '"');
          outputQueries[parsedSQL.from[0].table] = query.replace(
            "INDEX_NAME",
            "[INDEX_NAME]",
          );
        }

        let nextTable = parsedSQL._next;
        let depth = 0;
        const MAX_DEPTH = 100;
        while (nextTable && depth++ < MAX_DEPTH) {
          // Map through each "from" array in the _next object, as it can contain multiple tables
          if (nextTable.from) {
            let query = "select * from INDEX_NAME";
            const newParsedSQL = params.parseSQL(query);

            newParsedSQL.where = nextTable.where;

            query = params.unparseSQL(newParsedSQL).replace(/`/g, '"');
            outputQueries[nextTable.from[0].table] = query.replace(
              "INDEX_NAME",
              "[INDEX_NAME]",
            );
          }
          nextTable = nextTable._next;
        }
        if (depth >= MAX_DEPTH) {
          throw new Error("Maximum query depth exceeded");
        }
      }
    }
    return outputQueries;
  } catch (error) {
    console.error("Error in extractValueQuery:", error);
    throw error;
  }
}

/**
 * Checks if SQL mode is non-aggregated (supports histogram)
 * 
 * @param sqlMode - Whether SQL mode is enabled
 * @param hasLimit - Whether query has LIMIT clause
 * @param hasDistinct - Whether query has DISTINCT clause
 * @param hasWith - Whether query has WITH clause
 * @param isHistogramEligible - Whether histogram is eligible
 * @returns true if non-aggregated SQL mode, false otherwise
 * 
 * @example
 * ```typescript
 * const isNonAgg = isNonAggregatedSQLMode(true, false, false, false, true);
 * // Returns: true (supports histogram)
 * ```
 */
export function isNonAggregatedSQLMode(
  sqlMode: boolean,
  hasLimit: boolean,
  hasDistinct: boolean,
  hasWith: boolean,
  isHistogramEligible: boolean
): boolean {
  return !(
    sqlMode &&
    (hasLimit || hasDistinct || hasWith || !isHistogramEligible)
  );
}

/**
 * Parses a non-SQL query into functions and where clause components
 * 
 * @param processedQuery - Processed query string
 * @returns Object with queryFunctions and whereClause
 * 
 * @example
 * ```typescript
 * const parsed = parseNonSQLQuery("count(*) | status = 'error' AND level = 'warn'");
 * // Returns: { queryFunctions: ",count(*)", whereClause: "WHERE status = 'error' AND level = 'warn'" }
 * ```
 */
export function parseNonSQLQuery(processedQuery: string): { queryFunctions: string; whereClause: string } {
  const parseQuery = processedQuery.split("|");
  const queryFunctions = parseQuery.length > 1 ? "," + parseQuery[0].trim() : "";
  let whereClause = parseQuery.length > 1 ? parseQuery[1].trim() : parseQuery[0].trim();

  // Clean up where clause by removing comments
  whereClause = whereClause
    .split("\n")
    .filter((line: string) => !line.trim().startsWith("--"))
    .join("\n");

  return {
    queryFunctions: queryFunctions.trim(),
    whereClause: whereClause.trim() !== "" ? "WHERE " + whereClause : ""
  };
}

/**
 * Quotes field names in a SQL where clause
 * 
 * @param whereClause - Where clause string
 * @param selectedStreamFields - Array of field objects with name property
 * @returns Where clause with quoted field names
 * 
 * @example
 * ```typescript
 * const quoted = quoteFieldNames("status = error", [{ name: "status" }]);
 * // Returns: '"status" = error'
 * ```
 */
export function quoteFieldNames(whereClause: string, selectedStreamFields: any[]): string {
  const parsedSQL = whereClause.split(" ");
  for (const field of selectedStreamFields) {
    for (const [index, node] of parsedSQL.entries()) {
      if (node === field.name) {
        parsedSQL[index] = '"' + node.replace(/"/g, "") + '"';
      }
    }
  }
  return parsedSQL.join(" ");
}