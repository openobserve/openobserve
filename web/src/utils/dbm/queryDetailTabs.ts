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
 * The query detail page's three tabs.
 *
 * The page answers one question in a fixed order — how bad is it, why is it
 * slow, who ran it — and the tabs are that order, not a shelf per section:
 *
 *  • `overview` — the headline numbers, the database's own counters, the trend
 *    and where it runs. Minute 0 of an incident.
 *  • `plans` — the diagnosis. Server-vantage, so it is populated on a fleet
 *    with no traced traffic at all, where the overview collapses to two tiles.
 *  • `callers` — the trace-vantage evidence: who ran it, and one real bad
 *    execution to open. All of it reads the resolved trace stream, which is why
 *    the stream picker belongs on this tab and nowhere else.
 *
 * The active tab lives in the URL (`?tab=`) rather than in a `ref`, so a link
 * pasted into an incident channel reopens on the tab the sender was reading —
 * the same reason this screen is a page rather than a drawer.
 */

/** The tabs, in the order they are rendered. */
export const QUERY_DETAIL_TABS = ["overview", "plans", "callers"] as const;

export type QueryDetailTab = (typeof QUERY_DETAIL_TABS)[number];

/** The tab a URL with no usable `?tab=` opens on. */
export const DEFAULT_QUERY_DETAIL_TAB: QueryDetailTab = "overview";

export const isQueryDetailTab = (value: unknown): value is QueryDetailTab =>
  typeof value === "string" && (QUERY_DETAIL_TABS as readonly string[]).includes(value);

/**
 * The tab a route's `?tab=` selects.
 *
 * Takes the raw `route.query` value as vue-router types it — `LocationQueryValue`
 * is `string | null`, and the array form `(string | null)[]` is what a repeated
 * `?tab=a&tab=b` produces. Hence `unknown` rather than a narrower signature: the
 * point of this function is that it accepts whatever a hand-edited URL contains.
 * Anything that does not name one of the three falls back to the default rather
 * than rendering nothing — a stale link must open the page, not a blank panel.
 */
export const resolveQueryDetailTab = (value: unknown): QueryDetailTab =>
  isQueryDetailTab(value) ? value : DEFAULT_QUERY_DETAIL_TAB;
