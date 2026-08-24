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
 * Whether the query detail page has a query to be ABOUT.
 *
 * Switching organization on this page is the case that forced this out into
 * the open. `MainLayout.updateOrganization` re-pushes the CURRENT PATH with a
 * fresh `org_identifier` and drops the rest of the query, so the detail route
 * survives the switch while the fingerprint that gave it a subject does not —
 * and a fingerprint that DOES survive (a link opened in the new org) names a
 * statement the new org has never run.
 *
 * Both landed on the same non-answer: `load()` refused to fetch without a
 * fingerprint, or fetched and matched nothing, and the page painted its header
 * over empty tiles and empty panels. Nothing said the query was missing, so it
 * read as a broken page rather than as a query this organization does not have.
 *
 * The three states are kept apart deliberately — they are three different
 * sentences, and collapsing them is how a page ends up telling a reader whose
 * request merely failed to go and instrument their fleet:
 *
 *   • `loading`  — a read is in flight, or has not been attempted yet. Claims
 *                  nothing; the page's own skeletons cover it.
 *   • `missing`  — the URL names no query at all. There is nothing to look up.
 *   • `notFound` — we asked, under this org and window, and neither vantage
 *                  had it.
 *   • `present`  — some vantage answered, so the page has something to paint.
 */

/** What the page is able to show right now. */
export type DbmQueryDetailPresence = "loading" | "missing" | "notFound" | "present";

export interface DbmQueryDetailPresenceInput {
  /** `?fingerprint=`, trimmed to what the page actually holds. */
  fingerprint: string;
  /** Whether a read is in flight. */
  loading: boolean;
  /**
   * Whether a read has ANSWERED for the query currently in the URL. False
   * before the first load and immediately after the fingerprint changes —
   * without it, the gap between the two is indistinguishable from an answered
   * "not found", and the empty state would flash over a query that is about to
   * arrive.
   */
  settled: boolean;
  /** The client-vantage row, when the trace rollup had one. */
  hasClientRow: boolean;
  /** The database's own row, when the server vantage had one. */
  hasServerRow: boolean;
}

/**
 * A vantage answering with a row is the whole test for `present`. Either one
 * alone is enough: a fleet with no traced traffic is served entirely by the
 * server vantage, and calling that "not found" would hide a page that works.
 */
export const dbmQueryDetailPresence = ({
  fingerprint,
  loading,
  settled,
  hasClientRow,
  hasServerRow,
}: DbmQueryDetailPresenceInput): DbmQueryDetailPresence => {
  if (hasClientRow || hasServerRow) return "present";
  // Checked before `loading`, because there is no read to wait for: `load()`
  // returns immediately without a fingerprint, so a page that reported
  // `loading` here would spin forever on an org switch.
  if (!fingerprint) return "missing";
  if (loading || !settled) return "loading";
  return "notFound";
};
