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

/**
 * Collects the non-fatal warnings the search backend attaches to an otherwise
 * successful response, which it reports through `function_error` on each
 * query's result metadata.
 *
 * The consequential one is "results are capped to meet default limit": a query
 * carrying no explicit LIMIT that returns more than `ZO_QUERY_DEFAULT_LIMIT`
 * rows is truncated server-side. Panels dropped this, so a truncated result
 * rendered as though it were the whole answer — most visibly on pivot tables,
 * where a breakdown multiplies the row count (rows become x × breakdown pairs)
 * and every dropped combination shows up as an empty cell. Logs already
 * surfaces `function_error`; this brings dashboard panels in line.
 *
 * @param resultMetaData - Per-query result metadata. Each entry is a single
 *   metadata object on the legacy path and an array of chunk metadata while
 *   streaming; `function_error` is itself a string on some response shapes and
 *   a list on others. Both are accepted.
 * @returns Unique warning messages, in first-seen order. Streamed responses
 *   repeat the same warning on every chunk, so duplicates are collapsed.
 */
export const collectSearchWarnings = (resultMetaData: any): string[] => {
  const warnings = new Set<string>();

  for (const queryMeta of Array.isArray(resultMetaData) ? resultMetaData : []) {
    const chunks = Array.isArray(queryMeta) ? queryMeta : [queryMeta];

    for (const chunk of chunks) {
      const functionError = chunk?.function_error;
      if (!functionError) continue;

      const messages = Array.isArray(functionError) ? functionError : [functionError];
      for (const message of messages) {
        if (message) warnings.add(String(message));
      }
    }
  }

  return [...warnings];
};
