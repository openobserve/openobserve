// ingestion.js
import logsdata from "../../../test-data/logs_data.json"
import geoMapdata from "../../../test-data/geo_map.json";


// Exported function to remove UTF characters
export const removeUTFCharacters = (text) => {
     // console.log(text, "tex");
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
      throw new Error(`HTTP error! status: ${fetchResponse.status}, response: ${fetchResponse}`);
    }

    return await fetchResponse.json();
  } catch (error) {
    console.error("Ingestion failed:", error);
    throw error;
  }
};

  
// Dashboard maps ingestion

// Exported function to remove UTF characters (only one declaration)
const removeUTFCharacters1 = (text) => {
  return text.replace(/[^\x00-\x7F]/g, " ");
};

// Function to retrieve authentication token (to be implemented securely)
const getAuthTokenformaps = async () => {
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString("base64");
  return `Basic ${basicAuthCredentials}`;
};

// Ingestion function for Geomap and Maps chart
const ingestionForMaps = async (page, streamName = "geojson") => {
  if (!process.env["ORGNAME"] || !process.env["INGESTION_URL"]) {
    throw new Error("Required environment variables are not set");
  }

  const orgId = process.env["ORGNAME"];

  try {
    const headers = {
      "Content-Type": "application/json",
      Authorization: await getAuthTokenformaps(),
    };

    const fetchResponse = await fetch(
      `${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(geoMapdata), // Ensure geoMapdata is defined/imported
      }
    );

    if (!fetchResponse.ok) {
      throw new Error(`HTTP error! status: ${fetchResponse.status}, response: ${fetchResponse}`);
    }

    return await fetchResponse.json();
  } catch (error) {
    console.error("Ingestion failed:", error);
    throw error;
  }
};

// Export only the required functions
export { ingestionForMaps, getAuthTokenformaps, removeUTFCharacters1 };
