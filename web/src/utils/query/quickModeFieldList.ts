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
 * Enabling quick mode swaps the SELECT list of the query in the search bar for
 * the user's interesting fields. The projection is located by regex, so a query
 * containing a subquery cannot be rewritten safely: the pattern matches an inner
 * `SELECT ... FROM` just as readily as the outer one, and replacing it discards
 * the subquery's own projection along with any `DISTINCT` it carried. Such a
 * query is left untouched — `quick_mode` still goes out on the request, so field
 * trimming for `SELECT *` is unaffected.
 *
 * Both the subquery check and the rewrite run over a masked copy of the query in
 * which string literals and comments are blanked, so a `select ... from` inside a
 * quoted value is neither mistaken for a subquery nor rewritten, and a comment
 * cannot hide a subquery from the check.
 */

/** A `(` opening a nested SELECT — subquery, derived table, or CTE body. */
const SUBQUERY = /\(\s*SELECT\b/i;

/**
 * The projection of a `SELECT ... FROM` pair. Applied globally, because a
 * multi-stream search is a UNION of one SELECT per stream and each needs the
 * field list; anything nested has already been excluded by [[SUBQUERY]].
 */
const SELECT_FROM = /SELECT\s+.*?\s+FROM/i;

/**
 * Blank out string literals, line comments and block comments, replacing each
 * character with a space and keeping newlines. The result is the same length as
 * the input, so offsets found in it address the original text directly.
 *
 * A single pass is needed rather than sequential regex replacements: a quote can
 * appear inside a comment (`-- don't`) and a `--` inside a quoted value, so
 * whichever construct opens first has to consume the other.
 */
const maskLiteralsAndComments = (sql: string): string => {
  const out = sql.split("");
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < out.length; k++) {
      if (out[k] !== "\n") out[k] = " ";
    }
  };

  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];

    // Quoted value or quoted identifier. '' inside a single-quoted value is an
    // escaped quote, not the end of it.
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === ch) {
          if (ch === "'" && sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      const end = Math.min(j + 1, sql.length);
      blank(i, end);
      i = end;
      continue;
    }

    if (ch === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      const end = nl === -1 ? sql.length : nl;
      blank(i, end);
      i = end;
      continue;
    }

    if (ch === "/" && sql[i + 1] === "*") {
      const close = sql.indexOf("*/", i + 2);
      const end = close === -1 ? sql.length : close + 2;
      blank(i, end);
      i = end;
      continue;
    }

    i++;
  }

  return out.join("");
};

/** Whether the query nests a SELECT, ignoring quoted values and comments. */
export const hasSubquery = (query: string): boolean =>
  SUBQUERY.test(maskLiteralsAndComments(query));

/**
 * Replace each top-level projection with `fieldList`, unless the query nests a
 * SELECT — in which case the query is returned unchanged.
 */
export const replaceSelectFieldList = (query: string, fieldList: string): string => {
  const masked = maskLiteralsAndComments(query);
  if (SUBQUERY.test(masked)) return query;

  // Matched against the mask but spliced into the original, so a projection is
  // replaced with the real text around it left byte-for-byte intact.
  const pattern = new RegExp(SELECT_FROM.source, "gi");
  let rewritten = "";
  let cursor = 0;
  let match: RegExpExecArray | null = pattern.exec(masked);

  while (match !== null) {
    rewritten += query.slice(cursor, match.index) + `SELECT ${fieldList} FROM`;
    cursor = match.index + match[0].length;
    match = pattern.exec(masked);
  }

  return rewritten + query.slice(cursor);
};

export default replaceSelectFieldList;
