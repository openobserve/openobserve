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

const trimFraction = (text: string, decimals: number) =>
  decimals > 0 ? text.replace(/0+$/, "").replace(/[.,]$/, "") : text;

/** A value-axis tick label: the configured decimals, raised only while rounding would change the tick, so adjacent ticks stay distinct. */
export const formatAxisTickValue = (
  value: any,
  unit: string,
  customUnit: string,
  decimals?: number | null,
) => {
  const configured = decimals ?? 2;
  const at = (places: number) => getUnitValue(value, unit, customUnit, places);
  const exact = at(configured + AXIS_TICK_EXTRA_DECIMALS + 4);
  const exactText = trimFraction(String(exact.value), configured + AXIS_TICK_EXTRA_DECIMALS + 4);
  for (let places = configured; places < configured + AXIS_TICK_EXTRA_DECIMALS; places++) {
    const shown = at(places);
    if (shown.unit !== exact.unit || trimFraction(String(shown.value), places) === exactText) {
      return formatUnitValue(shown);
    }
  }
  return formatUnitValue(at(configured + AXIS_TICK_EXTRA_DECIMALS));
};
