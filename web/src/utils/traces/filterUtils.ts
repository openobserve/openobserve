/**
 * Shared filter utilities for the Traces feature.
 * Canonical source — imported by SearchBar.vue and useTraces.ts.
 */

/**
 * Extracts the field name from a filter expression such as
 * `field='val'`, `field!='val'`, `(field='x' OR field='y')`, etc.
 */
export const getFieldFromExpression = (expression: string): string | null => {
  const cleaned = expression.trim().replace(/^\(\s*/, "");
  const match =
    cleaned.match(/^"[^"]+"\."?(\w+)"?\s*(?:=|!=|is)/i) ||
    cleaned.match(/^(\w+)\s*(?:=|!=|>=|<=|>|<|is)/i);
  return match ? match[1] : null;
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
): string | null => {
  const esc = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const valPat = `(?:'[^']*'|null|\\d+(?:\\.\\d+)?|true|false)`;
  const opPat = `(?:=|!=|>=|<=|>|<|is(?:\\s+not)?)`;
  const condPat = `(?:"[^"]+"\\.)?${esc}\\s*${opPat}\\s*${valPat}`;

  // Try parenthesized multi-value group first: (field = 'x' OR/AND field = 'y')
  const multiRegex = new RegExp(
    `\\(\\s*${condPat}(?:\\s+(?:OR|AND)\\s+${condPat})*\\s*\\)`,
    "gi",
  );
  if (multiRegex.test(queryStr)) {
    return queryStr.replace(multiRegex, newExpression);
  }

  // Try range condition: field >= val AND field <= val (e.g. duration filters)
  const rangeRegex = new RegExp(
    `${condPat}\\s+(?:and|AND)\\s+${condPat}`,
    "gi",
  );
  if (rangeRegex.test(queryStr)) {
    return queryStr.replace(rangeRegex, newExpression);
  }

  // Try single condition
  const singleRegex = new RegExp(condPat, "gi");
  if (singleRegex.test(queryStr)) {
    return queryStr.replace(singleRegex, newExpression);
  }

  return null;
};

/**
 * Applies a single filter term to a base editor value using replace-or-append logic.
 * Returns the new editor value.
 */
export const applyFilterTerm = (
  filterTerm: string,
  baseValue: string,
): string => {
  let filter = filterTerm;

  const isFilterValueNull = filter.split(/=|!=/)[1] === "'null'";
  if (isFilterValueNull) {
    filter = filter
      .replace(/=|!=/, (match) => {
        return match === "=" ? " is " : " is not ";
      })
      .replace(/'null'/, "null");
  }

  const parts = baseValue.split("|");
  if (parts.length > 1) {
    if (parts[1].trim() !== "") {
      const fieldName = getFieldFromExpression(filter);
      const replaced = fieldName
        ? replaceExistingFieldCondition(parts[1], fieldName, filter)
        : parts[1];
      parts[1] = replaced !== parts[1] ? replaced : parts[1] + " and " + filter;
    } else {
      parts[1] = filter;
    }
    return parts.join("| ");
  } else {
    const fieldName = getFieldFromExpression(filter);
    const replaced = fieldName
      ? replaceExistingFieldCondition(parts[0] as string, fieldName, filter)
      : (parts[0] as string);
      
    if (replaced !== null) return replaced;
    return (parts[0] as string) !== ""
      ? (parts[0] as string) + " and " + filter
      : filter;
  }
};

/**
 * Builds a SQL filter term from a field, value, and operator.
 * Handles null values and escapes single quotes.
 */
export const buildFilterTerm = (
  field: string,
  value: string,
  operator: "=" | "!=" = "=",
): string => {
  if (value === null || value === "null") {
    return operator === "=" ? `${field} is null` : `${field} is not null`;
  }
  const escaped = String(value).replace(/'/g, "''");
  return `${field} ${operator} '${escaped}'`;
};
