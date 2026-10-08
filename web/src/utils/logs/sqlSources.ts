//  Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { Parser } from "@openobserve/node-sql-parser/build/datafusionsql";
import {
  lexicalParenDepth,
  SQL_PARSE_MAX_DEPTH,
  stripWherePredicate,
} from "@/utils/query/sqlComplexity";

export interface SqlSources {
  sources: string[];
  resolved: boolean;
}

interface Walk {
  out: Set<string>;
  truncated: boolean;
}

const MAX_DEPTH = 200;

const SELECT_WORD = /\bselect\b/gi;

let parser: Parser | null = null;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cteName(entry: unknown): string | null {
  if (!isObject(entry)) return null;
  const name = entry.name;
  if (typeof name === "string") return name;
  if (isObject(name) && typeof name.value === "string") return name.value;
  return null;
}

/** Walks a WITH list; each body sees only the CTEs before it (and itself when recursive). */
function collectCtes(
  entries: unknown[],
  scope: ReadonlySet<string>,
  walk: Walk,
  depth: number,
): Set<string> {
  const names = new Set(scope);
  for (const entry of entries) {
    const name = cteName(entry);
    const bodyScope = new Set(names);
    if (name && isObject(entry) && entry.recursive) bodyScope.add(name);
    collect(entry, bodyScope, walk, depth + 1);
    if (name) names.add(name);
  }
  return names;
}

/** CTE names are lexical: a WITH binds its own query (and its union branches), never a sibling. */
function collect(node: unknown, scope: ReadonlySet<string>, walk: Walk, depth: number): void {
  if (!isObject(node)) return;
  if (depth > MAX_DEPTH) {
    walk.truncated = true;
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collect(child, scope, walk, depth + 1));
    return;
  }
  const inner = Array.isArray(node.with) ? collectCtes(node.with, scope, walk, depth) : scope;
  if (node.type === "select" && Array.isArray(node.from)) {
    for (const item of node.from) {
      if (isObject(item) && typeof item.table === "string" && !inner.has(item.table)) {
        walk.out.add(item.table);
      }
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (key !== "with") collect(value, inner, walk, depth + 1);
  }
}

function countSelects(text: string): number {
  return text.match(SELECT_WORD)?.length ?? 0;
}

/** SQL that is safe to astify, or null; the parser is exponential in paren depth (SQL_PARSE_MAX_DEPTH). */
function parseableText(text: string): string | null {
  const depth = lexicalParenDepth(text);
  if (depth <= SQL_PARSE_MAX_DEPTH) return text;
  // Unreadable quoting or comments mean even the WHERE bounds are uncertain.
  if (!Number.isFinite(depth)) return null;
  const stripped = stripWherePredicate(text);
  // A dropped predicate holding a subquery could name a stream, so it may not be stripped.
  if (countSelects(stripped) !== countSelects(text)) return null;
  return lexicalParenDepth(stripped) <= SQL_PARSE_MAX_DEPTH ? stripped : null;
}

/** Physical streams a parsed SQL statement reads, across joins, unions, CTEs and subqueries. */
export function sqlSourcesFromAst(ast: unknown): SqlSources {
  const walk: Walk = { out: new Set<string>(), truncated: false };
  collect(ast, new Set<string>(), walk, 0);
  const sources = [...walk.out];
  return { sources, resolved: sources.length > 0 && !walk.truncated };
}

export function sqlSources(sql: string): SqlSources {
  const text = (sql ?? "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .trim();
  if (!text) return { sources: [], resolved: false };
  const parseable = parseableText(text);
  if (parseable === null) return { sources: [], resolved: false };
  try {
    parser = parser ?? new Parser();
    return sqlSourcesFromAst(parser.astify(parseable));
  } catch {
    return { sources: [], resolved: false };
  }
}
