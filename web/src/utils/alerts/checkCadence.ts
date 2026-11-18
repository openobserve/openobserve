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

import { thresholdSide } from "./alertCopy";

const STEPS = [1, 2, 3, 5, 10, 15, 20, 30, 60, 120, 180, 360, 720, 1440];
const CHECKS_PER_SPAN = 3;

/** A Check every that fits a span at least three times and divides it, at or above the org's floor;
 * undefined when the floor leaves none. */
export function finerCheckMinutes(spanMinutes: number, floorMinutes: number): number | undefined {
  if (!(spanMinutes > 0)) return undefined;
  const fits = STEPS.filter(
    (step) =>
      step >= Math.max(1, floorMinutes) &&
      step <= spanMinutes / CHECKS_PER_SPAN &&
      spanMinutes % step === 0,
  );
  return fits[fits.length - 1];
}

/** How long a breach can last unseen when every sample in the look back must cross the threshold
 * (lowest above it, highest below it) and the checks do not overlap; undefined when they overlap. */
export function missedBreachMinutes(input: {
  fn: string | undefined;
  operator: string | undefined;
  period: number;
  frequency: number;
}): number | undefined {
  const side = thresholdSide(input.operator);
  const everySample =
    (input.fn === "min" && side === "above") || (input.fn === "max" && side === "below");
  if (!everySample || !(input.period > 0) || !(input.frequency >= input.period)) return undefined;
  return input.period + input.frequency;
}
