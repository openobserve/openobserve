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
import {
  TimestampRange,
  ParsedSQLResult,
  TimePeriodUnit,
} from "@/ts/interfaces";
import { TIME_MULTIPLIERS, } from "@/utils/logs/constants";

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

/**
 * Extracts timestamp range based on a relative time period string.
 *
 * This function parses a time period string (e.g., "5m", "2h", "1d") and returns
 * a timestamp range from the calculated past time to the current time. It supports
 * seconds, minutes, hours, days, weeks, and months with special handling for
 * month calculations to account for variable month lengths.
 *
 * @param period - Time period string ending with unit (s/m/h/d/w/M)
 *                 Examples: "30s", "5m", "2h", "1d", "1w", "1M"
 * @returns Object containing 'from' and 'to' timestamps in milliseconds,
 *          or undefined if the period format is invalid
 *
 * @example
 * ```typescript
 * // Get timestamps for last 5 minutes
 * const range = extractTimestamps("5m");
 * console.log(range); // { from: 1640000000000, to: 1640000300000 }
 *
 * // Get timestamps for last 2 hours
 * const hourRange = extractTimestamps("2h");
 * console.log(hourRange); // { from: 1639992800000, to: 1640000000000 }
 *
 * // Handle invalid format
 * const invalid = extractTimestamps("5x");
 * console.log(invalid); // undefined
 * ```
 *
 * @throws {Error} Logs error to console for invalid period formats
 */
export const extractTimestamps = (
  period: string,
): TimestampRange | undefined => {
  if (!period || typeof period !== "string") {
    console.error("Invalid period: must be a non-empty string");
    return undefined;
  }

  const currentTime = new Date();
  const toTimestamp = currentTime.getTime();
  const unit = period.slice(-1) as TimePeriodUnit;
  const value = parseInt(period.slice(0, -1), 10);

  // Validate parsed value
  if (isNaN(value) || value <= 0) {
    console.error(
      `Invalid period value: "${period}". Must be a positive number followed by unit (s/m/h/d/w/M)`,
    );
    return undefined;
  }

  let fromTimestamp: number;

  // Handle month calculation separately due to variable month lengths
  if (unit === "M") {
    const monthsToSubtract = value;
    const fromDate = new Date(currentTime);
    fromDate.setMonth(fromDate.getMonth() - monthsToSubtract);
    fromTimestamp = fromDate.getTime();
  } else if (unit in TIME_MULTIPLIERS) {
    // Handle standard time units
    const multiplier = TIME_MULTIPLIERS[unit];
    fromTimestamp = toTimestamp - value * multiplier;
  } else {
    console.error(
      `Invalid period unit: "${unit}". Supported units: s, m, h, d, w, M`,
    );
    return undefined;
  }

  return {
    from: fromTimestamp,
    to: toTimestamp,
  };
};
