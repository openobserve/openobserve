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
import { calculateOptimalFontSize } from "../../chartDimensionUtils";
import { getContrastColor } from "../../chartColorUtils";
import { type SQLContext } from "../shared/types";

/**
 * Applies chart-specific options for: metric
 *
 * Mutates `ctx.options` in place, exactly as the original switch case did.
 */
export function applyMetricChart(ctx: SQLContext): void {
  const {
    options,
    panelSchema,
    store,
    yAxisKeys,
    defaultSeriesProps,
    getAxisDataFromKey,
  } = ctx;

  const key1 = yAxisKeys[0];
  const yAxisValue = getAxisDataFromKey(key1);
  const unitValue = getUnitValue(
    yAxisValue.length > 0 ? yAxisValue[0] : 0,
    panelSchema.config?.unit,
    panelSchema.config?.unit_custom,
    panelSchema.config?.decimals,
  );
  options.backgroundColor = panelSchema.config?.background?.value?.color ?? "";
  options.dataset = { source: [[]] };
  options.tooltip = {
    show: false,
  };
  options.angleAxis = {
    show: false,
  };
  options.radiusAxis = {
    show: false,
  };
  options.polar = {};
  options.xAxis = [];
  options.yAxis = [];
  options.series = [
    {
      ...defaultSeriesProps,
      renderItem: function (params: any) {
        try {
          const backgroundColor = panelSchema.config?.background?.value?.color;
          const isDarkTheme = store.state.theme === "dark";

          return {
            type: "text",
            style: {
              text: formatUnitValue(unitValue),
              fontSize: calculateOptimalFontSize(
                formatUnitValue(unitValue),
                params?.coordSys?.cx * 2,
              ), //coordSys is relative. so that we can use it to calculate the dynamic size
              fontWeight: 500,
              align: "center",
              verticalAlign: "middle",
              x: params?.coordSys?.cx,
              y: params?.coordSys?.cy,
              fill: getContrastColor(backgroundColor, isDarkTheme),
            },
          };
        } catch (error) {
          return "";
        }
      },
    },
  ];
}
