// ingestion.js
import logsdata from "../../test-data/logs_data.json";
import geoMapdata from "../../test-data/geo_map.json";
import dashboardChartJsonData from "../../test-data/dashboard_chart_json.json";
// Using require() for testLogger as it exports via module.exports (CommonJS)
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

// Exported function to remove UTF characters
const removeUTFCharacters = (text) => {
  // Remove UTF characters using regular expression
  return text.replace(/[^\x00-\x7F]/g, " ");
};

// Function to retrieve authentication token
const getAuthToken = async () => {
  const headers = getAuthHeaders();
  return headers['Authorization'] || headers['authorization'] || '';
};

// Common ingestion helper - extracts shared logic for all ingestion functions
const ingestData = async (streamName, data, errorContext = "Ingestion") => {
  const orgId = getOrgIdentifier();
  if (!orgId || !process.env["INGESTION_URL"]) {
    throw new Error("Required environment variables are not set");
  }

  try {
    const headers = getAuthHeaders();

    const fetchResponse = await fetch(
      `${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(data),
      }
    );

    if (!fetchResponse.ok) {
      const responseText = await fetchResponse.text().catch(() => 'Unable to read response');
      throw new Error(
        `HTTP error! status: ${fetchResponse.status}, response: ${responseText}`
      );
    }

    return await fetchResponse.json();
  } catch (error) {
    testLogger.error(`${errorContext} failed`, { error });
    throw error;
  }
};

// page is passed here to access the page object (currently not used)
export const ingestion = async (page, streamName = "e2e_automate") => {
  return ingestData(streamName, logsdata, "Ingestion");
};

// Ingestion function for Geomap and Maps chart
const ingestionForMaps = async (page, streamName = "geojson") => {
  return ingestData(streamName, geoMapdata, "Maps ingestion");
};

// Ingestion function for Dashboard Chart JSON data
const ingestionForDashboardChartJson = async (page, streamName = "kubernetes") => {
  return ingestData(streamName, dashboardChartJsonData, "Dashboard Chart JSON ingestion");
};

// Export only the required functions
export { ingestionForMaps, ingestionForDashboardChartJson, getAuthToken, removeUTFCharacters };
