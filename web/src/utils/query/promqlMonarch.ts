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
//
// ---------------------------------------------------------------------------
// The Monarch grammar below is monaco-promql's, reproduced under its licence:
//
//   The MIT License (MIT)
//   Copyright (c) Celian Garcia and Augustin Husson @ Amadeus IT Group
//   (monaco-promql)
//
//   Permission is hereby granted, free of charge, to any person obtaining a
//   copy of this software and associated documentation files (the "Software"),
//   to deal in the Software without restriction, including without limitation
//   the rights to use, copy, modify, merge, publish, distribute, sublicense,
//   and/or sell copies of the Software, and to permit persons to whom the
//   Software is furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in
//   all copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
//   FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
//   DEALINGS IN THE SOFTWARE.
// ---------------------------------------------------------------------------

/**
 * PromQL syntax highlighting, in monaco's Monarch format.
 *
 * Vendored rather than imported. The upstream package built its keyword list by
 * importing Prometheus's term tables, and that module requires an unrelated
 * editor library at module scope — for a require it never uses — so loading a
 * PromQL editor pulled ~376 KB of that library's runtime into the bundle.
 * PromQL runs on monaco here, like every other language in this app; importing
 * a grammar should not drag a second editor in behind it.
 *
 * The grammar is byte-for-byte upstream's. What changed is where its keyword
 * and operator lists come from: promqlTerms.ts, the same Prometheus vocabulary
 * the completion catalog reads, snapshotted as inert data.
 */

/* eslint-disable no-useless-escape -- the grammar below is reproduced
   verbatim from monaco-promql; its regex literals are not ours to restyle,
   and a diff against upstream should stay empty of cosmetic noise. */

import {
  AGGREGATION_MODIFIER_TERMS,
  AGGREGATION_TERMS,
  AT_MODIFIER_TERMS,
  BINARY_MODIFIER_TERMS,
  BINARY_OPERATOR_TERMS,
  FUNCTION_TERMS,
} from "./promqlTerms";

const labels = (terms: { label: string }[]) => terms.map((t) => t.label);

// `by`/`without`, the vector-matching modifiers and the @ modifiers, which the
// tokenizer highlights as a clause rather than as an identifier.
const vectorMatching = [
  ...labels(BINARY_MODIFIER_TERMS),
  ...labels(AGGREGATION_MODIFIER_TERMS),
  ...labels(AT_MODIFIER_TERMS),
];
const vectorMatchingRegex = `(${vectorMatching.reduce((prev, curr) => `${prev}|${curr}`)})`;

// PromQL operators (https://prometheus.io/docs/prometheus/latest/querying/operators/)
const operators = labels(BINARY_OPERATOR_TERMS);

// Every word the grammar should colour as a keyword.
const keywords = [
  ...labels(AGGREGATION_TERMS),
  ...labels(FUNCTION_TERMS),
  ...labels(BINARY_MODIFIER_TERMS),
  ...labels(AT_MODIFIER_TERMS),
  ...labels(AGGREGATION_MODIFIER_TERMS),
];

export const languageConfiguration: any = {
  // the default separators except `@$`
  wordPattern: /(-?\d*\.\d\w*)|([^`~!#%^&*()\-=+\[{\]}\\|;:'",.<>\/?\s]+)/g,
  // Not possible to make comments in PromQL syntax
  comments: {
    lineComment: "#",
  },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
    { open: "<", close: ">" },
  ],
  folding: {},
};

export const language: any = {
  ignoreCase: false,
  defaultToken: "",
  tokenPostfix: ".promql",
  keywords: keywords,
  operators: operators,
  vectorMatching: vectorMatchingRegex,
  // we include these common regular expressions
  symbols: /[=><!~?:&|+\-*\/^%]+/,
  escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
  digits: /\d+(_+\d+)*/,
  octaldigits: /[0-7]+(_+[0-7]+)*/,
  binarydigits: /[0-1]+(_+[0-1]+)*/,
  hexdigits: /[0-9a-fA-F]+(_+[0-9a-fA-F]+)*/,
  integersuffix: /(ll|LL|u|U|l|L)?(ll|LL|u|U|l|L)?/,
  floatsuffix: /[fFlL]?/,
  // The main tokenizer for our languages
  tokenizer: {
    root: [
      // 'by', 'without' and vector matching
      [/@vectorMatching\s*(?=\()/, "type", "@clauses"],
      // labels
      [/[a-z_]\w*(?=\s*(=|!=|=~|!~))/, "tag"],
      // comments
      [/(^#.*$)/, "comment"],
      // all keywords have the same color
      [
        /[a-zA-Z_]\w*/,
        {
          cases: {
            "@keywords": "type",
            "@default": "identifier",
          },
        },
      ],
      // strings
      [/"([^"\\]|\\.)*$/, "string.invalid"], // non-teminated string
      [/'([^'\\]|\\.)*$/, "string.invalid"], // non-teminated string
      [/"/, "string", "@string_double"],
      [/'/, "string", "@string_single"],
      [/`/, "string", "@string_backtick"],
      // whitespace
      { include: "@whitespace" },
      // delimiters and operators
      [/[{}()\[\]]/, "@brackets"],
      [/[<>](?!@symbols)/, "@brackets"],
      [
        /@symbols/,
        {
          cases: {
            "@operators": "delimiter",
            "@default": "",
          },
        },
      ],
      // numbers
      [/\d+[smhdwy]/, "number"], // 24h, 5m are often encountered in prometheus
      [/\d*\d+[eE]([\-+]?\d+)?(@floatsuffix)/, "number.float"],
      [/\d*\.\d+([eE][\-+]?\d+)?(@floatsuffix)/, "number.float"],
      [/0[xX][0-9a-fA-F']*[0-9a-fA-F](@integersuffix)/, "number.hex"],
      [/0[0-7']*[0-7](@integersuffix)/, "number.octal"],
      [/0[bB][0-1']*[0-1](@integersuffix)/, "number.binary"],
      [/\d[\d']*\d(@integersuffix)/, "number"],
      [/\d(@integersuffix)/, "number"],
    ],
    string_double: [
      [/[^\\"]+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/"/, "string", "@pop"],
    ],
    string_single: [
      [/[^\\']+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/'/, "string", "@pop"],
    ],
    string_backtick: [
      [/[^\\`$]+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/`/, "string", "@pop"],
    ],
    clauses: [
      [/[^(,)]/, "tag"],
      [/\)/, "identifier", "@pop"],
    ],
    whitespace: [[/[ \t\r\n]+/, "white"]],
  },
};
// noinspection JSUnusedGlobalSymbols
export var completionItemProvider = {
  provideCompletionItems: function () {
    // To simplify, we made the choice to never create automatically the parenthesis behind keywords
    // It is because in PromQL, some keywords need parenthesis behind, some don't, some can have but it's optional.
    var suggestions = keywords.map(function (value) {
      return {
        label: value,
        kind: languages.CompletionItemKind.Keyword,
        insertText: value,
        insertTextRules: languages.CompletionItemInsertTextRule.InsertAsSnippet,
      };
    });
    return { suggestions: suggestions };
  },
};
