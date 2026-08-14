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

      // On cloud the ingestion passcode is per-org and can be rotated out from under a
      // running session (another shard sharing the org, or plain expiry). When that
      // happens this call 401s, no data lands, and the failure surfaces much later and
      // far away — as "No dropdown options appeared for stream", or a variable that
      // loaded 0 options — with nothing pointing at auth. refreshCloudConfig re-fetches
      // the passcode using the page's live cookie session, so retry behind it.
      if ((fetchResponse.status === 401 || fetchResponse.status === 403) && page) {
        testLogger.warn(
          `Ingestion returned ${fetchResponse.status} — refreshing cloud passcode and retrying`
        );
        if (await refreshCloudConfig(page)) continue;
      }

      // Transient upstream failures: the ingest node behind the proxy intermittently
      // drops a request under load ("502 Proxy request failed: error sending request
      // for url ..."). Nothing is wrong with the payload or the credentials, and a
      // beforeEach that dies here fails the whole test far from the real cause, so back
      // off briefly and try again.
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
