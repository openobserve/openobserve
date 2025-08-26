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

/**
 * Interface for multi-stream filter validation parameters
 */
export interface MultiStreamFilterParams {
  filterCondition: string;
  selectedStreamFields: any[];
  selectedStream: string[];
  fnParsedSQL: (query: string) => any;
  extractFilterColumns: (whereClause: any) => any[];
}

/**
 * Interface for multi-stream filter validation result
 */
export interface MultiStreamFilterResult {
  isValid: boolean;
  errorMessage: string;
  missingStreamMessage: string;
  missingStreamMultiStreamFilter: string[];
  filteredField: any[];
}

/**
 * Validates if a parsed SQL query contains a LIMIT clause
 * 
 * @param parsedSQL - Parsed SQL query object
 * @returns true if query has LIMIT clause, false otherwise
 * 
 * @example
 * ```typescript
 * const isLimit = validateLimitQuery(parsedSQL);
 * // Returns: true if parsedSQL.limit exists with values
 * ```
 */
export function validateLimitQuery(parsedSQL: any = null): boolean {
  return !!(parsedSQL?.limit && parsedSQL?.limit.value?.length > 0);
}

/**
 * Validates if a parsed SQL query contains a DISTINCT clause
 * 
 * @param parsedSQL - Parsed SQL query object
 * @returns true if query has DISTINCT clause, false otherwise
 * 
 * @example
 * ```typescript
 * const isDistinct = validateDistinctQuery(parsedSQL);
 * // Returns: true if parsedSQL.distinct.type === "DISTINCT"
 * ```
 */
export function validateDistinctQuery(parsedSQL: any = null): boolean {
  return !!(parsedSQL?.distinct?.type === "DISTINCT");
}

/**
 * Validates if a parsed SQL query contains a WITH (CTE) clause
 * 
 * @param parsedSQL - Parsed SQL query object
 * @returns true if query has WITH clause, false otherwise
 * 
 * @example
 * ```typescript
 * const isWithQuery = validateWithQuery(parsedSQL);
 * // Returns: true if parsedSQL.with exists and has elements
 * ```
 */
export function validateWithQuery(parsedSQL: any = null): boolean {
  return !!(parsedSQL?.with && parsedSQL?.with?.length > 0);
}

/**
 * Validates if a parsed SQL query contains aggregation functions
 * 
 * @param parsedSQL - Parsed SQL query object
 * @param queryString - Original query string for additional validation
 * @returns true if query has aggregation functions, false otherwise
 * 
 * @example
 * ```typescript
 * const hasAgg = validateAggregationQuery(parsedSQL, "SELECT COUNT(*) FROM logs");
 * // Returns: true if query contains aggregation functions or GROUP BY
 * ```
 */
export function validateAggregationQuery(parsedSQL: any = null, queryString: string = ""): boolean {
  // Check for aggregation functions in columns
  if (parsedSQL?.columns) {
    for (const column of parsedSQL.columns) {
      if (column.expr && column.expr.type === "aggr_func") {
        return true;
      }
    }
  }

  // Check for GROUP BY in the query string as fallback
  if (queryString && queryString.toLowerCase().includes("group by")) {
    return true;
  }

  return false;
}

/**
 * Validates filter conditions for multi-stream searches
 * 
 * @param params - Parameters for multi-stream filter validation
 * @returns Validation result with error messages and filtered fields
 * 
 * @example
 * ```typescript
 * const result = validateMultiStreamFilter({
 *   filterCondition: "status = 'error'",
 *   selectedStreamFields: [...],
 *   selectedStream: ["logs", "traces"],
 *   fnParsedSQL: (query) => parser.parse(query),
 *   extractFilterColumns: (where) => extractColumns(where)
 * });
 * // Returns: { isValid: boolean, errorMessage: string, ... }
 * ```
 */
export function validateMultiStreamFilter(params: MultiStreamFilterParams): MultiStreamFilterResult {
  const result: MultiStreamFilterResult = {
    isValid: true,
    errorMessage: "",
    missingStreamMessage: "",
    missingStreamMultiStreamFilter: [],
    filteredField: []
  };

  try {
    const parsedSQL = params.fnParsedSQL("select * from stream where " + params.filterCondition);
    result.filteredField = params.extractFilterColumns(parsedSQL?.where);

    for (const fieldObj of result.filteredField) {
      const fieldName = fieldObj.expr.value;
      const filteredFields = params.selectedStreamFields.filter(
        (field: any) => field.name === fieldName
      );

      if (filteredFields.length > 0) {
        const streamsCount = filteredFields[0].streams.length;
        const allStreamsEqual = filteredFields.every(
          (field: any) => field.streams.length === streamsCount
        );
        
        if (!allStreamsEqual) {
          result.errorMessage += `Field '${fieldName}' exists in different number of streams.\n`;
        }
      } else {
        result.errorMessage += `Field '${fieldName}' does not exist in the one or more stream.\n`;
      }

      const fieldStreams = params.selectedStreamFields
        .filter((field: any) => field.name === fieldName)
        .map((field: any) => field.streams)
        .flat();

      result.missingStreamMultiStreamFilter = params.selectedStream.filter(
        (stream: any) => !fieldStreams.includes(stream)
      );

      if (result.missingStreamMultiStreamFilter.length > 0) {
        result.missingStreamMessage = `One or more filter fields do not exist in "${result.missingStreamMultiStreamFilter.join(
          ", "
        )}", hence no search is performed in the mentioned stream.\n`;
      }
    }

    result.isValid = result.errorMessage === "";
    return result;
  } catch (error) {
    console.error("Error validating multi-stream filter:", error);
    result.isValid = false;
    result.errorMessage = "Failed to validate filter conditions";
    return result;
  }
}

/**
 * Validates if a query string has proper SQL syntax
 * 
 * @param queryString - SQL query string to validate
 * @param fnParsedSQL - Function to parse SQL
 * @returns true if query is valid SQL, false otherwise
 * 
 * @example
 * ```typescript
 * const isValid = validateSQLSyntax("SELECT * FROM logs", parseSQLFunction);
 * // Returns: true if query parses without errors
 * ```
 */
export function validateSQLSyntax(queryString: string, fnParsedSQL: (query: string) => any): boolean {
  try {
    if (!queryString || typeof queryString !== 'string' || queryString.trim() === '') {
      return false;
    }

    const parsedSQL = fnParsedSQL(queryString);
    return parsedSQL !== null && parsedSQL !== undefined;
  } catch (error) {
    console.error("SQL syntax validation error:", error);
    return false;
  }
}

/**
 * Validates if a stream name is valid
 * 
 * @param streamName - Stream name to validate
 * @returns true if stream name is valid, false otherwise
 * 
 * @example
 * ```typescript
 * const isValid = validateStreamName("my-logs-stream");
 * // Returns: true if stream name follows naming conventions
 * ```
 */
export function validateStreamName(streamName: string): boolean {
  if (!streamName || typeof streamName !== 'string') {
    return false;
  }

  // Stream name should not be empty and should not contain special characters that could cause issues
  const validStreamNamePattern = /^[a-zA-Z0-9_-]+$/;
  return validStreamNamePattern.test(streamName) && streamName.length > 0 && streamName.length <= 100;
}

/**
 * Validates if selected streams array is valid
 * 
 * @param streams - Array of stream names to validate
 * @returns true if all streams are valid, false otherwise
 * 
 * @example
 * ```typescript
 * const isValid = validateSelectedStreams(["logs", "traces", "metrics"]);
 * // Returns: true if all stream names are valid
 * ```
 */
export function validateSelectedStreams(streams: string[]): boolean {
  if (!Array.isArray(streams) || streams.length === 0) {
    return false;
  }

  return streams.every(stream => validateStreamName(stream));
}

/**
 * Validates if a field name is valid
 * 
 * @param fieldName - Field name to validate
 * @returns true if field name is valid, false otherwise
 * 
 * @example
 * ```typescript
 * const isValid = validateFieldName("timestamp");
 * // Returns: true if field name is valid
 * ```
 */
export function validateFieldName(fieldName: string): boolean {
  if (!fieldName || typeof fieldName !== 'string') {
    return false;
  }

  // Field names should be valid identifiers
  const validFieldNamePattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  return validFieldNamePattern.test(fieldName) && fieldName.length > 0 && fieldName.length <= 200;
}

/**
 * Validates if a timestamp range is valid
 * 
 * @param startTime - Start timestamp in milliseconds
 * @param endTime - End timestamp in milliseconds
 * @returns true if timestamp range is valid, false otherwise
 * 
 * @example
 * ```typescript
 * const isValid = validateTimestampRange(1609459200000, 1609545600000);
 * // Returns: true if range is valid (start < end, both positive)
 * ```
 */
export function validateTimestampRange(startTime: number, endTime: number): boolean {
  if (typeof startTime !== 'number' || typeof endTime !== 'number') {
    return false;
  }

  if (isNaN(startTime) || isNaN(endTime)) {
    return false;
  }

  // Start time should be before end time
  if (startTime >= endTime) {
    return false;
  }

  // Timestamps should be positive and within reasonable range
  const minTimestamp = 0;
  const maxTimestamp = Date.now() + (365 * 24 * 60 * 60 * 1000); // 1 year in future

  return startTime >= minTimestamp && startTime <= maxTimestamp &&
         endTime >= minTimestamp && endTime <= maxTimestamp;
}

/**
 * Validates if pagination parameters are valid
 * 
 * @param currentPage - Current page number (1-based)
 * @param rowsPerPage - Number of rows per page
 * @returns true if pagination parameters are valid, false otherwise
 * 
 * @example
 * ```typescript
 * const isValid = validatePaginationParams(1, 50);
 * // Returns: true if page >= 1 and rowsPerPage > 0 and reasonable
 * ```
 */
export function validatePaginationParams(currentPage: number, rowsPerPage: number): boolean {
  if (typeof currentPage !== 'number' || typeof rowsPerPage !== 'number') {
    return false;
  }

  if (isNaN(currentPage) || isNaN(rowsPerPage)) {
    return false;
  }

  // Current page should be >= 1
  if (currentPage < 1) {
    return false;
  }

  // Rows per page should be reasonable (between 1 and 1000)
  if (rowsPerPage < 1 || rowsPerPage > 1000) {
    return false;
  }

  return true;
}