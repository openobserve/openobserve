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
 * Which list the reader drilled into the query detail FROM.
 *
 * This used to travel as `?from=`, which is also the app-wide name for an
 * absolute window's START BOUND (`rangeToQuery` writes `from`/`to`
 * microseconds; `rangeFromQuery` reads them). One key, two owners, and each
 * silently destroyed the other:
 *
 *   • Hopping in under an absolute window wrote the origin OVER the start
 *     bound, leaving `?to=` with no `?from=` — so the detail page re-read the
 *     window as the default relative one and quietly discarded the range the
 *     reader had picked.
 *   • Any window change ON the detail page spread `rangeToQuery` over the
 *     query, whose relative form is `{ from: undefined }` — deleting the
 *     origin — and whose absolute form overwrote it with a timestamp.
 *
 * Either way the origin stopped resolving, and the back affordance fell
 * through to its `queries` default: the reader was handed back to Top queries
 * from whichever list they had actually come from.
 *
 * So the origin gets its own key. `from_tab` names what it holds — a TAB, not
 * a time — and cannot be confused with a bound by anything that reads windows.
 */

/** The URL key the origin travels under. Never `from` — see the note above. */
export const DBM_ORIGIN_QUERY_KEY = "from_tab";

/**
 * The lists that can send a reader to the query detail page.
 *
 * A value outside this set — absent, stale, hand-edited, or a leftover from
 * the old `?from=` spelling — is not an origin, and callers fall back to their
 * own default rather than routing somewhere that does not exist.
 */
export const DBM_QUERY_DETAIL_ORIGINS = ["queries", "activity", "samples", "deadlocks"] as const;

export type DbmQueryDetailOrigin = (typeof DBM_QUERY_DETAIL_ORIGINS)[number];

export const isDbmQueryDetailOrigin = (value: unknown): value is DbmQueryDetailOrigin =>
  typeof value === "string" && (DBM_QUERY_DETAIL_ORIGINS as readonly string[]).includes(value);

/**
 * The origin a route carries, or `null` when it names none.
 *
 * Takes the raw `route.query` value as vue-router types it, so a repeated
 * `?from_tab=a&from_tab=b` (an array) falls to `null` rather than being read
 * as its first element — a URL that names two origins names none.
 */
export const readDbmQueryDetailOrigin = (
  query: Record<string, unknown>,
): DbmQueryDetailOrigin | null => {
  const value = query[DBM_ORIGIN_QUERY_KEY];
  return isDbmQueryDetailOrigin(value) ? value : null;
};
