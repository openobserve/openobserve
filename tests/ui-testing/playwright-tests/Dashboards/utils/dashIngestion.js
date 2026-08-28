// ingestion.js
import logsdata from "../../../../test-data/logs_data.json";
import geoMapdata from "../../../../test-data/geo_map.json";
import dashboardChartJsonData from "../../../../test-data/dashboard_chart_json.json";
import sankeyData from "../../../../test-data/sankey_data.json";
// Fixed testLogger path - updated to use correct relative path
const testLogger = require('../../utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier, refreshCloudConfig } = require('../../utils/cloud-auth.js');

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

// `page` is used to recover a rotated cloud passcode via its live session (see below)
export const ingestion = async (page, streamName = "e2e_automate") => {
  if (!process.env["INGESTION_URL"]) {
    throw new Error("Required environment variables are not set");
  }

  // Resolve headers/org per attempt so a refreshed passcode is picked up on retry.
  const post = () =>
    fetch(
      `${process.env.INGESTION_URL}/api/${getOrgIdentifier()}/${streamName}/_json`,
      {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(logsdata),
      }
    );

  const MAX_ATTEMPTS = 3;

  try {
    let fetchResponse;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      fetchResponse = await post();

      // The per-org cloud passcode can be rotated mid-session (another shard, or expiry).
      // The 401 leaves no data ingested and surfaces far away as "No dropdown options
      // appeared for stream", so refresh it from the page's live session and retry.
      if ((fetchResponse.status === 401 || fetchResponse.status === 403) && page) {
        testLogger.warn(
          `Ingestion returned ${fetchResponse.status} — refreshing cloud passcode and retrying`
        );
        if (await refreshCloudConfig(page)) continue;
      }

      // Transient upstream failure (e.g. "502 Proxy request failed") — payload and
      // credentials are fine, so back off briefly and retry rather than fail beforeEach.
      if (fetchResponse.status >= 500 && attempt < MAX_ATTEMPTS) {
        testLogger.warn(
          `Ingestion returned ${fetchResponse.status} — retrying (attempt ${attempt}/${MAX_ATTEMPTS})`
        );
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        continue;
      }

      break;
    }

    if (!fetchResponse.ok) {
      const body = await fetchResponse.text().catch(() => "");
      throw new Error(
        `HTTP error! status: ${fetchResponse.status}, response: ${body.slice(0, 200)}`
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
  if (!process.env["INGESTION_URL"]) {
    throw new Error("Required environment variables are not set");
  }

  const orgId = getOrgIdentifier();

  try {
    const headers = getAuthHeaders();

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
  if (!process.env["INGESTION_URL"]) {
    throw new Error("Required environment variables are not set");
  }

  const orgId = getOrgIdentifier();

  try {
    const headers = getAuthHeaders();

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

// Ingestion function for Sankey chart data
const ingestionForSankey = async (streamName = "sankey_data") => {
  if (!process.env["INGESTION_URL"]) {
    throw new Error("Required environment variables are not set");
  }

  const orgId = getOrgIdentifier();

  try {
    const headers = getAuthHeaders();

    const fetchResponse = await fetch(
      `${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(sankeyData),
      }
    );

    if (!fetchResponse.ok) {
      throw new Error(
        `HTTP error! status: ${fetchResponse.status}, response: ${fetchResponse}`
      );
    }

    return await fetchResponse.json();
  } catch (error) {
    testLogger.error("Sankey data ingestion failed", { error });
    throw error;
  }
};

// Export only the required functions
export { ingestionForMaps, ingestionForDashboardChartJson, ingestionForSankey, getAuthToken, removeUTFCharacters };
