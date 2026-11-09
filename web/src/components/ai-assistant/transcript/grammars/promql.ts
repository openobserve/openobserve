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

import type { HLJSApi, Language, Mode } from "highlight.js";

const KEYWORDS = [
  "by",
  "without",
  "on",
  "ignoring",
  "group_left",
  "group_right",
  "offset",
  "bool",
  "and",
  "or",
  "unless",
];

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/;

/** PromQL for highlight.js: functions, label names, metric names, matchers, durations and the grouping keywords. */
export function promql(hljs: HLJSApi): Language {
  const string: Mode = {
    scope: "string",
    variants: [
      { begin: /"/, end: /"/ },
      { begin: /'/, end: /'/ },
      { begin: /`/, end: /`/ },
    ],
    contains: [hljs.BACKSLASH_ESCAPE],
  };
  const comma: Mode = { scope: "punctuation", match: /,/ };
  // Inside `by (…)` and friends every name is a label, never a metric.
  const labelList: Mode = {
    begin: [/\b(?:by|without|on|ignoring|group_left|group_right)\b/, /\s*/, /\(/],
    beginScope: { 1: "keyword", 3: "punctuation" },
    end: /\)/,
    endScope: "punctuation",
    contains: [{ scope: "attr", match: IDENT }, comma],
  };
  const matchers: Mode = {
    begin: /\{/,
    end: /\}/,
    beginScope: "punctuation",
    endScope: "punctuation",
    contains: [
      string,
      { scope: "attr", match: IDENT },
      { scope: "operator", match: /=~|!~|!=|=/ },
      comma,
    ],
  };
  const range: Mode = {
    begin: /\[/,
    end: /\]/,
    beginScope: "punctuation",
    endScope: "punctuation",
    contains: [
      { scope: "number", match: /\d+(?:ms|[smhdwy])(?:\d+(?:ms|[smhdwy]))*/ },
      { scope: "punctuation", match: /:/ },
    ],
  };
  return {
    name: "PromQL",
    aliases: ["prometheus"],
    contains: [
      hljs.HASH_COMMENT_MODE,
      labelList,
      matchers,
      range,
      string,
      // An aggregation is a function even when its grouping clause sits between the name and the parenthesis.
      {
        scope: "title.function",
        match: new RegExp(
          `\\b(?!(?:${KEYWORDS.join("|")})\\b)${IDENT.source}(?=\\s*(?:\\(|(?:by|without)\\b))`,
        ),
      },
      { scope: "keyword", match: new RegExp(`\\b(?:${KEYWORDS.join("|")})\\b`) },
      { scope: "number", match: /\b\d+(?:\.\d+)?(?:e[+-]?\d+)?(?:ms|[smhdwy])?\b/ },
      { scope: "variable", match: /[A-Za-z_:][A-Za-z0-9_:]*/ },
      { scope: "operator", match: /=~|!~|!=|==|>=|<=|[-+*/%^<>=]/ },
      { scope: "punctuation", match: /[(),]/ },
    ],
  };
}
