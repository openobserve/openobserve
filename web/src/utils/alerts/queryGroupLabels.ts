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

// Calls that return one series, unless an aggregation keeps labels with a trailing `by`/`without`.
const COLLAPSING_CALL =
  /\b(?:sum|avg|min|max|count|stddev|stdvar|group|quantile|count_values|scalar|vector|time|absent|absent_over_time)\s*\(/gi;
const SELECTOR =
  /(?:^|[^\w.])(?!(?:and|or|unless|bool|offset|on|ignoring|group_left|group_right)\b)[a-z_:][\w:]*\b(?!\s*\()/i;

/** The columns a SQL query groups by, in order; the first GROUP BY wins. */
export function sqlGroupByLabels(sql: string): string[] {
  const clause = /\bgroup\s+by\s+([\s\S]*?)(?=\s+(?:having|order\s+by|limit|qualify)\b|;|$)/i.exec(
    sql,
  );
  if (!clause) return [];
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of clause[1]) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  const labels = parts.map((p) => p.trim().replace(/^["'`](.*)["'`]$/, "$1")).filter(Boolean);
  return [...new Set(labels)];
}

/** Every label a PromQL query aggregates `by`, across all its `by (...)` clauses. */
export function promqlByLabels(query: string): string[] {
  const labels = new Set<string>();
  // histogram_quantile consumes the bucket bound, so its result is never split by it.
  const quantile = /\bhistogram_quantile\s*\(/i.test(query);
  for (const match of query.matchAll(/\bby\s*\(([^)]*)\)/gi)) {
    match[1]
      .split(",")
      .map((label) => label.trim())
      .filter((label) => label && !(quantile && label === "le"))
      .forEach((label) => labels.add(label));
  }
  return [...labels];
}

/** The comparison a PromQL rule ends with (`… > 0.85`), or null when it ends in anything else. */
export function promqlTrailingComparison(
  query: string,
): { operator: string; value: number } | null {
  // `> bool 0.85` returns every series as 0 or 1, so it is not a filter on the value.
  const match = /(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*$/i.exec(query.trim());
  return match ? { operator: match[1], value: Number(match[2]) } : null;
}

const closingParen = (text: string, open: number): number => {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    if (text[i] === ")" && --depth === 0) return i;
  }
  return text.length - 1;
};

/** Whether a PromQL query can return several series: a selector or a `by`/`without` survives every call
 * that collapses to one series. `by (le)` alone is consumed by histogram_quantile, so it keeps nothing. */
export function promqlKeepsLabels(query: string): boolean {
  const text = query
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')
    .replace(/\{[^}]*\}|\[[^\]]*\]/g, " ")
    .replace(/\bby\s*\(\s*(?:le\s*)?\)/gi, " ");
  let rest = "";
  let from = 0;
  for (const call of text.matchAll(COLLAPSING_CALL)) {
    if (call.index < from) continue;
    const end = closingParen(text, call.index + call[0].length - 1);
    if (/^\s*(?:by|without)\s*\(/i.test(text.slice(end + 1))) continue;
    rest += `${text.slice(from, call.index)} 0 `;
    from = end + 1;
  }
  rest += text.slice(from);
  return /\b(?:by|without)\s*\(/i.test(rest) || SELECTOR.test(rest);
}
