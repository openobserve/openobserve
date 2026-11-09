// Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/** PD-11: an errors alert fires at three times the usual hourly count. */
export const ERRORS_FACTOR = 3;

/** PD-11: a latency alert fires at twice the usual p95. */
export const LATENCY_FACTOR = 2;

const twoSignificant = (value: number): number => Number(value.toPrecision(2));

// Twelve significant figures first, so float noise such as 1.0000000000000002 does not round up to 2.
const wholeCountAbove = (value: number): number => Math.ceil(Number(value.toPrecision(12)));

/** The threshold the review list and the Add alert dialog both draft: errors a whole count rounded up, latency two significant figures, which fits milliseconds or seconds. */
export const measuredThreshold = (
  kind: "errors" | "latency",
  usual: number | null | undefined,
): number | null => {
  if (typeof usual !== "number" || !Number.isFinite(usual) || usual <= 0) return null;
  return kind === "errors"
    ? wholeCountAbove(usual * ERRORS_FACTOR)
    : twoSignificant(usual * LATENCY_FACTOR);
};

/** Null when there is no usual rate, since a number made up from nothing would read as a measured one. */
export const suggestErrors = (usualPerHour: number | null | undefined): number | null =>
  measuredThreshold("errors", usualPerHour);

export const suggestLatency = (p95Ms: number | null | undefined): number | null =>
  measuredThreshold("latency", p95Ms);

/** How many times the series crossed above the threshold; a long incident stays one firing, not one per point. */
export const firedTimes = (
  points: ReadonlyArray<number | null | undefined>,
  threshold: number,
): number => {
  let fired = 0;
  let above = false;
  for (const point of points) {
    const now = typeof point === "number" && point > threshold;
    if (now && !above) fired += 1;
    above = now;
  }
  return fired;
};
