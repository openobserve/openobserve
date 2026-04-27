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
  const esc = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const valPat = `(?:'[^']*'|null|\\d+(?:\\.\\d+)?|true|false)`;
  const opPat = `(?:=|!=|is(?:\\s+not)?)`;
  const condPat = `(?:"[^"]+"\\.)?${esc}\\s*${opPat}\\s*${valPat}`;

  const multiRegex = new RegExp(
    `\\(\\s*${condPat}(?:\\s+(?:OR|AND)\\s+${condPat})*\\s*\\)`,
    "gi",
  );
  if (multiRegex.test(queryStr)) return true;

  const singleRegex = new RegExp(condPat, "gi");
  return singleRegex.test(queryStr);
};

/**
 * Removes all conditions for `fieldName` from `queryStr`.
 * Handles both single conditions and parenthesized multi-value groups.
 * Cleans up dangling AND connectors after removal.
 */
export const removeFieldCondition = (
  queryStr: string,
  fieldName: string,
): string => {
  const esc = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Match both comparison operators (=, !=, <, >) and IS / IS NOT (for null checks)
  const fieldPattern = new RegExp(`^"?${esc}"?\\s*(?:[=!<>]|is\\s)`, "i");
  const multiPattern = new RegExp(`^\\(\\s*"?${esc}"?\\s*(?:[=!<>]|is\\s)`, "i");

  const remaining = queryStr
    .trim()
    .split(/\s+AND\s+/i)
    .filter((cond) => {
      const trimmed = cond.trim();
      return !fieldPattern.test(trimmed) && !multiPattern.test(trimmed);
    });

  return remaining.join(" AND ");
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
  const esc = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const valPat = `(?:'[^']*'|null|\\d+(?:\\.\\d+)?|true|false)`;
  const opPat = `(?:=|!=|is(?:\\s+not)?)`;
  const condPat = `(?:"[^"]+"\\.)?${esc}\\s*${opPat}\\s*${valPat}`;

  // Try parenthesized multi-value group first: (field = 'x' OR/AND field = 'y')
  const multiRegex = new RegExp(
    `\\(\\s*${condPat}(?:\\s+(?:OR|AND)\\s+${condPat})*\\s*\\)`,
    "gi",
  );
  if (multiRegex.test(queryStr)) {
    return queryStr.replace(multiRegex, newExpression);
  }

  // Try single condition
  const singleRegex = new RegExp(condPat, "gi");
  if (singleRegex.test(queryStr)) {
    return queryStr.replace(singleRegex, newExpression);
  }

  return queryStr;
};
