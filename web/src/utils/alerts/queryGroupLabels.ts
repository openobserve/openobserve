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
  for (const match of query.matchAll(/\bby\s*\(([^)]*)\)/gi)) {
    match[1]
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean)
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
