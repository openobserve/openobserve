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

import { describe, expect, it } from "vitest";
import {
  CompletionModel,
  LineContext,
} from "monaco-editor/esm/vs/editor/contrib/suggest/browser/completionModel.js";
import {
  CompletionItem,
  getSuggestionComparator,
} from "monaco-editor/esm/vs/editor/contrib/suggest/browser/suggest.js";
import {
  aggregatesAllowed,
  buildLogicalLead,
  logicalLeadNames,
  parseLogicalLeadContext,
} from "./editorProviders";
import { buildCompletionItems, buildFieldEntry, SORT_LANE, SQL_KEYWORDS } from "./sqlCompletion";

const KINDS = { Function: 1, Field: 3, Keyword: 17, Operator: 11, Text: 18 };

const fn = (name: string, aggregate = false) => ({
  name,
  label: name,
  kind: "Function",
  insertText: `${name}(`,
  sortText: SORT_LANE.function + name,
  ...(aggregate ? { aggregate } : {}),
});

const CATALOG = [
  ...SQL_KEYWORDS,
  buildFieldEntry({ name: "order", type: "Utf8" }),
  buildFieldEntry({ name: "android_id", type: "Utf8" }),
  fn("any_value", true),
  fn("approx_distinct", true),
  fn("abs"),
  fn("array_ndims"),
];

// The catalog menu the Logs filter builds after a complete condition, ordered by Monaco's own suggest model.
const menuFor = (line: string): string[] => {
  const word = /\w*$/.exec(line)![0];
  const before = line.slice(0, line.length - word.length);
  const allowAggregates = aggregatesAllowed(before, true);
  const entries = CATALOG.filter((entry) => allowAggregates || !(entry as any).aggregate);
  const lead = parseLogicalLeadContext(before, true);
  expect(lead, line).not.toBeNull();
  const ranked = buildLogicalLead(entries, logicalLeadNames(lead!, true), undefined, word);
  const caret = { lineNumber: 1, column: line.length + 1 };
  const range = {
    startLineNumber: 1,
    endLineNumber: 1,
    startColumn: caret.column - word.length,
    endColumn: caret.column,
  };
  const rows = buildCompletionItems({
    keywords: ranked as any[],
    word,
    range,
    kinds: KINDS,
    insertTextRules: {},
  });
  const items = rows
    .map((row) => new CompletionItem(caret, row, { suggestions: rows }, {}))
    .sort(getSuggestionComparator("inline"));
  const menu = new CompletionModel(
    items,
    caret.column,
    new LineContext(line, 0),
    { distance: () => 0 },
    { filterGraceful: true, snippetsPreventQuickSuggestions: false, showDeprecated: true },
    "inline",
  );
  return menu.items.map((item) => {
    const label = item.completion.label;
    return typeof label === "string" ? label : label.label;
  });
};

describe("after a complete condition, Monaco's menu leads with AND and OR", () => {
  it.each([
    ["an", "AND"],
    ["AN", "AND"],
    ["An", "AND"],
    ["a", "AND"],
    ["and", "AND"],
    ["o", "OR"],
    ["or", "OR"],
    ["OR", "OR"],
  ])("typing %s puts %s first", (typed, first) => {
    expect(menuFor(`level = 'error' ${typed}`)[0]).toBe(first);
  });

  it("keeps the other matches below the lead", () => {
    expect(menuFor("level = 'error' o")).toContain("order");
    expect(menuFor("level = 'error' a")).toEqual(
      expect.arrayContaining(["abs", "array_ndims", "android_id"]),
    );
  });

  it("offers no aggregate function in the filter", () => {
    expect(menuFor("level = 'error' an")).not.toContain("any_value");
    expect(menuFor("level = 'error' a")).not.toContain("approx_distinct");
  });
});
