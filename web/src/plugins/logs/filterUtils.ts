// Copyright 2026 OpenObserve Inc.
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
 * Extracts the field name from a filter expression.
 * Handles single: `field = 'val'`, multi: `(field = 'x' OR field = 'y')`,
 * and SQL-prefixed: `"stream".field = 'val'`.
 */
export const getFieldFromExpression = (expression: string): string | null => {
  const cleaned = expression.trim().replace(/^\(\s*/, "");
  const match =
    cleaned.match(/^"[^"]+"\."?(\w+)"?\s*(?:=|!=|is)/i) ||
    cleaned.match(/^(\w+)\s*(?:=|!=|is)/i);
  return match ? match[1] : null;
};

/**
 * Builds the regex patterns used to match a field condition in a query string.
 * Both `hasFieldCondition` and `replaceExistingFieldCondition` share these patterns.
 */
const buildFieldRegexes = (
  fieldName: string,
): { multiRegex: RegExp; singleRegex: RegExp } => {
  const esc = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const valPat = `(?:'[^']*'|null|\\d+(?:\\.\\d+)?|true|false)`;
  const opPat = `(?:=|!=|is(?:\\s+not)?)`;
  const condPat = `(?:"[^"]+"\\.)?${esc}\\s*${opPat}\\s*${valPat}`;

  const multiRegex = new RegExp(
    `\\(\\s*${condPat}(?:\\s+(?:OR|AND)\\s+${condPat})*\\s*\\)`,
    "gi",
  );
  const singleRegex = new RegExp(condPat, "i");
  return { multiRegex, singleRegex };
};

/**
 * Checks whether a query string already contains an existing condition for
 * the given field name (single value or parenthesized multi-value group).
 *
 * This is used to distinguish between "no existing condition → append" and
 * "existing condition with same value → replace", which would otherwise both
 * produce an unchanged string from replaceExistingFieldCondition.
 */
export const hasFieldCondition = (
  queryStr: string,
  fieldName: string,
): boolean => {
  const { multiRegex, singleRegex } = buildFieldRegexes(fieldName);
  return multiRegex.test(queryStr) || singleRegex.test(queryStr);
};

/**
 * Tries to replace an existing condition for `fieldName` in `queryStr` with
 * `newExpression`. Returns the modified string, or the original if not found.
 * Handles both parenthesized multi-value groups and single conditions.
 */
export const replaceExistingFieldCondition = (
  queryStr: string,
  fieldName: string,
  newExpression: string,
): string => {
  const { multiRegex, singleRegex } = buildFieldRegexes(fieldName);

  // Try parenthesized multi-value group first: (field = 'x' OR/AND field = 'y')
  if (multiRegex.test(queryStr)) {
    return queryStr.replace(multiRegex, newExpression);
  }

  // Try single condition (replace first match only)
  if (singleRegex.test(queryStr)) {
    return queryStr.replace(singleRegex, newExpression);
  }

  return queryStr;
};
