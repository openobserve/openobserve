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

import useParser from "@/composables/useParser";

import { closingOf, endOfString, maskVariables, StreamRewriteError } from "./streamRewriter";
import type { PackBinding } from "./types";

export interface FieldRename {
  from: string;
  to: string;
}

const LABEL_LIST = /\b(?:by|without|on|ignoring|group_left|group_right)\s*\(/gi;
const MATCHER_LABEL = /^\s*,?\s*([a-zA-Z_]\w*)\s*(?:=~|!~|!=|=)/;
// These name labels inside string arguments, which a rename by position cannot reach.
const STRING_LABEL_FUNCTIONS = /\b(?:label_replace|label_join)\s*\(/;

interface Span {
  start: number;
  end: number;
  name: string;
}

const matcherLabels = (text: string, open: number, close: number): Span[] => {
  const spans: Span[] = [];
  let index = open + 1;
  while (index < close) {
    const match = text.slice(index, close).match(MATCHER_LABEL);
    if (!match) break;
    const end = index + match[0].search(/(?:=~|!~|!=|=)/);
    const start = index + match[0].indexOf(match[1]);
    spans.push({ start, end: start + match[1].length, name: match[1] });
    const quote = text.slice(end).search(/["'`]/) + end;
    index = endOfString(text, quote) + 1;
  }
  return spans;
};

const listLabels = (text: string, open: number, close: number): Span[] =>
  [...text.slice(open + 1, close).matchAll(/[a-zA-Z_]\w*/g)].map((match) => {
    const start = open + 1 + (match.index ?? 0);
    return { start, end: start + match[0].length, name: match[0] };
  });

const promqlLabelSpans = (text: string): Span[] => {
  const spans: Span[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' || char === "'" || char === "`") {
      index = endOfString(text, index);
    } else if (char === "{") {
      const close = closingOf(text, index, "{", "}");
      spans.push(...matcherLabels(text, index, close));
      index = close;
    }
  }
  for (const match of text.matchAll(LABEL_LIST)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    spans.push(...listLabels(text, open, closingOf(text, open, "(", ")")));
  }
  return spans;
};

/** Renames labels in selectors and label lists, leaving metric names and values alone. */
export const renamePromqlLabels = (query: string, renames: FieldRename[]): string => {
  const map = new Map(renames.map(({ from, to }) => [from, to]));
  if (STRING_LABEL_FUNCTIONS.test(query) && [...map.keys()].some((name) => query.includes(name))) {
    throw new StreamRewriteError(query);
  }
  return promqlLabelSpans(query)
    .filter(({ name }) => map.has(name))
    .sort((left, right) => right.start - left.start)
    .reduce(
      (text, { start, end, name }) => text.slice(0, start) + map.get(name) + text.slice(end),
      query,
    );
};

const columnName = (node: Record<string, any>): string | undefined =>
  typeof node.column === "string" ? node.column : node.column?.expr?.value;

const setColumn = (node: Record<string, any>, name: string) => {
  if (typeof node.column === "string") node.column = name;
  else node.column.expr.value = name;
};

const renameColumns = (node: unknown, map: Map<string, string>) => {
  if (Array.isArray(node)) {
    node.forEach((child) => renameColumns(child, map));
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const record = node as Record<string, any>;
  if (record.type === "column_ref") {
    const next = map.get(columnName(record) ?? "");
    if (next) setColumn(record, next);
  }
  Object.values(record).forEach((child) => renameColumns(child, map));
};

/** Renames columns through the SQL parser, so strings and table names are never touched. */
export const renameSqlColumns = async (sql: string, renames: FieldRename[]): Promise<string> => {
  if (!renames.some(({ from }) => sql.includes(from))) return sql;
  const parser = await useParser().sqlParser();
  const { masked, unmask } = maskVariables(sql);
  try {
    const ast = parser.astify(masked);
    renameColumns(ast, new Map(renames.map(({ from, to }) => [from, to])));
    return unmask(parser.sqlify(ast, { database: "PostgreSQL" }));
  } catch {
    throw new StreamRewriteError(sql);
  }
};

/** The renames one query needs; streams that disagree on a spelling cannot share it. */
export const queryRenames = (
  streams: Iterable<string>,
  bindings: PackBinding[],
  query: string,
): FieldRename[] => {
  const read = new Set([...streams].map((name) => name.toLowerCase()));
  const own = bindings.filter(({ stream }) => read.has(stream.toLowerCase()));
  const renames = new Map<string, string>();
  for (const { from, to } of own) {
    const spellings = [...read].map(
      (stream) => own.find((row) => row.from === from && row.stream.toLowerCase() === stream)?.to,
    );
    if (query.includes(from) && spellings.some((name) => name !== to)) {
      throw new StreamRewriteError(query);
    }
    renames.set(from, to);
  }
  return [...renames].map(([from, to]) => ({ from, to }));
};
