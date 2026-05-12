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

import {
  applyAutoSQLTimeSeries,
  applyCustomSQLTimeSeries,
} from "../sqlTimeSeriesConverter";
import { isGivenFieldInOrderBy } from "../../query/sqlUtils";
import { applyLegendConfiguration } from "../legendConfiguration";
import { applySeriesColorMappings } from "../chartColorUtils";

import { buildSQLContext } from "./shared/contextBuilder";
import { applyLineAreaScatterBarChart } from "./charts/convertSQLLineAreaChart";
import { applyHBarChart } from "./charts/convertSQLHBarChart";
import { applyStackedChart } from "./charts/convertSQLStackedChart";
import { applyHStackedChart } from "./charts/convertSQLHStackedChart";
import { applyPieDonutChart } from "./charts/convertSQLPieDonutChart";
import { applyHeatmapChart } from "./charts/convertSQLHeatmapChart";
import { applyMetricChart } from "./charts/convertSQLMetricChart";
import { applyGaugeChart } from "./charts/convertSQLGaugeChart";

/**
 * Converts SQL data into a format suitable for rendering a chart.
 * This is the main orchestrator: builds shared context, dispatches to a
 * chart-type handler, then applies common post-processing.
 */
export const convertSQLChartData = async (
  panelSchema: any,
  searchQueryData: any,
  store: any,
  chartPanelRef: any,
  hoveredSeriesState: any,
  resultMetaData: any,
  metadata: any,
  chartPanelStyle: any,
  annotations: any,
  loading?: any,
) => {
  // Build the full shared context (all pre-switch logic lives here)
  const ctx = buildSQLContext(
    panelSchema,
    searchQueryData,
    store,
    chartPanelRef,
    hoveredSeriesState,
    resultMetaData,
    metadata,
    chartPanelStyle,
    annotations,
    loading,
  );

  // Guard returned from contextBuilder (invalid/empty input)
  if (!ctx) {
    return { options: null };
  }

  const {
    options,
    extras,
    yAxisKeys,
    convertedTimeStampToDataFormat,
    getAnnotationMarkLine,
    getSeriesMarkArea,
  } = ctx;

  // Now set the series values as per the chart data
  // Override any configs if required as per the chart type
  switch (panelSchema.type) {
    case "area-stacked":
    case "line":
    case "area":
    case "scatter":
    case "bar": {
      applyLineAreaScatterBarChart(ctx);
      break;
    }
    case "h-bar": {
      applyHBarChart(ctx);
      break;
    }
    case "pie": {
      applyPieDonutChart(ctx);
      break;
    }
    case "donut": {
      applyPieDonutChart(ctx);
      break;
    }
    case "stacked": {
      applyStackedChart(ctx);
      break;
    }
    case "heatmap": {
      applyHeatmapChart(ctx);
      break;
    }
    case "h-stacked": {
      applyHStackedChart(ctx);
      break;
    }
    case "metric": {
      applyMetricChart(ctx);
      break;
    }
    case "gauge": {
      applyGaugeChart(ctx);
      break;
    }

    default: {
      break;
    }
  }

  // POST-PROCESSING (verbatim from original convertSQLData)

  let isTimeSeriesFlag = false;

  // auto SQL: if x axis has time series
  if (
    applyAutoSQLTimeSeries(
      options,
      panelSchema,
      store,
      metadata,
      hoveredSeriesState,
    )
  ) {
    // set timeseries flag as a true
    isTimeSeriesFlag = true;
  }

  //custom SQL: check if it is timeseries or not
  if (
    applyCustomSQLTimeSeries(
      options,
      panelSchema,
      store,
      metadata,
      hoveredSeriesState,
    )
  ) {
    // set timeseries flag as a true
    isTimeSeriesFlag = true;
  }

  // stacked chart sort by y axis
  // ignore if time series chart
  if (
    ["stacked", "h-stacked", "area-stacked"].includes(panelSchema?.type) &&
    isTimeSeriesFlag == false
  ) {
    // get x axis object
    // for h-stacked, categorical axis is y axis
    // for stacked and area-stacked, categorical axis is x axis
    const xAxisObj =
      panelSchema.type == "h-stacked" ? options.yAxis : options.xAxis;

    // check if order by uses y axis field
    // will return null if not exist
    // will return ASC or DESC if exist
    const isYAxisExistInOrderBy = await isGivenFieldInOrderBy(
      metadata?.queries[0]?.query ?? "",
      yAxisKeys[0],
    );
    if (isYAxisExistInOrderBy) {
      // Calculate the total for each series and combine it with the corresponding x-axis label
      const totals = new Map();
      for (let i = 0; i < xAxisObj[0]?.data?.length; i++) {
        const total = options?.series?.reduce(
          (sum: number, currentSeries: any) =>
            sum + (currentSeries?.data[i] ?? 0),
          0,
        );
        totals.set(i, { label: xAxisObj[0]?.data[i], total });
      }

      // Sort the indices by total in the specified order
      // ASC for ascending, DESC for descending
      const sortedIndices = Array.from(totals.keys()).sort((a, b) => {
        const diff = totals.get(a).total - totals.get(b).total;
        return isYAxisExistInOrderBy == "ASC" ? diff : -diff;
      });

      // Create new sorted arrays for the x-axis labels and series
      xAxisObj[0].data = sortedIndices.map((i) => totals.get(i).label);
      options.series = options?.series?.map((currentSeries: any) => {
        currentSeries.data = sortedIndices?.map((i) => currentSeries?.data[i]);
        return currentSeries;
      });
    }
  }

  // Apply all legend configurations using the new centralized function
  applyLegendConfiguration(
    panelSchema,
    chartPanelRef,
    hoveredSeriesState,
    options,
  );

  //check if is there any data else filter out axis or series data
  // for metric, gauge we does not have data field
  if (!["metric", "gauge"].includes(panelSchema.type)) {
    options.series = options.series.filter((it: any) => it.data?.length);
    if (panelSchema.type == "h-bar" || panelSchema.type == "h-stacked") {
      options.xAxis = options.xAxis;
    } else if (!["pie", "donut"].includes(panelSchema.type)) {
      options.yAxis = options.yAxis;
    }
  }
  // allowed to zoom, only if timeseries
  options.toolbox.show = options.toolbox.show && isTimeSeriesFlag;

  if (
    [
      "area",
      "area-stacked",
      "bar",
      "h-bar",
      "line",
      "scatter",
      "stacked",
      "h-stacked",
    ].includes(panelSchema.type) &&
    isTimeSeriesFlag &&
    !panelSchema.config.trellis?.layout
  ) {
    options.series.push({
      type: "line",
      data: [[convertedTimeStampToDataFormat, null]],
      markLine: getAnnotationMarkLine(),
      markArea: getSeriesMarkArea(),
      zlevel: 1,
    });
  }

  // Apply series color mappings via reusable helper
  applySeriesColorMappings(
    options.series,
    panelSchema?.config?.color?.colorBySeries,
    store.state.theme,
  );

  // Apply label truncation to x-axis only
  if (panelSchema.config?.axis_label_truncate_width) {
    if (Array.isArray(options.xAxis)) {
      options.xAxis.forEach((axis: any) => {
        if (!axis.axisLabel) axis.axisLabel = {};
        axis.axisLabel.width = panelSchema.config.axis_label_truncate_width;
        axis.axisLabel.overflow = "truncate";
      });
    } else if (options.xAxis) {
      if (!options.xAxis.axisLabel) options.xAxis.axisLabel = {};
      options.xAxis.axisLabel.width =
        panelSchema.config.axis_label_truncate_width;
      options.xAxis.axisLabel.overflow = "truncate";
    }
  }

  // Merge custom chart options if provided (e.g., for alert preview tooltip customization)
  if (panelSchema.config?.custom_chart_options) {
    const customOptions = panelSchema.config.custom_chart_options;

    // Deep merge custom tooltip options if provided
    if (customOptions.tooltip && options.tooltip) {
      options.tooltip = {
        ...options.tooltip,
        ...customOptions.tooltip,
      };
    }

    // Merge any other custom options
    Object.keys(customOptions).forEach((key) => {
      if (key !== "tooltip" && customOptions[key]) {
        options[key] = {
          ...(options[key] || {}),
          ...customOptions[key],
        };
      }
    });
  }

  return {
    options,
    extras: {
      ...extras,
      panelId: panelSchema?.id,
      isTimeSeries: isTimeSeriesFlag,
    },
  };
};
