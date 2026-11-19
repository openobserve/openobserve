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

/** The lowest and highest value a preview drew, and whether any had a fraction. */
export interface ValueRange {
  min: number;
  max: number;
  fractional: boolean;
}

// A utilisation ratio can pass 1 (a pod over its limit), so up to 2 still reads as a ratio.
const RATIO_CEILING = 2;

/** The range across every numeric `[time, value]` point of the drawn series; null when none is a number. */
export function seriesValueRange(series: ReadonlyArray<{ data?: unknown }>): ValueRange | null {
  let range: ValueRange | null = null;
  for (const { data } of series) {
    if (!Array.isArray(data)) continue;
    for (const point of data) {
      const raw = Array.isArray(point) ? point[1] : point;
      if (raw === null || raw === undefined || raw === "") continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      range = {
        min: Math.min(range?.min ?? value, value),
        max: Math.max(range?.max ?? value, value),
        fractional: (range?.fractional ?? false) || !Number.isInteger(value),
      };
    }
  }
  return range;
}

/**
 * The ratio a typed threshold means when it reads as a percent (2 to 100) but the values are a
 * 0-1 ratio, by their declared unit or by what the preview drew; null when nothing suggests one.
 */
export function ratioThresholdFix(input: {
  value: unknown;
  declaredRatio: boolean;
  range: ValueRange | null;
}): number | null {
  const typed = input.value === "" || input.value === null ? NaN : Number(input.value);
  if (!Number.isFinite(typed) || typed <= RATIO_CEILING || typed > 100) return null;
  const { range } = input;
  if (range) {
    if (range.min < 0 || range.max > RATIO_CEILING || !range.fractional) return null;
  } else if (!input.declaredRatio) {
    return null;
  }
  return Math.round(typed * 100) / 10000;
}
