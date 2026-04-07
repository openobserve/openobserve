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

import { formatUnitValue, getUnitValue } from "../../convertDataIntoUnitValue";
import { calculateDynamicNameGap } from "../../chartDimensionUtils";
import { type SQLContext } from "../shared/types";

/**
 * Applies chart-specific options for: stacked
 *
 * Mutates `ctx.options` in place, exactly as the original switch case did.
 */
export function applyStackedChart(ctx: SQLContext): void {
  const {
    options,
    panelSchema,
    store,
    xAxisKeys,
    hasTimestampField,
    getSeries,
    getAxisDataFromKey,
  } = ctx;

  options.xAxis[0].data = Array.from(new Set(getAxisDataFromKey(xAxisKeys[0])));
  options.xAxis = options.xAxis.slice(0, 1);
  options.tooltip.axisPointer.label = {
    show: true,
    backgroundColor: store.state.theme === "dark" ? "#333" : "",
    label: {
      fontsize: 12,
      precision: panelSchema.config?.decimals,
    },
    formatter: function (params: any) {
      try {
        if (params?.axisDimension == "y")
          return formatUnitValue(
            getUnitValue(
              params?.value,
              panelSchema.config?.unit,
              panelSchema.config?.unit_custom,
              panelSchema.config?.decimals,
            ),
          );
        return params?.value?.toString();
      } catch (error) {
        return params?.value?.toString() ?? "";
      }
    },
  };
  const stackedXAxisRotation = hasTimestampField
    ? 0
    : options.xAxis[0].axisLabel?.rotate || 0;
  const stackedXAxisWidth = hasTimestampField
    ? 120
    : panelSchema.config?.axis_label_truncate_width || 120;
  options.xAxis[0].axisLabel.margin = 5;
  options.xAxis[0].axisLabel = {
    rotate: stackedXAxisRotation,
  };
  options.xAxis[0].axisTick = {};
  options.xAxis[0].nameGap = calculateDynamicNameGap(
    stackedXAxisRotation,
    stackedXAxisWidth,
    12,
    25,
    5,
  );

  // stacked with xAxis's second value
  // allow 2 xAxis and 1 yAxis value for stack chart
  // get second x axis key
  options.series = getSeries({ barMinHeight: 1 });
}
