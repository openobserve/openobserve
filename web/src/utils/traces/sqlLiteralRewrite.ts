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

interface LiteralSpan {
  start: number;
  end: number; // exclusive, includes the closing quote
  inner: string; // raw text between the quotes, escapes untouched
}

const MARKER_PREFIX = "__o2lit_";
const MARKER_RE = /^__o2lit_(\d+)__$/;

/** `''` and a backslash escape do not terminate a literal, matching the SQL parser. */
const scanLiterals = (sql: string): LiteralSpan[] | null => {
  const spans: LiteralSpan[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === '"' || ch === "`") {
      const close = sql.indexOf(ch, i + 1);
      if (close === -1) return null;
      i = close + 1;
    } else if (ch === "'") {
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) return null;
        if (sql[j] === "\\") j += 2;
        else if (sql[j] === "'") {
          if (sql[j + 1] === "'") j += 2;
          else break;
        } else j += 1;
      }
      spans.push({ start: i, end: j + 1, inner: sql.slice(i + 1, j) });
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return spans;
};

export interface LiteralNode {
  type: string;
  value: string;
  /** Original literal text between the quotes (escapes untouched). */
  raw: string;
}

/** Splices only the replaced literals into the original text, preserving every other byte. */
export const rewriteWhereLiterals = (
  whereClause: string,
  parser: { astify: (sql: string) => unknown },
  streamName: string,
  visit: (where: unknown) => Map<LiteralNode, string>,
): string | null => {
  const spans = scanLiterals(whereClause);
  if (!spans) return null;

  // Indexed markers map AST nodes back to their exact position in the original text.
  let masked = "";
  let cursor = 0;
  spans.forEach((span, idx) => {
    masked += whereClause.slice(cursor, span.start) + `'${MARKER_PREFIX}${idx}__'`;
    cursor = span.end;
  });
  masked += whereClause.slice(cursor);

  const parsed = parser.astify(`SELECT * FROM "${streamName}" WHERE ${masked}`);
  const ast = (Array.isArray(parsed) ? parsed[0] : parsed) as { where?: unknown } | undefined;
  const where = ast?.where;

  const nodeIndex = new Map<unknown, number>();
  const restore = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(restore);
      return;
    }
    const node = value as Partial<LiteralNode>;
    if (typeof node.value === "string") {
      const m = node.value.match(MARKER_RE);
      if (m) {
        const idx = Number(m[1]);
        node.value = spans[idx].inner;
        node.raw = spans[idx].inner;
        nodeIndex.set(node, idx);
        return;
      }
    }
    Object.values(value).forEach(restore);
  };
  restore(where);

  const replacements = visit(where);
  if (replacements.size === 0) return whereClause;

  const byIndex = new Map<number, string>();
  replacements.forEach((text, node) => {
    const idx = nodeIndex.get(node);
    if (idx !== undefined) byIndex.set(idx, text);
  });

  let out = "";
  cursor = 0;
  spans.forEach((span, idx) => {
    const text = byIndex.get(idx);
    if (text === undefined) return;
    out += whereClause.slice(cursor, span.start) + text;
    cursor = span.end;
  });
  return out + whereClause.slice(cursor);
};
