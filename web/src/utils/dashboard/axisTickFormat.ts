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

import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";

const AXIS_TICK_EXTRA_DECIMALS = 3;
// toFixed and Intl.NumberFormat reject more than 100 fraction digits, and Decimals allows up to 100.
const MAX_FRACTION_DIGITS = 100;
// Rounding that moves a tick by less than this share of its value reads as the same tick, so main's label stays.
const AXIS_TICK_RELATIVE_TOLERANCE = 0.005;

/** A value-axis tick label: the configured decimals, raised only while rounding would visibly move the tick, so adjacent ticks stay distinct. */
export const formatAxisTickValue = (
  value: any,
  unit: string,
  customUnit: string,
  decimals?: number | null,
) => {
  const configured = decimals ?? 2;
  const at = (places: number) =>
    getUnitValue(value, unit, customUnit, Math.min(places, MAX_FRACTION_DIGITS));
  const exact = at(configured + AXIS_TICK_EXTRA_DECIMALS + 4);
  const target = Number(exact.value);
  for (let places = configured; places < configured + AXIS_TICK_EXTRA_DECIMALS; places++) {
    const shown = at(places);
    const rounded = Number(shown.value);
    if (
      shown.unit !== exact.unit ||
      !Number.isFinite(rounded) ||
      !Number.isFinite(target) ||
      Math.abs(rounded - target) <= Math.abs(target) * AXIS_TICK_RELATIVE_TOLERANCE
    ) {
      return formatUnitValue(shown);
    }
  }
  return formatUnitValue(at(configured + AXIS_TICK_EXTRA_DECIMALS));
};
