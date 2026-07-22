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

// Copy-button size (icon-xs-sq) and the slot it needs beside the value
// (button + gaps). The value stays perfectly centered, so free width splits
// evenly between both sides — reserving the slot on BOTH sides during font
// fitting keeps the right-hand slot available on any reasonably wide panel.
export const METRIC_COPY_BTN_PX = 28;
export const METRIC_COPY_BTN_SLOT_PX = METRIC_COPY_BTN_PX + 4;

// Below this the value stops being readable; the fit may use it even when
// the button slot no longer fits, and the button then moves below the value
// (or hides) instead of shrinking the text further.
export const METRIC_MIN_FONT_PX = 12;

/**
 * Font size for a metric value: fits the width left over after reserving the
 * copy-button slot on both sides, capped by the cell height, and floored at
 * a readable minimum (never beyond what the height allows).
 */
export const calculateMetricFontSize = (text: string, width: number, height: number): number => {
  const fit = calculateOptimalFontSize(text, width - 2 * METRIC_COPY_BTN_SLOT_PX, height);
  const heightCap = Math.max(1, Math.floor(height / 1.2));
  const floorCap = Math.min(METRIC_MIN_FONT_PX, heightCap);
  // common case: the fit already clears the readability floor, so the
  // full-width fit (a second measurement binary search) is not needed
  if (fit >= floorCap) return fit;
  // the floor may ignore the button slots (the button wraps instead), but it
  // must never exceed what the full cell width fits — that would clip digits
  const fullWidthFit = calculateOptimalFontSize(text, width, height);
  return Math.max(fit, Math.min(floorCap, fullWidthFit));
};

/**
 * Applies chart-specific options for: metric
 *
 * Mutates `ctx.options` in place.
 */
export function applyMetricChart(ctx: SQLContext): void {
  const {
    options,
    panelSchema,
    store,
    yAxisKeys,
    defaultSeriesProps,
    getAxisDataFromKey,
    chartPanelRef,
  } = ctx;

  const key1 = yAxisKeys?.[0];
  const yAxisValue = getAxisDataFromKey(key1);
  const unitValue = getUnitValue(
    yAxisValue?.length > 0 ? yAxisValue[0] : 0,
    panelSchema?.config?.unit,
    panelSchema?.config?.unit_custom,
    panelSchema?.config?.decimals,
  );
  const metricText = formatUnitValue(unitValue);
  options.backgroundColor = panelSchema?.config?.background?.value?.color ?? "";
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
  const metricFillColor = getContrastColor(
    panelSchema?.config?.background?.value?.color,
    store?.state?.theme === "dark",
  );
  const metricFieldLabel = panelSchema?.queries?.[0]?.fields?.y?.[0]?.label || key1;
  options.series = [
    {
      ...defaultSeriesProps,
      _metricText: metricText,
      _metricFillColor: metricFillColor,
      _metricLabel: metricFieldLabel,
      renderItem: function (params: any) {
        try {
          const backgroundColor = panelSchema?.config?.background?.value?.color;
          const isDarkTheme = store?.state?.theme === "dark";
          return {
            type: "text",
            style: {
              text: metricText,
              fontSize: calculateMetricFontSize(
                metricText,
                params?.coordSys?.cx * 2,
                params?.coordSys?.cy * 2,
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

  // Rect for the per-value copy icon overlay (single metric fills the area).
  const panelEl = chartPanelRef?.value;
  if (panelEl) {
    const w = panelEl.offsetWidth;
    const h = panelEl.offsetHeight;
    options.series[0]._metricLayout = {
      left: 0,
      top: 0,
      width: w,
      height: h,
      cx: w / 2,
      cy: h / 2,
      fontSize: calculateMetricFontSize(metricText, w, h),
    };
  }
}
