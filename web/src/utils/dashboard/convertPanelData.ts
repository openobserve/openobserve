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

import { gt } from "@/types/i18n";
import { convertPromQLData } from "@/utils/dashboard/convertPromQLData";
import { convertMultiSQLData } from "@/utils/dashboard/convertSQLData";
import { convertTableData, convertMultiQueryTableData } from "@/utils/dashboard/convertTableData";
import { convertPivotTableData } from "@/utils/dashboard/convertPivotTableData";
import { convertGeoMapData } from "@/utils/dashboard/convertGeoMapData";
import { convertMapsData } from "@/utils/dashboard/convertMapsData";
import { convertSankeyData } from "./convertSankeyData";
import {
  runJavaScriptCode,
  validateUserCode,
  type CustomChartContext,
} from "./convertCustomChartData";
import { convertStateTimelineData } from "./convertStateTimelineData";
import { applyCartesianOptions } from "./cartesianOptions";
import { applyPanelTypeOptions } from "./panelTypeOptions";
import { applyMetricOptions } from "./metricOptions";
import { applyGeoMapClusters, mapClusterRadius } from "./geoMapCluster";
import { applyTableOptions } from "./tableOptions";
import { barGaugeSchemaAsGauge, convertBarGaugeData } from "./convertBarGaugeData";
import { convertDistributionData } from "./convertDistributionData";
import { convertTreemapData } from "./convertTreemapData";
import { convertSunburstData } from "./convertSunburstData";
import { convertFunnelData } from "./convertFunnelData";
import { convertNodeGraphData } from "./convertNodeGraphData";
import { convertFlameGraphPanelData } from "./convertFlameGraphPanelData";
import { convertHostmapData } from "./convertHostmapData";
/**
 * Converts panel data based on the panel schema and data.
 *
 * @param {any} panelSchema - The panel schema.
 * @param {any} data - The data to be converted.
 * @return {any} The converted data.
 */
export const convertPanelData = async (
  panelSchema: any,
  data: any,
  store: any,
  chartPanelRef: any,
  hoveredSeriesState: any,
  resultMetaData: any,
  metadata: any,
  chartPanelStyle: any,
  annotations: any,
  loading: any = false,
  // Metric sparkline: per-query histogram hits (SQL metric only).
  sparklineData?: any,
  customChartContext?: CustomChartContext,
) => {
  // based on the panel config, using the switch calling the appropriate converter
  // based on panel Data chartType is taken for ignoring unnecessary api calls
  switch (panelSchema.type) {
    case "area":
    case "area-stacked":
    case "bar":
    case "h-bar":
    case "stacked":
    case "heatmap":
    case "h-stacked":
    case "line":
    case "pie":
    case "donut":
    case "scatter":
    case "metric":
    case "gauge": {
      // Skip conversion if no fields are selected in builder mode
      // (prevents echarts errors like "axis.getAxesOnZeroOf is not a function")
      // PromQL queries don't use builder fields, so skip this check for them.
      // Custom-query panels (e.g. logs Timechart) derive axes from the
      // SQL result asynchronously, so empty x/y is a valid transient state there.
      const query = panelSchema?.queries?.[0];
      if (
        panelSchema?.queryType !== "promql" &&
        !query?.customQuery &&
        !query?.fields?.x?.length &&
        !query?.fields?.y?.length
      ) {
        throw new Error(gt("dashboard.utils.selectRequiredFields"));
      }

      const convert = async (rows: any, meta: any, sparkline: any, resultMeta: any) => {
        if (panelSchema?.queryType == "promql") {
          // chartpanelref will be used to get width and height of the chart element from DOM
          return await convertPromQLData(
            panelSchema,
            rows,
            store,
            chartPanelRef,
            hoveredSeriesState,
            annotations,
            meta,
            resultMeta?.value,
            loading,
          );
        }
        return await convertMultiSQLData(
          panelSchema,
          rows,
          store,
          chartPanelRef,
          hoveredSeriesState,
          resultMeta,
          meta,
          chartPanelStyle,
          annotations,
          loading,
          sparkline,
        );
      };
      try {
        const result: any = await convert(data, metadata, sparklineData, resultMetaData);
        applyCartesianOptions(result?.options, panelSchema);
        applyPanelTypeOptions(result?.options, panelSchema, chartPanelRef);
        applyMetricOptions(result?.options, panelSchema);
        return { chartType: panelSchema.type, ...result };
      } catch (error) {
        if (panelSchema?.queryType == "promql") throw error;
        console.error(error);
        return {};
      }
    }
    case "bar-gauge": {
      const query = panelSchema?.queries?.[0];
      if (panelSchema?.queryType !== "promql" && !query?.customQuery && !query?.fields?.y?.length) {
        throw new Error(gt("dashboard.utils.selectRequiredFields"));
      }
      // The gauge converters already reduce each series and resolve its colour and unit text.
      const gaugeSchema = barGaugeSchemaAsGauge(panelSchema);
      try {
        const gauges: any =
          panelSchema?.queryType == "promql"
            ? await convertPromQLData(
                gaugeSchema,
                data,
                store,
                chartPanelRef,
                hoveredSeriesState,
                annotations,
                metadata,
                resultMetaData?.value,
                loading,
              )
            : await convertMultiSQLData(
                gaugeSchema,
                data,
                store,
                chartPanelRef,
                hoveredSeriesState,
                resultMetaData,
                metadata,
                chartPanelStyle,
                annotations,
                loading,
              );
        return {
          chartType: panelSchema.type,
          ...gauges,
          options: convertBarGaugeData(gauges?.options, panelSchema),
        };
      } catch (error) {
        if (panelSchema?.queryType == "promql") throw error;
        console.error(error);
        return {};
      }
    }
    case "distribution": {
      return {
        chartType: panelSchema.type,
        ...convertDistributionData(panelSchema, data, store),
      };
    }
    case "treemap": {
      return {
        chartType: panelSchema.type,
        ...convertTreemapData(panelSchema, data, store),
      };
    }
    case "sunburst": {
      return {
        chartType: panelSchema.type,
        ...convertSunburstData(panelSchema, data, store, chartPanelRef),
      };
    }
    case "funnel": {
      return {
        chartType: panelSchema.type,
        ...convertFunnelData(panelSchema, data, store, chartPanelRef),
      };
    }
    case "node-graph": {
      return {
        chartType: panelSchema.type,
        ...convertNodeGraphData(panelSchema, data, store, chartPanelRef),
      };
    }
    case "flame-graph": {
      return {
        chartType: panelSchema.type,
        ...convertFlameGraphPanelData(panelSchema, data),
      };
    }
    case "table": {
      // Check if PromQL query type
      if (panelSchema?.queryType == "promql") {
        return {
          chartType: panelSchema.type,
          ...(await convertPromQLData(
            panelSchema,
            data,
            store,
            chartPanelRef,
            hoveredSeriesState,
            annotations,
            metadata,
            resultMetaData?.value,
            loading,
          )),
        };
      } else {
        // SQL query type — check for pivot mode
        const pivotQuery = panelSchema?.queries?.[0];
        const isPivot =
          (pivotQuery?.fields?.x?.length ?? 0) > 0 &&
          (pivotQuery?.fields?.breakdown?.length ?? 0) > 0 &&
          (pivotQuery?.fields?.y?.length ?? 0) > 0;

        if (isPivot) {
          // Pivot: single query only
          return {
            chartType: panelSchema.type,
            ...convertPivotTableData(panelSchema, [data[0]], store),
          };
        }

        // Multi-query UNION mode for non-pivot tables
        const table =
          Array.isArray(data) && data.length > 1
            ? convertMultiQueryTableData(panelSchema, data, store)
            : convertTableData(panelSchema, data, store);
        applyTableOptions(table, panelSchema);
        return { chartType: panelSchema.type, ...table };
      }
    }
    case "geomap": {
      const result: any =
        panelSchema?.queryType == "promql"
          ? await convertPromQLData(
              panelSchema,
              data,
              store,
              chartPanelRef,
              hoveredSeriesState,
              annotations,
              metadata,
              resultMetaData?.value,
              loading,
            )
          : convertGeoMapData(panelSchema, data);
      const clusterRadius = mapClusterRadius(panelSchema?.config);
      if (clusterRadius !== null && result?.options) {
        applyGeoMapClusters(result.options, clusterRadius, panelSchema.config?.map_view?.zoom);
      }
      return { chartType: panelSchema.type, ...result };
    }
    case "maps": {
      // Check if PromQL query type
      if (panelSchema?.queryType == "promql") {
        return {
          chartType: panelSchema.type,
          ...(await convertPromQLData(
            panelSchema,
            data,
            store,
            chartPanelRef,
            hoveredSeriesState,
            annotations,
            metadata,
            resultMetaData?.value,
            loading,
          )),
        };
      } else {
        // SQL query type
        return {
          chartType: panelSchema.type,
          ...convertMapsData(panelSchema, data),
        };
      }
    }
    case "sankey": {
      return {
        chartType: panelSchema.type,
        ...convertSankeyData(panelSchema, data),
      };
    }
    case "state-timeline": {
      return {
        chartType: panelSchema.type,
        ...convertStateTimelineData(
          panelSchema,
          data,
          store,
          chartPanelRef,
          resultMetaData?.value ?? resultMetaData,
          metadata,
          hoveredSeriesState,
          annotations,
        ),
      };
    }
    case "hostmap": {
      return {
        chartType: panelSchema.type,
        ...convertHostmapData(panelSchema, data, store, metadata, chartPanelRef),
      };
    }
    case "custom_chart": {
      const validationError = validateUserCode(panelSchema.customChartContent ?? "");
      if (validationError) {
        throw new Error(gt("dashboard.utils.unsafeCodeDetected", { error: validationError }));
      }

      const hasData =
        panelSchema?.queryType === "promql"
          ? data.length > 0 && data[0].result.length > 0
          : data.length > 0 && data[0].length > 0;

      if (hasData) {
        const result = await runJavaScriptCode(panelSchema, data, customChartContext);
        const safeResult = result && typeof result === "object" ? result : {};
        return {
          chartType: panelSchema.type,
          ...safeResult,
        };
      }
    }
    // falls through — custom chart without data resolves to the default empty result
    default: {
      return {};
    }
  }
};
