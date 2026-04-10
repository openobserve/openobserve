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

import { calculateWidthText } from "../../chartDimensionUtils";
import { largestLabel } from "../shared/contextBuilder";
import { type SQLContext } from "../shared/types";

/**
 * Applies chart-specific options for: h-stacked
 *
 * Mutates `ctx.options` in place, exactly as the original switch case did.
 */
export function applyHStackedChart(ctx: SQLContext): void {
  const {
    options,
    xAxisKeys,
    dynamicXAxisNameGap,
    getSeries,
    getAxisDataFromKey,
  } = ctx;

  options.xAxis[0].data = Array.from(new Set(getAxisDataFromKey(xAxisKeys[0])));

  options.xAxis = options.xAxis.slice(0, 1);

  // stacked with xAxis's second value
  // allow 2 xAxis and 1 yAxis value for stack chart
  // get second x axis key
  options.series = getSeries({ barMinHeight: 1 });

  const temp = options.xAxis;
  options.xAxis = options.yAxis;
  options.yAxis = temp;

  const maxYaxisWidth = options.yAxis.reduce((acc: number, it: any) => {
    return Math.max(acc, it.axisLabel.width || 0);
  }, 0);

  options.yAxis.map((it: any) => {
    it.nameGap =
      Math.min(calculateWidthText(largestLabel(it.data)), maxYaxisWidth) + 10;
  });

  // For h-stacked, xAxis is actually the original yAxis (bottom axis after swap)
  // Apply dynamic nameGap calculation if rotation is configured
  options.xAxis.nameGap = dynamicXAxisNameGap;
}
