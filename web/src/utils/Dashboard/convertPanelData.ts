import { convertPromQLData } from "@/utils/dashboard/convertPromQLData";
import { convertSQLData } from "@/utils/dashboard/convertSQLData";
import { convertTableData } from "@/utils/dashboard/convertTableData";
/**
 * Converts panel data based on the panel schema and data.
 *
 * @param {any} panelSchema - The panel schema.
 * @param {any} data - The data to be converted.
 * @return {any} The converted data.
 */
export const convertPanelData = (panelSchema: any, data: any, store: any) => {
  // based on the panel config, using the switch calling the appropriate converter
  switch (panelSchema.type) {
    case "area":
    case "area-stacked":
    case "bar":
    case "h-bar":
    case "stacked":
    case "h-stacked":
    case "line":
    case "pie":
    case "donut":
    case "scatter":
    case "metric": {
      if (
        panelSchema?.fields?.stream_type == "metrics" &&
        panelSchema?.customQuery &&
        panelSchema?.queryType == "promql"
      ) {
        return convertPromQLData(panelSchema, data, store);
      } else {
        return convertSQLData(panelSchema, data, store);
      }
    }
    case "table": {
      return convertTableData(panelSchema, data);
    }
    case "geomap": {
      return convertMapData();
    }
    default: {
      console.log("No Chart Type found, skipping");
      break;
    }
  }
};

const convertMapData = () => {};
