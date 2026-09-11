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
 * The only file in the app with cache durations in it.
 *
 * `DEFAULT_STALE_TIME` is set on the query client, so a query that says nothing
 * about freshness gets it. The other two exist because a handful of reads are
 * genuinely different, and a named constant at the declaration says which and
 * why far better than a bare number would.
 *
 * These are plain values for TanStack's own `staleTime` option — there is no
 * wrapper vocabulary to learn.
 */

/** Entity lists and details: what nearly every read wants. */
export const DEFAULT_STALE_TIME = 30_000;

/**
 * Org configuration — stream names, folders, functions, destinations. Read on
 * nearly every page, changed from one settings screen.
 */
export const CONFIG_STALE_TIME = 5 * 60_000;

/** Immutable for the session: /config, the roles enum, built-in patterns. */
export const SESSION_STALE_TIME = Infinity;

/**
 * Kept out of memory longer than the client default, for reads that are
 * expensive to rebuild: org config and heavy result payloads.
 */
export const LONG_GC_TIME = 30 * 60_000;
