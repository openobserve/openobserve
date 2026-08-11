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
 * Detects a `LIMIT` clause in a non-SQL-mode filter expression.
 *
 * In non-SQL mode the search bar's contents become the WHERE body of a
 * generated `SELECT * FROM "stream" [WHERE_CLAUSE]`, so a trailing `LIMIT 10`
 * is spliced into the statement rather than read as a predicate. The result is
 * still valid SQL, which is why the results grid returns rows — but the
 * histogram query built from the same input is rejected by
 * `is_eligible_for_histogram`, leaving the user with data and an error at the
 * same time.
 *
 * `LIMIT` is matched only when followed by a number, so a field or value named
 * `limit` (`limit = 5`, `rate_limit >= 100`) does not trip it. String literals
 * are blanked first so quoted text can never match.
 */
const LIMIT_CLAUSE = /\blimit\s+\d/i;

/** Replace the body of every single-quoted literal, keeping the quotes. */
const blankStringLiterals = (input: string): string => input.replace(/'(?:[^']|'')*'/g, "''");

/**
 * Drop line and block comments. Runs after literals are blanked so a `--` or
 * `/*` inside a quoted value is not mistaken for the start of a comment.
 */
const stripComments = (input: string): string =>
  input.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");

export const hasLimitClause = (filter: string): boolean =>
  LIMIT_CLAUSE.test(stripComments(blankStringLiterals(filter)));

export default hasLimitClause;
