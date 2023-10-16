// Copyright 2023 Zinc Labs Inc.

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.

import { convertPromQLData } from "@/utils/dashboard/convertPromQLData";
import { convertSQLData } from "@/utils/dashboard/convertSQLData";
import { convertTableData } from "@/utils/dashboard/convertTableData";
import { convertMapData } from "@/utils/dashboard/convertMapData";
import { convertPromQLTableData } from "./convertPromQLTableData";
/**
 * Converts panel data based on the panel schema and data.
 *
 * @param {any} panelSchema - The panel schema.
 * @param {any} data - The data to be converted.
 * @return {any} The converted data.
 */
export const convertPanelData = (panelSchema: any, data: any, store: any, chartPanelRef: any) => {
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
    case "gauge":
       {
      if (
        // panelSchema?.fields?.stream_type == "metrics" &&
        // panelSchema?.customQuery &&
        panelSchema?.queryType == "promql"
      ) {
        // chartpanelref will be used to get width and height of the chart element from DOM
        return {chartType: panelSchema.type, ...convertPromQLData(panelSchema, data, store, chartPanelRef)};
      } else {
        // chartpanelref will be used to get width and height of the chart element from DOM
        return {chartType: panelSchema.type, ...convertSQLData(panelSchema, data, store, chartPanelRef)};
      }
    }
    case "table": {
      if (panelSchema?.queryType == "promql") {
        return {chartType: panelSchema.type, ...convertPromQLTableData(panelSchema, data)};
      } else {
        return {chartType: panelSchema.type, ...convertTableData(panelSchema, data)};
      }
    }
    case "geomap": {
      return {chartType: panelSchema.type, ...convertMapData(panelSchema, data)};
    }
    default: {
      console.log("No Chart Type found, skipping");
      break;
    }
  }
};

