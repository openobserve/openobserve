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
 * Build the preview query for ONE side of a count SLI — good or bad.
 *
 * Same CASE-SUM shape the ingest pass uses (`single_count_sql`), so what the
 * preview draws is what the SLO will measure: `good` counts rows matching the
 * predicate, `bad` counts the complement within the same scope. Both project
 * `zo_sql_num`, so the two charts differ only in label and colour.
 *
 * A filtered COUNT would drop empty buckets entirely, making "everything was
 * bad" indistinguishable from "no traffic" — for a count SLI those mean
 * opposite things.
 *
 * Returns `null` when there is nothing drawable yet (no stream or no
 * good-when expression) — better no chart than a chart of the wrong thing.
 */
export function buildSloPreviewQuery(
  stream: string | undefined,
  scope: string | undefined,
  goodExpr: string | undefined,
  series: "good" | "bad",
): string | null {
  const s = stream?.trim();
  const good = goodExpr?.trim();
  if (!s || !good) return null;

  // Parenthesised for the same reason the ingest builder parenthesises: a
  // user fragment like `a OR b` must not re-associate against anything
  // appended around it.
  const branches = series === "good" ? "THEN 1 ELSE 0" : "THEN 0 ELSE 1";
  let sql =
    `SELECT histogram(_timestamp) AS zo_sql_key, ` +
    `SUM(CASE WHEN (${good}) ${branches} END) AS zo_sql_num ` +
    `FROM ${quoteIdent(s)}`;
  const sc = scope?.trim();
  if (sc) sql += ` WHERE (${sc})`;
  return sql + " GROUP BY zo_sql_key";
}

/** Same quoting rule as the ingest pass's query builder. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Replace the identifier being typed at the end of `text` with a picked field
 * name — the splice behind the scope/good-when typeahead. OCombobox replaces
 * the WHOLE input on select, so the caller closes this over the live text.
 */
export function replaceTrailingFieldToken(text: string | undefined, field: string): string {
  const t = text ?? "";
  if (/[\w.]+$/.test(t)) {
    return t.replace(/[\w.]+$/, field);
  }
  return t + field;
}

/**
 * The needle regex the typeahead filters on: the identifier at the END of the
 * expression. `status_code < 5` ends in "5" — no field starts with it, so the
 * suggestion list simply stays closed mid-value.
 */
export const FIELD_TOKEN_REGEX = "([\\w.]+)$";
