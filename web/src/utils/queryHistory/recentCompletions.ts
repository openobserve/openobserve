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

import { matchRecentQueries } from "./recentSearches";

const MAX_LABEL_CHARS = 120;

/** The parts of a Monaco text model the clock rows read. */
export interface RecentCompletionModel {
  getValue: () => string;
  getLineCount: () => number;
  getLineMaxColumn: (lineNumber: number) => number;
  getLineContent: (lineNumber: number) => string;
}

interface Range {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface RecentCompletionItem {
  label: { label: string; description: string };
  kind: number;
  detail: string;
  insertText: string;
  filterText: string;
  sortText: string;
  range: Range;
  additionalTextEdits: { range: Range; text: string }[];
}

/** Clock rows that replace the whole editor text with a recent query matching what is typed. */
export const recentCompletionItems = (
  queries: string[],
  model: RecentCompletionModel,
  position: { lineNumber: number; column: number },
  kind: number,
  description: string,
): RecentCompletionItem[] => {
  if (!queries.length) return [];
  const matches = matchRecentQueries(queries, model.getValue());
  if (!matches.length) return [];
  const line = position.lineNumber;
  const lastLine = model.getLineCount();
  // Monaco only takes a one-line range around the caret, so the other lines go through extra edits.
  const otherLines: { range: Range; text: string }[] = [];
  if (line > 1) {
    otherLines.push({
      range: { startLineNumber: 1, startColumn: 1, endLineNumber: line, endColumn: 1 },
      text: "",
    });
  }
  if (line < lastLine) {
    otherLines.push({
      range: {
        startLineNumber: line,
        startColumn: model.getLineMaxColumn(line),
        endLineNumber: lastLine,
        endColumn: model.getLineMaxColumn(lastLine),
      },
      text: "",
    });
  }
  const typedOnLine = model.getLineContent(line).slice(0, position.column - 1);
  return matches.map((query, index) => {
    const oneLine = query.replace(/\s+/g, " ").trim();
    return {
      label: {
        label: oneLine.length > MAX_LABEL_CHARS ? `${oneLine.slice(0, MAX_LABEL_CHARS)}…` : oneLine,
        description,
      },
      kind,
      detail: description,
      insertText: query,
      filterText: typedOnLine,
      sortText: `\u0000${String(index).padStart(2, "0")}`,
      range: {
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: line,
        endColumn: model.getLineMaxColumn(line),
      },
      additionalTextEdits: otherLines,
    };
  });
};
