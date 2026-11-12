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

export interface MicrosRange {
  startUs: number;
  endUs: number;
}

const COMPARISON = /(>=|<=|>|<|=)/.source;
const LITERAL = /('[^']*'|\d+(?:\.\d+)?)/.source;
// A literal followed by arithmetic is part of an expression, which is not read.
const LITERAL_END = /(?!\s*[-+*/%|(]|\.?\d)/.source;
// Quoted identifiers are matched in the same pass so a quote inside one never opens a string.
const STRING_OR_COMMENT = /"(?:[^"]|"")*"|'(?:[^']|'')*'|--[^\n]*|\/\*[\s\S]*?\*\//g;

const literalMicros = (literal: string): number | null => {
  if (literal.startsWith("'")) {
    const text = literal.slice(1, -1).trim().replace(" ", "T");
    const zoned = /([zZ]|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text}Z`;
    const ms = Date.parse(zoned);
    return Number.isFinite(ms) ? ms * 1000 : null;
  }
  const value = Number(literal);
  if (!Number.isFinite(value)) return null;
  if (value >= 1e17) return Math.floor(value / 1000);
  if (value >= 1e14) return value;
  if (value >= 1e11) return value * 1000;
  return value * 1_000_000;
};

const escapeName = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Only the timestamp column's quoted name survives; the rest keep their length so offsets match the original.
const maskStringsAndComments = (sql: string, timestampColumn: string) =>
  sql.replace(STRING_OR_COMMENT, (part) => {
    if (part.startsWith("'")) return `'${"_".repeat(part.length - 2)}'`;
    const quotedColumn =
      part.startsWith('"') && part.slice(1, -1).replace(/""/g, '"') === timestampColumn;
    return quotedColumn ? part : " ".repeat(part.length);
  });

/** The window a SQL query keeps inside the picker's range when it filters on the timestamp column, else null. */
// Bounds are ANDed; with an OR anywhere the query may keep more than one side shows, so nothing is claimed.
export const queryNarrowedRange = (
  sql: string | null | undefined,
  timestampColumn: string,
  picker: MicrosRange,
): MicrosRange | null => {
  if (!sql || !timestampColumn) return null;
  const masked = maskStringsAndComments(sql, timestampColumn);
  if (/\bor\b/i.test(masked)) return null;
  const column = `(?<![\\w"'])"?${escapeName(timestampColumn)}"?(?![\\w'])`;
  let { startUs, endUs } = picker;
  const raise = (us: number | null) => {
    if (us !== null && us > startUs) startUs = us;
  };
  const lower = (us: number | null) => {
    if (us !== null && us < endUs) endUs = us;
  };
  // Each match is found in the masked text and its literals read from the same offsets of the original.
  const each = (pattern: string, read: (groups: string[]) => void) => {
    for (const match of masked.matchAll(new RegExp(pattern, "gi"))) {
      const original = sql.slice(match.index, match.index + match[0].length);
      const groups = original.match(new RegExp(pattern, "i"));
      if (groups) read(groups.slice(1));
    }
  };
  each(`${column}\\s+between\\s+${LITERAL}\\s+and\\s+${LITERAL}${LITERAL_END}`, ([low, high]) => {
    raise(literalMicros(low));
    const us = literalMicros(high);
    lower(us === null ? null : us + 1);
  });
  each(`${column}\\s*${COMPARISON}\\s*${LITERAL}${LITERAL_END}`, ([op, literal]) => {
    const us = literalMicros(literal);
    const next = us === null ? null : us + 1;
    if (op === ">") raise(next);
    else if (op === ">=") raise(us);
    else if (op === "<") lower(us);
    else if (op === "<=") lower(next);
    else {
      raise(us);
      lower(next);
    }
  });
  if (startUs === picker.startUs && endUs === picker.endUs) return null;
  return { startUs, endUs: Math.max(startUs, endUs) };
};
