// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

interface SqlParser {
  astify: (sql: string) => unknown;
  exprToSQL: (expr: unknown) => string;
}

interface SelectAst {
  type?: string;
  with?: unknown;
  distinct?: { type?: string | null } | null;
  columns?: { expr?: { type?: string } }[] | string;
  from?: { join?: unknown; expr?: unknown }[] | null;
  where?: unknown;
  groupby?: unknown;
  having?: unknown;
  _next?: unknown;
}

const hasSubquery = (node: unknown): boolean => {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some(hasSubquery);
  const obj = node as Record<string, unknown>;
  if (obj.ast || obj.type === "select") return true;
  return Object.values(obj).some(hasSubquery);
};

// The parser prints identifiers in backticks; string literals may hold backticks of their own.
const quoteIdentifiers = (where: string): string =>
  where
    .split(/('(?:[^']|'')*')/)
    .map((part, i) => (i % 2 ? part : part.replace(/`/g, '"')))
    .join("");

const fitsFilter = (ast: SelectAst): boolean => {
  if (ast.type !== "select" || !ast.where) return false;
  if (ast.with || ast.distinct?.type || ast.groupby || ast.having || ast._next) return false;
  if ((ast.from ?? []).length !== 1 || ast.from?.some((f) => f.join || f.expr)) return false;
  const columns = Array.isArray(ast.columns) ? ast.columns : [];
  // approx_* aggregates and window functions parse as other types, so only plain columns pass.
  if (columns.some((c) => c.expr?.type !== "column_ref")) return false;
  return !hasSubquery(ast.where);
};

/** The WHERE of AI-generated SQL as a Traces filter, or null when a filter cannot hold that query. */
export const nlSqlToTracesFilter = (sql: string, parser: unknown): string | null => {
  const sqlParser = parser as SqlParser | null;
  if (!sqlParser?.astify || !sql?.trim()) return null;
  try {
    const parsed = sqlParser.astify(sql);
    if (Array.isArray(parsed) && parsed.length !== 1) return null;
    const ast = (Array.isArray(parsed) ? parsed[0] : parsed) as SelectAst;
    if (!ast || !fitsFilter(ast)) return null;
    const where = sqlParser.exprToSQL(ast.where);
    return where ? quoteIdentifiers(where) : null;
  } catch {
    return null;
  }
};
