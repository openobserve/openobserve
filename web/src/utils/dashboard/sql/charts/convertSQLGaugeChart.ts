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
import { calculateGridPositions } from "../../calculateGridForSubPlot";
import { getSeriesColor } from "../../colorPalette";
import { chartColor } from "@/utils/chartTheme";
import { type SQLContext } from "../shared/types";
import { gaugeDialRange } from "../../thresholds";
import { createSeriesOverrideLookup, gaugeOverrideTooltip } from "../../seriesOverrides";
import { buildValueMappingCache, lookupDisplayedValueMapping } from "../../tableConfigUtils";
import {
  alignGaugeValueFonts,
  gaugeAutoRange,
  gaugeEndLabels,
  gaugeValueText,
  isGaugeAutoRange,
  sizeGaugeDial,
} from "../../gaugeDial";

/**
 * Applies chart-specific options for: gauge
 *
 * Mutates `ctx.options` in place.
 */
export function applyGaugeChart(ctx: SQLContext): void {
  const {
    options,
    panelSchema,
    store,
    xAxisKeys,
    yAxisKeys,
    chartMin,
    chartMax,
    chartPanelRef,
    defaultSeriesProps,
    getAxisDataFromKey,
  } = ctx;

  const seriesOverrides = createSeriesOverrideLookup(panelSchema?.config);
  const key1 = yAxisKeys[0];
  const yAxisValue = getAxisDataFromKey(key1);
  // used for gauge name
  const xAxisValue = getAxisDataFromKey(xAxisKeys[0]);

  // create grid array based on chart panel width, height and total no. of gauge
  const gridDataForGauge = calculateGridPositions(
    chartPanelRef.value.offsetWidth,
    chartPanelRef.value.offsetHeight,
    yAxisValue.length || 1,
  );

  options.dataset = { source: [[]] };
  options.tooltip = {
    show: true,
    trigger: "item",
    textStyle: {
      color: chartColor("--color-tooltip-text"),
      fontSize: 12,
    },
    valueFormatter: (value: any) => {
      try {
        // unit conversion
        return formatUnitValue(
          getUnitValue(
            value,
            panelSchema.config?.unit,
            panelSchema.config?.unit_custom,
            panelSchema.config?.decimals,
          ),
        );
      } catch (error) {
        return value ?? "";
      }
    },
    enterable: true,
    backgroundColor: chartColor("--color-tooltip-bg"),
    extraCssText:
      // eslint-disable-next-line local/no-hardcoded-px -- ECharts serialises this into its own container — no CSS cascade resolves rem
      "max-height: 200px; overflow: auto; max-width: 500px; user-select: text; scrollbar-width: thin; scrollbar-color: rgba(128,128,128,0.5) transparent;",
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
  // for each gauge we have separate grid
  options.grid = gridDataForGauge.gridArray;

  // No rows is no value, drawn as "-" like PromQL, never a real 0.
  const gaugeData = yAxisValue.length > 0 ? yAxisValue : [null];
  const gaugeNames = xAxisValue.length > 0 ? xAxisValue : [""];
  const queryConfig = panelSchema?.queries[0]?.config;
  const autoRange = isGaugeAutoRange(queryConfig) ? gaugeAutoRange(gaugeData) : null;
  const mappingCache = buildValueMappingCache(panelSchema?.config?.mappings);
  const minDim = Math.min(gridDataForGauge.gridWidth, gridDataForGauge.gridHeight);

  options.series = gaugeData.map((it: any, index: any) => {
    const name = gaugeNames[index] ?? "";
    const unit = seriesOverrides.unitArgs(name);
    const mapping = lookupDisplayedValueMapping(it, mappingCache, unit.decimals);
    const gauge: any = {
      ...defaultSeriesProps,
      ...(autoRange ?? gaugeDialRange(queryConfig?.min, queryConfig?.max, unit.unit)),
      ...gaugeEndLabels(panelSchema?.config?.show_gauge_end_labels, unit),
      // Read after the multi-query merge, which recomputes the range across every query.
      _autoRange: isGaugeAutoRange(queryConfig),
      _mappedColor: mapping?.color || undefined,

      //which grid will be used
      gridIndex: index,

      // center of gauge
      // x: left + width / 2,
      // y: top + height / 2,
      center: [
        `${parseFloat(options.grid[index].left) + parseFloat(options.grid[index].width) / 2}%`,
        `${parseFloat(options.grid[index].top) + parseFloat(options.grid[index].height) / 2}%`,
      ],

      data: [
        {
          // gauge name may have or may not have
          name,
          value: it,
          detail: {
            formatter: (value: unknown) => gaugeValueText(value, mapping, unit),
            ...(mapping?.textColor ? { color: mapping.textColor } : {}),
          },
          itemStyle: {
            color:
              mapping?.color ||
              (seriesOverrides.get(name)?.color ??
                getSeriesColor(
                  panelSchema?.config?.color,
                  gaugeNames[index] ?? "",
                  [it],
                  chartMin,
                  chartMax,
                  store.state.theme,
                  panelSchema?.config?.color?.colorBySeries,
                ) ??
                null),
          },
        },
      ],
      ...gaugeOverrideTooltip(seriesOverrides, name),
      detail: {
        // A counting label keeps animating after a same-value re-render snaps the dial, so a throttled tab freezes it on a stale number.
        valueAnimation: false,
        offsetCenter: [0, 0],
      },
    };
    sizeGaugeDial(gauge, minDim, gridDataForGauge.gridWidth);
    return gauge;
  });
  alignGaugeValueFonts(options.series, minDim);
}
