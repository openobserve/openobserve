/**
 * Shared filter utilities for the Traces feature.
 * Canonical source — imported by SearchBar.vue and useTraces.ts.
 */

// A SQL string literal; a quote inside it is doubled ('O''Brien').
const SQL_STRING = `'(?:[^']|'')*'`;
// O2 field names may start with a digit (format_key keeps digits anywhere).
const SIMPLE_CONDITION = new RegExp(
  `^(?:"[^"]+"\\.)?"?(\\w[\\w.]*)"?(?:\\s*(=|!=|<>)\\s*(${SQL_STRING}|-?\\d+(?:\\.\\d+)?|true|false)|\\s+(is(?:\\s+not)?)\\s+null)$`,
  "i",
);

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
  const valPat = `(?:${SQL_STRING}|null|\\d+(?:\\.\\d+)?|true|false)`;
  const opPat = `(?:=|!=|>=|<=|>|<|is(?:\\s+not)?)`;
  // The lookbehind stops `operation_name` from matching inside `db_operation_name`.
  const condPat = `(?<!\\w)(?:"[^"]+"\\.)?${esc}\\s*${opPat}\\s*${valPat}`;

  // Try parenthesized multi-value group first: (field = 'x' OR/AND field = 'y')
  const multiRegex = new RegExp(`\\(\\s*${condPat}(?:\\s+(?:OR|AND)\\s+${condPat})*\\s*\\)`, "gi");
  if (multiRegex.test(queryStr)) {
    return queryStr.replace(multiRegex, newExpression);
  }

  // Try range condition: field >= val AND field <= val (e.g. duration filters)
  const rangeRegex = new RegExp(`${condPat}\\s+(?:and|AND)\\s+${condPat}`, "gi");
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
 * Removes all conditions for `fieldName` from `queryStr`.
 * The whole string is treated as the WHERE clause. Cleans up dangling AND
 * connectors after removal.
 */
export const removeFieldCondition = (queryStr: string, fieldName: string): string => {
  const esc = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Operators: comparison (= != > < >= <=) or `IS` (covers IS NULL / IS NOT
  // NULL produced for null-value filters). Without `is`, null conditions were
  // never matched and stayed in the query after the value was unchecked.
  const op = `(?:[=!<>]|is\\b)`;
  const fieldPattern = new RegExp(`^"?${esc}"?\\s*${op}`, "i");
  const multiPattern = new RegExp(`^\\(\\s*"?${esc}"?\\s*${op}`, "i");

  const removeFromClause = (clause: string): string => {
    const remaining = clause
      .trim()
      .split(/\s+AND\s+/i)
      .filter((cond) => {
        const trimmed = cond.trim();
        return !fieldPattern.test(trimmed) && !multiPattern.test(trimmed);
      });
    return remaining.join(" AND ");
  };

  // The whole string is the where clause. Do not split on "|": the legacy
  // "function | where" syntax is gone, and the split is quote-unaware, so a pipe
  // inside a term such as match_all('text | error') would hide the conditions
  // before the pipe from removal and corrupt the term on rejoin.
  return removeFromClause(queryStr);
};

/**
 * Applies a single filter term to a base editor value using replace-or-append logic.
 * Returns the new editor value.
 */
export const applyFilterTerm = (filterTerm: string, baseValue: string): string => {
  let filter = filterTerm;

  const isFilterValueNull = filter.split(/=|!=/)[1] === "'null'";
  if (isFilterValueNull) {
    filter = filter
      .replace(/=|!=/, (match) => {
        return match === "=" ? " is " : " is not ";
      })
      .replace(/'null'/, "null");
  }

  // The whole base value is the where clause — never split it on "|". The split
  // is quote-unaware, so a pipe inside a term such as match_all('text | error')
  // would be rejoined as "| " and silently alter the search term.
  const fieldName = getFieldFromExpression(filter);
  const replaced = fieldName ? replaceExistingFieldCondition(baseValue, fieldName, filter) : null;

  if (replaced !== null) return replaced;

  return baseValue !== "" ? baseValue + " and " + filter : filter;
};

/** Merges a span filter term into the explorer query: `=` replaces the field's top-level `=` conditions, any other term is appended unless already there. */
export const mergeFilterTerm = (term: string, baseQuery: string): string => {
  const base = baseQuery.trim();
  if (!base) return term;
  // ANDing onto a bare top-level OR would bind only to its last branch.
  if (splitTopLevel(base, "or").length > 1) return `(${base}) and ${term}`;

  const conjuncts = splitTopLevel(base, "and");
  const incoming = parseSimpleCondition(term);
  if (incoming?.operator === "=") {
    const isSameFieldEquality = (c: string) => {
      const cond = parseSimpleCondition(c);
      return cond?.field === incoming.field && cond.operator === "=";
    };
    const first = conjuncts.findIndex(isSameFieldEquality);
    if (first === -1) return `${base} and ${term}`;
    return conjuncts
      .map((c, i) => (i === first ? term : c))
      .filter((c, i) => i === first || !isSameFieldEquality(c))
      .join(" and ");
  }

  const key = conditionKey(term);
  return conjuncts.some((c) => conditionKey(c) === key) ? base : `${base} and ${term}`;
};

/** Merges each top-level `and` condition of `pending` into `baseQuery` with mergeFilterTerm's rules. */
export const mergePendingFilters = (pending: string, baseQuery: string): string => {
  const conditions = pending.trim();
  if (!conditions) return baseQuery;
  // Splitting a pending top-level or on `and` would AND its branches apart.
  const terms =
    splitTopLevel(conditions, "or").length > 1
      ? [`(${conditions})`]
      : splitTopLevel(conditions, "and");
  return terms.reduce((query, term) => mergeFilterTerm(term, query), baseQuery);
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

/** Splits `query` on a top-level `and`/`or`, skipping quoted text and parenthesised groups. */
const splitTopLevel = (query: string, keyword: "and" | "or"): string[] => {
  // SQL lets the keyword touch a parenthesis: `a = '1' or(b = '2')`, `(a = '1')or b`.
  const separator = new RegExp(`^\\s*${keyword}(?:\\s+|(?=\\())`, "i");
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    if (quote) {
      if (ch === quote && query[i + 1] === quote) i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth !== 0 || (ch !== ")" && !/\s/.test(ch))) continue;
    const end = ch === ")" ? i + 1 : i;
    const match = separator.exec(query.slice(end));
    if (match) {
      parts.push(query.slice(start, end).trim());
      i = end + match[0].length - 1;
      start = i + 1;
    }
  }
  parts.push(query.slice(start).trim());
  return parts.filter((p) => p !== "");
};

/** `is null` parses as an `=` on null, since buildFilterTerm emits it for an `=` on a null value. */
const parseSimpleCondition = (
  condition: string,
): { field: string; operator: "=" | "!="; value: string } | null => {
  const match = SIMPLE_CONDITION.exec(condition.trim());
  if (!match) return null;
  const [, field, operator, value, isOperator] = match;
  const negated = isOperator ? /not/i.test(isOperator) : operator !== "=";
  // Unquoted SQL identifiers are case-insensitive, and O2 stores field names lowercase.
  return { field: field.toLowerCase(), operator: negated ? "!=" : "=", value: value ?? "null" };
};

const conditionKey = (condition: string): string => {
  const cond = parseSimpleCondition(condition);
  if (cond) return `${cond.field} ${cond.operator} ${cond.value}`;
  return condition.trim().replace(/\s+/g, " ").toLowerCase();
};
