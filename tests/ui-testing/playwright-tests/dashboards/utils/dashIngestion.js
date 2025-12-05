// ingestion.js
import logsdata from "../../../../test-data/logs_data.json";
import geoMapdata from "../../../../test-data/geo_map.json";
import dashboardChartJsonData from "../../../../test-data/dashboard_chart_json.json";
// Fixed testLogger path - updated to use correct relative path
const testLogger = require('../../utils/test-logger.js');

// Exported function to remove UTF characters
const removeUTFCharacters = (text) => {
  // Remove UTF characters using regular expression
  return text.replace(/[^\x00-\x7F]/g, " ");
};

// Function to retrieve authentication token (to be implemented securely)
const getAuthToken = async () => {
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString("base64");
  return `Basic ${basicAuthCredentials}`;
};

// page is passed here to access the page object (currently not used)
export const ingestion = async (page, streamName = "e2e_automate") => {
  if (!process.env["ORGNAME"] || !process.env["INGESTION_URL"]) {
    throw new Error("Required environment variables are not set");
  }

  const orgId = process.env["ORGNAME"];

  try {
    const headers = {
      "Content-Type": "application/json",
      Authorization: await getAuthToken(),
    };

    const fetchResponse = await fetch(
      `${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(logsdata),
      }
    );

    if (!fetchResponse.ok) {
      throw new Error(
        `HTTP error! status: ${fetchResponse.status}, response: ${fetchResponse}`
      );
    }

    return await fetchResponse.json();
  } catch (error) {
    testLogger.error("Ingestion failed", { error });
    throw error;
  }
};

// Dashboard maps ingestion

// Ingestion function for Geomap and Maps chart
const ingestionForMaps = async (page, streamName = "geojson") => {
  if (!process.env["ORGNAME"] || !process.env["INGESTION_URL"]) {
    throw new Error("Required environment variables are not set");
  }

  const orgId = process.env["ORGNAME"];

  try {
    const headers = {
      "Content-Type": "application/json",
      Authorization: await getAuthToken(),
    };

    const fetchResponse = await fetch(
      `${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(geoMapdata),
      }
    );

    if (!fetchResponse.ok) {
      throw new Error(
        `HTTP error! status: ${fetchResponse.status}, response: ${fetchResponse}`
      );
    }

    return await fetchResponse.json();
  } catch (error) {
    testLogger.error("Ingestion failed", { error });
    throw error;
  }
};

// Ingestion function for Dashboard Chart JSON data
const ingestionForDashboardChartJson = async (page, streamName = "kubernetes") => {
  if (!process.env["ORGNAME"] || !process.env["INGESTION_URL"]) {
    throw new Error("Required environment variables are not set");
  }

  const orgId = process.env["ORGNAME"];

  try {
    const headers = {
      "Content-Type": "application/json",
      Authorization: await getAuthToken(),
    };

    const fetchResponse = await fetch(
      `${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(dashboardChartJsonData),
      }
    );

    if (!fetchResponse.ok) {
      throw new Error(
        `HTTP error! status: ${fetchResponse.status}, response: ${fetchResponse}`
      );
    }

    return await fetchResponse.json();
  } catch (error) {
    testLogger.error("Dashboard Chart JSON ingestion failed", { error });
    throw error;
  }
};

// Export only the required functions
export { ingestionForMaps, ingestionForDashboardChartJson, getAuthToken, removeUTFCharacters };
