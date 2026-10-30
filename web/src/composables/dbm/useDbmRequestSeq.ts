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
 * useDbmRequestSeq — which response is still the one the reader asked for.
 *
 * Every DBM page can start a fetch from several places at once: a debounced
 * search box, five filter dropdowns, the sort control, the date picker and a
 * refresh button. HTTP gives no ordering guarantee, so a slower EARLIER request
 * can resolve after a newer one and paint the previous window's rows under a
 * toolbar that says the new filter is applied — with `loading` already back to
 * false, so nothing on screen admits the mismatch.
 *
 * The guard is a counter rather than an `AbortController`: aborting would also
 * need every call site to distinguish a cancelled request from a failed one,
 * and a cancelled fetch surfaces as a rejection that the existing `catch`
 * blocks would render as "couldn't load". Discarding on arrival keeps the
 * error paths meaning exactly what they meant before.
 *
 *   const seq = useDbmRequestSeq();
 *   const load = async () => {
 *     const token = seq.begin();
 *     const { data } = await fetchSomething();
 *     if (seq.isStale(token)) return;   // a newer load already owns the page
 *     rows.value = data.hits;
 *   };
 *
 * One counter per PAGE, not per request kind: a load and the secondary fetches
 * it starts are one unit of work, so the next load has to invalidate all of
 * them together. That is what stops a breakdown row or a caller list arriving
 * late and repopulating under a window the reader has already moved off.
 */

export interface DbmRequestSeq {
  /** Claim the page for a new load. Returns the token that load must carry. */
  begin: () => number;
  /**
   * The token of the load that currently owns the page, WITHOUT claiming it.
   * A secondary fetch (a breakdown, a caller list) joins the load it belongs to
   * rather than starting one, so the next load invalidates them together.
   */
  current: () => number;
  /** Whether a newer load has since claimed the page, so this response is void. */
  isStale: (token: number) => boolean;
}

export function useDbmRequestSeq(): DbmRequestSeq {
  // Deliberately a plain closure variable, not a `ref`: nothing renders it, and
  // as reactive state it would make every in-flight token a tracked dependency.
  let latest = 0;

  return {
    begin: () => {
      latest += 1;
      return latest;
    },
    current: () => latest,
    isStale: (token: number) => token !== latest,
  };
}
