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

export type DurationUnit = "seconds" | "min" | "h";

const SECONDS: Record<DurationUnit, number> = { seconds: 1, min: 60, h: 3600 };

// A float product such as 0.1 h in minutes would otherwise store 6.000000000000001.
const clean = (n: number) => Math.round(n * 1e6) / 1e6;

/** A stored value in `base` read in `unit`. */
export function fromBase(value: number, unit: DurationUnit, base: "seconds" | "min"): number {
  return clean((value * SECONDS[base]) / SECONDS[unit]);
}

/** An amount in `unit` stored in `base`. */
export function toBase(amount: number, unit: DurationUnit, base: "seconds" | "min"): number {
  return clean((amount * SECONDS[unit]) / SECONDS[base]);
}

/** The largest unit that shows the value as a whole number; zero and odd values keep the smallest that fits. */
export function pickUnit(
  value: number,
  base: "seconds" | "min",
  units: readonly DurationUnit[],
): { amount: number; unit: DurationUnit } {
  const fits = units.filter((u) => SECONDS[u] >= SECONDS[base]);
  const exact = [...fits]
    .reverse()
    .find((u) => value > 0 && Number.isInteger(fromBase(value, u, base)));
  const unit = exact ?? fits[0] ?? units[0];
  return { amount: fromBase(value, unit, base), unit };
}
