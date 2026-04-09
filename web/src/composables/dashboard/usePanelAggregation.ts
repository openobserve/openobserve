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

export const usePanelAggregation = ({
  dashboardPanelData,
  getDefaultQueries,
  getDefaultCustomChartText,
}: {
  dashboardPanelData: any;
  getDefaultQueries: () => any;
  getDefaultCustomChartText: () => string;
}) => {
  const resetAggregationFunction = () => {
    // Skip resetting fields for PromQL mode to preserve the query
    if (dashboardPanelData.data.queryType === "promql") {
      return;
    }

    switch (dashboardPanelData.data.type) {
      case "heatmap":
        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.y.forEach((itemY: any) => {
            itemY.functionName = null;
            // take first arg
            itemY.args = itemY?.args?.length ? [itemY?.args?.[0]] : [];
          });
          query.fields.breakdown = [];
          query.fields.latitude = null;
          query.fields.longitude = null;
          query.fields.weight = null;
          query.fields.name = null;
          query.fields.value_for_maps = null;
          query.fields.source = null;
          query.fields.target = null;
          query.fields.value = null;

          // make sure that x axis should not have more than one field
          if (query.fields.x.length > 1) {
            query.fields.x = [query.fields.x[0]];
          }

          // make sure that y axis should not have more than one field
          if (query.fields.y.length > 1) {
            query.fields.y = [query.fields.y[0]];
          }
        });
        if (dashboardPanelData.data.queryType === "sql") {
          dashboardPanelData.layout.currentQueryIndex = 0;
        }
        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent =
          getDefaultCustomChartText();
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
        break;

      case "area":
      case "area-stacked":
      case "bar":
      case "line":
      case "scatter":
      case "h-bar":
      case "stacked":
      case "h-stacked":
        // we have multiple queries for geomap, so if we are moving away, we need to reset
        // the values of lat, lng and weight in all the queries
        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.y.forEach((itemY: any) => {
            if (itemY.functionName === null && !itemY.isDerived) {
              itemY.functionName = "count";
              // take first arg
              itemY.args = itemY.args.length ? [itemY?.args?.[0]] : [];
            }
          });
          query.fields.z = [];
          query.fields.latitude = null;
          query.fields.longitude = null;
          query.fields.weight = null;
          query.fields.name = null;
          query.fields.value_for_maps = null;
          query.fields.source = null;
          query.fields.target = null;
          query.fields.value = null;

          // make sure that x axis should not have more than one field
          if (query.fields.x.length > 1) {
            // if breakdown is empty, then take 2nd x axis field on breakdown and remove all other x axis
            if (query.fields.breakdown.length === 0) {
              query.fields.breakdown = [query.fields.x[1]];
              query.fields.x = [query.fields.x[0]];
            } else {
              query.fields.x = [query.fields.x[0]];
            }
          }
        });
        if (dashboardPanelData.data.queryType === "sql") {
          dashboardPanelData.layout.currentQueryIndex = 0;
        }
        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent =
          getDefaultCustomChartText();
        break;
      case "table":
        // Keep breakdown fields — they are used for pivot table mode
        // we have multiple queries for geomap, so if we are moving away, we need to reset
        // the values of lat, lng and weight in all the queries
        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.y.forEach((itemY: any) => {
            if (itemY.functionName === null && !itemY.isDerived) {
              itemY.functionName = "count";
              // take first arg
              itemY.args = itemY.args.length ? [itemY?.args?.[0]] : [];
            }
          });
          query.fields.z = [];
          query.fields.latitude = null;
          query.fields.longitude = null;
          query.fields.weight = null;
          query.fields.name = null;
          query.fields.value_for_maps = null;
          query.fields.source = null;
          query.fields.target = null;
          query.fields.value = null;
        });
        if (dashboardPanelData.data.queryType === "sql") {
          dashboardPanelData.layout.currentQueryIndex = 0;
        }
        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent =
          getDefaultCustomChartText();

        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
        break;
      case "pie":
      case "donut":
      case "gauge":
        // we have multiple queries for geomap, so if we are moving away, we need to reset
        // the values of lat, lng and weight in all the queries
        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.y.forEach((itemY: any) => {
            if (itemY.functionName === null && !itemY.isDerived) {
              itemY.functionName = "count";
              // take first arg
              itemY.args = itemY.args.length ? [itemY?.args?.[0]] : [];
            }
          });
          query.fields.z = [];
          query.fields.breakdown = [];
          query.fields.latitude = null;
          query.fields.longitude = null;
          query.fields.weight = null;
          query.fields.name = null;
          query.fields.value_for_maps = null;
          query.fields.source = null;
          query.fields.target = null;
          query.fields.value = null;

          // make sure that x axis should not have more than one field
          if (query.fields.x.length > 1) {
            query.fields.x = [query.fields.x[0]];
          }

          // make sure that y axis should not have more than one field
          if (query.fields.y.length > 1) {
            query.fields.y = [query.fields.y[0]];
          }
        });
        if (dashboardPanelData.data.queryType === "sql") {
          dashboardPanelData.layout.currentQueryIndex = 0;
        }
        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent =
          getDefaultCustomChartText();

        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
        break;
      case "metric":
        // we have multiple queries for geomap, so if we are moving away, we need to reset
        // the values of lat, lng and weight in all the queries
        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.y.forEach((itemY: any) => {
            if (itemY.functionName === null && !itemY.isDerived) {
              itemY.functionName = "count";
              // take first arg
              itemY.args = itemY.args.length ? [itemY?.args?.[0]] : [];
            }
          });
          query.fields.z = [];
          query.fields.breakdown = [];
          query.fields.latitude = null;
          query.fields.longitude = null;
          query.fields.weight = null;
          query.fields.name = null;
          query.fields.value_for_maps = null;
          query.fields.source = null;
          query.fields.target = null;
          query.fields.value = null;

          // remove all x axis fields
          query.fields.x = [];
          // make sure that y axis should not have more than one field
          if (query.fields.y.length > 1) {
            query.fields.y = [query.fields.y[0]];
          }
        });
        if (dashboardPanelData.data.queryType === "sql") {
          dashboardPanelData.layout.currentQueryIndex = 0;
        }
        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent =
          getDefaultCustomChartText();

        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
        break;
      case "geomap":
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.x = [];
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.y = [];
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.z = [];
        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.name = null;
          query.fields.value_for_maps = null;
        });
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.breakdown = [];
        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent =
          getDefaultCustomChartText();

        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.source = null;
          query.fields.target = null;
          query.fields.value = null;
        });
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.limit = 0;
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
        break;
      case "html":
        // Preserve current stream and stream_type before resetting
        const htmlCurrentStream =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream;
        const htmlCurrentStreamType =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream_type;

        dashboardPanelData.data.queries = getDefaultQueries();

        // Restore the preserved stream and stream_type
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream = htmlCurrentStream;
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream_type = htmlCurrentStreamType;

        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent =
          getDefaultCustomChartText();
        dashboardPanelData.data.queryType = "";
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
        break;
      case "markdown":
        // Preserve current stream and stream_type before resetting
        const markdownCurrentStream =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream;
        const markdownCurrentStreamType =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream_type;

        dashboardPanelData.data.queries = getDefaultQueries();

        // Restore the preserved stream and stream_type
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream = markdownCurrentStream;
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream_type = markdownCurrentStreamType;

        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.customChartContent =
          getDefaultCustomChartText();

        dashboardPanelData.data.queryType = "";
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
        break;
      case "custom_chart":
        // Preserve current stream and stream_type before resetting
        const customChartCurrentStream =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream;
        const customChartCurrentStreamType =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream_type;

        dashboardPanelData.data.queries = getDefaultQueries();

        // Restore the preserved stream and stream_type
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream = customChartCurrentStream;
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream_type = customChartCurrentStreamType;

        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.queryType = "";
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
        break;
      case "maps":
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.x = [];
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.y = [];
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.z = [];
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.breakdown = [];
        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.latitude = null;
          query.fields.longitude = null;
          query.fields.weight = null;
          query.fields.source = null;
          query.fields.target = null;
          query.fields.value = null;
        });
        break;
      case "sankey":
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.x = [];
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.y = [];
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.z = [];
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.breakdown = [];
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.filter = {
          filterType: "group",
          logicalOperator: "AND",
          conditions: [],
        };
        dashboardPanelData.data.htmlContent = "";
        dashboardPanelData.data.markdownContent = "";
        dashboardPanelData.data.customChartContent =
          getDefaultCustomChartText();
        dashboardPanelData.data.queries?.forEach((query: any) => {
          query.fields.latitude = null;
          query.fields.longitude = null;
          query.fields.weight = null;
          query.fields.name = null;
          query.fields.value_for_maps = null;
        });
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.limit = 0;
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].config.time_shift = [];
      default:
        break;
    }

    // aggregation null then count
  };

  return {
    resetAggregationFunction,
  };
};
