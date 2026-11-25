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
import { recentCompletionItems } from "./recentCompletions";

const FIELD = 3;

// A catalog row as the editor sends it: its range is the typed word.
const wordRow = (
  line: string,
  word: string,
  insertText: string,
  sortText: string,
  filterText?: string,
) => ({
  label: insertText,
  kind: FIELD,
  insertText,
  sortText,
  ...(filterText ? { filterText } : {}),
  range: {
    startLineNumber: 1,
    endLineNumber: 1,
    startColumn: line.length + 1 - word.length,
    endColumn: line.length + 1,
  },
});

// Orders rows with Monaco's own suggest model: sorted as a provider's answer is, then scored on the typed text.
const menuOrder = (line: string, catalog: object[], recents: string[]) => {
  const caret = { lineNumber: 1, column: line.length + 1 };
  const model = {
    getValue: () => line,
    getLineCount: () => 1,
    getLineMaxColumn: () => line.length + 1,
    getLineContent: () => line,
  };
  const rows = [...recentCompletionItems(recents, model, caret, 18, "Recent search"), ...catalog];
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
  return menu.items.map((item) => item.completion.insertText);
};

describe("a matching recent search in Monaco's own suggest menu", () => {
  it.each([
    ["a field name", "code", "code = '500'", ["code", "code_path"]],
    ["a bare word", "err", "str_match(code,'err')", ["error_code", "match_all('err')"]],
    [
      "the next word of a longer filter",
      "level = 'error' and co",
      "level = 'error' and code = 1",
      ["code", "count"],
    ],
  ])("comes after every other row for %s", (_name, line, recent, others) => {
    const word = line.split(" ").at(-1)!;
    const catalog = others.map((insert, i) =>
      insert.startsWith("match_all")
        ? wordRow(line, word, insert, "\u0003\uffff0", `${word}\u0001`)
        : wordRow(line, word, insert, `\u0000${String(i)}`),
    );
    const order = menuOrder(line, catalog, [recent]);
    expect(order).toEqual([...others, recent]);
  });
});
