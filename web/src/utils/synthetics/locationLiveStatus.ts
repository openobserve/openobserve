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

/** The three values the API's `status` field has ever taken. */
export type LocationStatus = "online" | "offline" | "pending";

/** What the UI renders — `status`, plus the state it cannot report. */
export type LocationLiveStatus = LocationStatus | "unknown";

/** Just enough of a location row to resolve its live status. */
export interface LiveStatusSource {
  status?: LocationStatus;
  /** Server flag: this region cannot observe the location's agents. */
  live_status_unknown?: boolean;
}

/**
 * Live status as the UI must treat it, rather than as the row literally says.
 *
 * Agents register against the one region their poll endpoint resolves to and
 * their rows never replicate, but locations now do — so a location whose
 * agents live in another region arrives here with no agents and a `pending`
 * status, i.e. this region telling the customer to go install an agent for a
 * location that is already running checks somewhere else.
 *
 * The server sets `live_status_unknown` on exactly that case and omits it
 * everywhere else, so a single-region deployment never reaches "unknown".
 * `undefined` is passed through untouched: callers already have their own
 * handling for a payload with no `status` at all.
 */
export function locationLiveStatus(location: LiveStatusSource): LocationLiveStatus | undefined {
  return location.live_status_unknown ? "unknown" : location.status;
}
