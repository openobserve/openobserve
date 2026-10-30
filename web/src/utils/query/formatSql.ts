// Copyright 2026 OpenObserve Inc.

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

import { format } from "sql-formatter";

/**
 * Pretty-print SQL for READING — a preview, a confirmation dialog, a tooltip.
 *
 * Deliberately display-only: the formatted string is never what gets saved or
 * executed. Whitespace is semantically free, but rewriting the user's query
 * behind their back makes the saved alert differ from what they typed, and the
 * whole point of showing the query is that nothing about it is a surprise.
 *
 * Never throws. A query the formatter cannot parse — a half-typed statement, a
 * dialect quirk — comes back untouched, because a preview that renders the
 * original is infinitely better than one that renders an error.
 */
export const formatSqlForDisplay = (sql: string | undefined | null): string => {
  const trimmed = sql?.trim();
  if (!trimmed) return "";

  try {
    return format(trimmed, {
      language: "sql",
      keywordCase: "upper",
      // Two spaces: a WHERE clause with several ANDs still fits a dialog column
      // without wrapping, which four-space indents would push over.
      tabWidth: 2,
      linesBetweenQueries: 1,
    });
  } catch {
    return trimmed;
  }
};
