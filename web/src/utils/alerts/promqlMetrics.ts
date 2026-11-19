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

const KEYWORDS = new Set([
  "by",
  "without",
  "on",
  "ignoring",
  "group_left",
  "group_right",
  "bool",
  "and",
  "or",
  "unless",
  "offset",
  "inf",
  "nan",
]);

const NAME_MATCHER = /__name__\s*=\s*"([^"]+)"/g;
const STRINGS = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`/g;
const LABEL_LISTS = /\b(?:by|without|on|ignoring|group_left|group_right)\s*\([^)]*\)/g;
const IDENTIFIER = /(?<![\w:.])[a-zA-Z_:][\w:]*(?![\w:])/g;
const EXPONENT_LITERAL = /\d(?:\.\d*)?e[-+]?\d+/gi;
const LOWER_THAN_MULTIPLY = /[-+<>=!]|\b(?:and|or|unless)\b/i;

/** The metric names a PromQL query reads, in the order they first appear. */
export function promqlMetricNames(query: string): string[] {
  const names = [...query.matchAll(NAME_MATCHER)].map((m) => m[1]);
  const bare = query
    .replace(STRINGS, '""')
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(LABEL_LISTS, " ");
  for (const match of bare.matchAll(IDENTIFIER)) {
    const word = match[0];
    const rest = bare.slice((match.index ?? 0) + word.length);
    if (KEYWORDS.has(word.toLowerCase()) || /^\s*\(/.test(rest)) continue;
    names.push(word);
  }
  return [...new Set(names)];
}

/** Whether the whole query is scaled by 100, so its value (and the threshold) reads in percent. */
export function promqlScaledToPercent(query: string): boolean {
  let top = query
    .replace(STRINGS, '""')
    .replace(/\{[^}]*\}/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(EXPONENT_LITERAL, "0")
    .trim();
  for (let inner = ""; inner !== top;) [inner, top] = [top, top.replace(/\([^()]*\)/g, "_")];
  if (!/^100\s*\*/.test(top) && !/\*\s*100$/.test(top)) return false;
  // `*` binds tighter than these, so `1 - x * 100` scales only `x`, not the whole value.
  return !LOWER_THAN_MULTIPLY.test(top);
}

/** The query reading `to` where it read `from`; undefined unless `from` is the only metric it reads. */
export function promqlWithMetric(query: string, from: string, to: string): string | undefined {
  const names = promqlMetricNames(query);
  if (names.length !== 1 || names[0] !== from) return undefined;
  const name = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bare = new RegExp(`(?<![\\w:.])${name}(?![\\w:])`, "g");
  const nameMatcher = new RegExp(`(__name__\\s*=\\s*)"${name}"`, "g");
  let moved = "";
  let at = 0;
  for (const literal of query.matchAll(STRINGS)) {
    moved += query.slice(at, literal.index).replace(bare, to) + literal[0];
    at = (literal.index ?? 0) + literal[0].length;
  }
  return (moved + query.slice(at).replace(bare, to)).replace(nameMatcher, `$1"${to}"`);
}
