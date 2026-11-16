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
const SECOND_MS = 1_000;
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

/** A drag-zoom window widened to whole buckets: the bucket of the bar under each edge (`originMs` is any bucket start). */
// `shiftZone` is the zone `toZonedTime` shifted the chart values to; values in and out stay shifted.
export const snapZoomToBuckets = (
  startMs: number,
  endMs: number,
  intervalMs: number,
  originMs = 0,
  shiftZone?: string,
): { start: number; end: number } => {
  if (!(intervalMs >= SECOND_MS)) {
    const start = Math.floor(startMs / SECOND_MS) * SECOND_MS;
    return { start, end: Math.max(Math.ceil(endMs / SECOND_MS) * SECOND_MS, start + SECOND_MS) };
  }
  // Buckets are uniform in true instants; shifted values gain or lose an hour at a DST change.
  const toTrue = (ms: number) => (shiftZone ? instantFromShiftedMs(ms, shiftZone) / 1000 : ms);
  const toShifted = (ms: number) => (shiftZone ? toZonedTime(ms, shiftZone).getTime() : ms);
  const origin = toTrue(originMs);
  // ECharts centres a time-axis bar on its bucket start, so the bar under a point is the nearest start.
  const first = Math.round((toTrue(startMs) - origin) / intervalMs);
  const last = Math.max(Math.round((toTrue(endMs) - origin) / intervalMs), first);
  return {
    start: toShifted(origin + first * intervalMs),
    end: toShifted(origin + (last + 1) * intervalMs),
  };
};
