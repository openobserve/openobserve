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

import { fromZonedTime, toZonedTime } from "date-fns-tz";

const HALF_HOUR_MS = 1_800_000;
// Zone offsets move by at most this much at a DST change, so the true instant lies within it of the first guess.
const CANDIDATE_STEPS = [0, -2, 2, -1, 1];

/** The true instant (µs) behind a chart value made by `toZonedTime(instant, shiftZone)`. */
export const instantFromShiftedMs = (shiftedMs: number, shiftZone: string): number => {
  const guess = fromZonedTime(new Date(shiftedMs), shiftZone).getTime();
  if (!Number.isFinite(guess)) return shiftedMs * 1000;
  // A shifted value is re-encoded the same way to confirm it; a browser DST gap can make the guess miss.
  const exact = CANDIDATE_STEPS.map((step) => guess + step * HALF_HOUR_MS).find(
    (candidate) => toZonedTime(candidate, shiftZone).getTime() === shiftedMs,
  );
  return (exact ?? guess) * 1000;
};
