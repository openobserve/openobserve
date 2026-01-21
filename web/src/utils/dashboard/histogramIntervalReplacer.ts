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
 * Replaces histogram intervals in SQL queries while preserving the original query structure
 *
 * This function uses regex to find and replace histogram intervals without parsing
 * and regenerating the entire SQL string, which preserves formatting, case, and whitespace.
 *
 * @param query - The SQL query string containing histogram function(s)
 * @param newInterval - The new interval string (e.g., '5 minutes'), or null to remove interval
 * @returns The updated query string with replaced intervals
 *
 * @example
 * replaceHistogramInterval("SELECT histogram(_timestamp, '30 seconds')", "1 minute")
 * // Returns: "SELECT histogram(_timestamp, '1 minute')"
 *
 * @example
 * replaceHistogramInterval("SELECT HISTOGRAM(_timestamp)", "5 minutes")
 * // Returns: "SELECT HISTOGRAM(_timestamp, '5 minutes')"
 */
export function replaceHistogramInterval(query: string, newInterval: string | null): string {
  // Capture whitespace and case to preserve the original query structure
  // Pattern captures: HISTOGRAM(ws1)(ws2)field(ws3)[,(ws4)interval(ws5)]
  const histogramPattern = /(histogram)(\s*)\((\s*)([^,)]+?)(\s*)(?:,(\s*)['"][^'"]*['"](\s*))?\)/gi;

  return query.replace(histogramPattern, (_match: string, histogramKeyword: string, ws1: string, ws2: string, field: string, ws3: string, ws4?: string) => {
    if (newInterval) {
      // Determine space after comma:
      // - If there are multiple spaces in BOTH ws2 and ws3, normalize to single space
      // - Otherwise, preserve exactly 1 or 2 spaces if original had them
      // - Normalize tabs, newlines, or 3+ spaces to single space
      // - Default to single space if no interval existed
      let spaceAfterComma = ' ';
      if (ws4 !== undefined) {
        // Check if this is an "over-spaced" query (spaces everywhere)
        const isOverSpaced = ws2.length >= 2 && ws3.length >= 2;
        if (isOverSpaced) {
          // Normalize to single space
          spaceAfterComma = ' ';
        } else if (ws4 === ' ' || ws4 === '  ') {
          // Preserve 1 or 2 spaces exactly
          spaceAfterComma = ws4;
        } else {
          // Tabs, newlines, or 3+ spaces - normalize to single space
          spaceAfterComma = ' ';
        }
      }
      return `${histogramKeyword}${ws1}(${ws2}${field}${ws3},${spaceAfterComma}'${newInterval}')`;
    } else {
      // No interval: histogram(ws1)(ws2)field
      return `${histogramKeyword}${ws1}(${ws2}${field})`;
    }
  });
}
