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

import { searchState } from "@/composables/useLogs/searchState";
import { Parser } from "@openobserve/node-sql-parser/build/datafusionsql";

interface SQLColumn {
  expr: any;
  as?: string;
}

interface SQLFrom {
  table: string;
  as?: string;
}

interface SQLOrderBy {
  expr: any;
  type: "ASC" | "DESC";
}

interface SQLLimit {
  seperator?: string;
  value: number[];
}

interface SQLGroupBy {
  type: string;
  value: any;
}[];

interface SQLWhere {
  type: string;
  left: any;
  operator: string;
  right: any;
}

interface ParsedSQLResult {
  columns: SQLColumn[];
  from: SQLFrom[];
  orderby: SQLOrderBy[] | null;
  limit: SQLLimit | null;
  groupby: SQLGroupBy | null;
  where: SQLWhere | null;
}


const { searchObj } = searchState();
let parser: Parser | null = new Parser();

const DEFAULT_PARSED_RESULT: ParsedSQLResult = {
  columns: [],
  from: [],
  orderby: null,
  limit: null,
  groupby: null,
  where: null,
} as const;

/**
 * Parses a SQL query string into a structured AST (Abstract Syntax Tree) object.
 * 
 * This function takes a SQL query string, removes comment lines (lines starting with '--'),
 * and parses it using the DataFusion SQL parser to return a structured object containing
 * the query components like columns, tables, conditions, etc.
 * 
 * @param queryString - The SQL query string to parse. If empty or not provided, 
 *                      it will use the query from searchObj.data.query
 * @returns A ParsedSQLResult object containing structured SQL components:
 *          - columns: Array of selected columns
 *          - from: Array of tables/sources
 *          - orderby: ORDER BY clauses (null if none)
 *          - limit: LIMIT clause (null if none)
 *          - groupby: GROUP BY clauses (null if none)
 *          - where: WHERE conditions (null if none)
 * 
 * @example
 * ```typescript
 * const result = fnParsedSQL("SELECT name, age FROM users WHERE age > 25");
 * console.log(result.columns); // Array of column definitions
 * console.log(result.from);    // Array with 'users' table
 * console.log(result.where);   // WHERE condition object
 * ```
 */
export const fnParsedSQL = (queryString: string = ""): ParsedSQLResult => {
  try {
    const finalQueryString: string = queryString || searchObj.data.query;
    const filteredQuery: string = finalQueryString
      .split("\n")
      .filter((line: string) => !line.trim().startsWith("--"))
      .join("\n");

    const parsedQuery: ParsedSQLResult | null = parser?.astify(
      filteredQuery,
    ) as unknown as ParsedSQLResult;
    return parsedQuery || DEFAULT_PARSED_RESULT;

    // return convertPostgreToMySql(parser.astify(filteredQuery));
  } catch {
    return DEFAULT_PARSED_RESULT;
  }
};

/**
 * Converts a parsed SQL AST object back into a SQL query string.
 * 
 * This function takes a structured SQL object (typically returned by fnParsedSQL)
 * and converts it back into a valid SQL query string using the DataFusion SQL parser.
 * 
 * @param parsedObj - The parsed SQL object to convert back to string.
 *                    Can be a ParsedSQLResult interface or any AST object
 *                    from the SQL parser
 * @returns A SQL query string representation of the parsed object.
 *          Returns empty string if parsing fails or input is invalid
 * 
 * @example
 * ```typescript
 * const parsedSQL = fnParsedSQL("SELECT * FROM users");
 * const sqlString = fnUnparsedSQL(parsedSQL);
 * console.log(sqlString); // "SELECT * FROM users"
 * ```
 * 
 * @example
 * ```typescript
 * // Handle conversion errors gracefully
 * const malformedObj = { invalid: "structure" };
 * const result = fnUnparsedSQL(malformedObj);
 * console.log(result); // "" (empty string on error)
 * ```
 */
export const fnUnparsedSQL = (parsedObj: ParsedSQLResult | any): string => {
  try {
    const sql: string | undefined = parser?.sqlify(parsedObj);
    return sql || "";
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.info(`Error while unparsing SQL : ${errorMessage}`);
    return "";
  }
};
