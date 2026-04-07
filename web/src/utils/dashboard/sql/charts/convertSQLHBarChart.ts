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
 * Applies chart-specific options for: h-bar
 *
 * Mutates `ctx.options` in place, exactly as the original switch case did.
 */
export function applyHBarChart(ctx: SQLContext): void {
  const {
    options,
    panelSchema,
    xAxisKeys,
    breakDownKeys,
    dynamicXAxisNameGap,
    getSeries,
    getAxisDataFromKey,
    updateTrellisConfig,
  } = ctx;

  //generate trace based on the y axis keys
  options.series = getSeries({ barMinHeight: 1 });

  if (panelSchema.config.trellis?.layout && breakDownKeys.length) {
    updateTrellisConfig();
  }

  //swap x and y axis
  const temp = options.xAxis;
  options.xAxis = options.yAxis;
  options.yAxis = temp;

  // xAxisKeys will be 1
  if (!panelSchema.config.trellis?.layout) {
    const xAxisMaxLabel =
      calculateWidthText(
        xAxisKeys.reduce(
          (str: any, it: any) => largestLabel(getAxisDataFromKey(it)),
          "",
        ),
      ) + 16;

    // breakDownKeys will be 0 or 1
    const breakDownMaxLabel =
      calculateWidthText(
        breakDownKeys.reduce(
          (str: any, it: any) => largestLabel(getAxisDataFromKey(it)),
          "",
        ),
      ) + 16;

    options.yAxis.forEach((it: any) => {
      it.axisLabel.overflow = "truncate";
      it.nameGap =
        Math.min(
          Math.max(xAxisMaxLabel, breakDownMaxLabel),
          it.axisLabel.width,
        ) + 10;
    });

    options.xAxis.name =
      panelSchema.queries[0]?.fields?.y?.length >= 1
        ? panelSchema.queries[0]?.fields?.y[0]?.label
        : "";
    // For h-bar, xAxis is the bottom axis after swap
    // Apply dynamic nameGap calculation if rotation is configured
    options.xAxis.nameGap = dynamicXAxisNameGap;
  }
}
