
import logsdata from "../../../test-data/logs_data.json";
export class IngestionPage {
  constructor(page) {
    this.page = page;
  }
  async ingestion() {
    const orgId = process.env["ORGNAME"];
    const streamName = "e2e_automate";
    const basicAuthCredentials = Buffer.from(`${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`).toString('base64');
    const headers = {
      "Authorization": `Basic ${basicAuthCredentials}`,
      "Content-Type": "application/json",
    };
    const fetchResponse = await fetch(
      `${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`,
      {
        method: "POST",
        headers: headers,
        body: JSON.stringify(logsdata),
      }
    );
    try {
      const response = await fetchResponse;
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const jsonData = await response.json();
        console.log(response.status);
        console.log(response.url);
        // Process JSON data here
      } else {
        const textData = await response.text();
        console.log("Response is not JSON:", textData);
        // Handle the non-JSON response here
      }
    } catch (error) {
      console.error("Failed to parse JSON response:", error);
    }
  }

  async ingestionJoin() {
    const orgId = process.env["ORGNAME"];
    const basicAuthCredentials = Buffer.from(`${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`).toString('base64');
    const headers = {
      "Authorization": `Basic ${basicAuthCredentials}`,
      "Content-Type": "application/json",
    };

    // Ingest to both default and e2e_automate streams for join queries
    const streams = ["default", "e2e_automate"];

    for (const streamName of streams) {
      const fetchResponse = await fetch(
        `${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`,
        {
          method: "POST",
          headers: headers,
          body: JSON.stringify(logsdata),
        }
      );
      try {
        const response = await fetchResponse;
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const jsonData = await response.json();
          console.log(response.status);
          console.log(response.url);
          // Process JSON data here
        } else {
          const textData = await response.text();
          console.log("Response is not JSON:", textData);
          // Handle the non-JSON response here
        }
      } catch (error) {
        console.error("Failed to parse JSON response:", error);
      }
    }
  }

  async ingestionMultiOrg(orgId) {
    const streamName = "e2e_automate";
    const basicAuthCredentials = Buffer.from(`${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`).toString('base64');
    const headers = {
      "Authorization": `Basic ${basicAuthCredentials}`,
      "Content-Type": "application/json",
    };
    const fetchResponse = await fetch(
      `${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`,
      {
        method: "POST",
        headers: headers,
        body: JSON.stringify(logsdata),
      }
    );
    try {
      const response = await fetchResponse;
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const jsonData = await response.json();
        console.log(response.status);
        console.log(response.url);
        // Process JSON data here
      } else {
        const textData = await response.text();
        console.log("Response is not JSON:", textData);
        // Handle the non-JSON response here
      }
    } catch (error) {
      console.error("Failed to parse JSON response:", error);
    }
  }

  async ingestionMultiOrgStream(orgId, streamName) {
    const basicAuthCredentials = Buffer.from(`${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`).toString('base64');
    const headers = {
      "Authorization": `Basic ${basicAuthCredentials}`,
      "Content-Type": "application/json",
    };
    const fetchResponse = await fetch(
      `${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`,
      {
        method: "POST",
        headers: headers,
        body: JSON.stringify(logsdata),
      }
    );
    try {
      const response = await fetchResponse;
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const jsonData = await response.json();
        console.log(response.status);
        console.log(response.url);
        // Process JSON data here
      } else {
        const textData = await response.text();
        console.log("Response is not JSON:", textData);
        // Handle the non-JSON response here
      }
    } catch (error) {
      console.error("Failed to parse JSON response:", error);
    }
  }

  /**
   * Ingest data to unique streams for UNION query testing
   * Uses unique stream names with testRunId to avoid "stream being deleted" conflicts
   * @param {string} testRunId - Unique identifier for this test run (e.g., Date.now().toString(36))
   * @returns {Promise<{streamA: string, streamB: string, results: object}>} Stream names and ingestion results
   */
  async ingestionJoinUnion(testRunId = null) {
    const orgId = process.env["ORGNAME"];
    const ingestionUrl = process.env["INGESTION_URL"];
    const email = process.env["ZO_ROOT_USER_EMAIL"];
    const password = process.env["ZO_ROOT_USER_PASSWORD"];

    // Validate environment variables
    if (!orgId || !ingestionUrl || !email || !password) {
      const missing = [];
      if (!orgId) missing.push("ORGNAME");
      if (!ingestionUrl) missing.push("INGESTION_URL");
      if (!email) missing.push("ZO_ROOT_USER_EMAIL");
      if (!password) missing.push("ZO_ROOT_USER_PASSWORD");
      throw new Error(`ingestionJoinUnion: Missing required environment variables: ${missing.join(", ")}`);
    }

    // Generate unique stream names using testRunId (like SDR tests do)
    const runId = testRunId || Date.now().toString(36);
    const streamA = `e2e_join_a_${runId}`;
    const streamB = `e2e_join_b_${runId}`;
    const streams = [streamA, streamB];

    const basicAuthCredentials = Buffer.from(`${email}:${password}`).toString('base64');
    const headers = {
      "Authorization": `Basic ${basicAuthCredentials}`,
      "Content-Type": "application/json",
    };

    const results = { success: [], failed: [] };

    console.log(`ingestionJoinUnion: Starting ingestion to UNIQUE streams: ${streams.join(", ")}`);
    console.log(`ingestionJoinUnion: TestRunId: ${runId}`);
    console.log(`ingestionJoinUnion: Using URL: ${ingestionUrl}/api/${orgId}/[stream]/_json`);

    // Ingest data to each stream
    for (const streamName of streams) {
      const url = `${ingestionUrl}/api/${orgId}/${streamName}/_json`;
      console.log(`ingestionJoinUnion: Ingesting to stream '${streamName}' at ${url}`);

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: headers,
          body: JSON.stringify(logsdata),
        });

        const statusCode = response.status;
        const contentType = response.headers.get("content-type");

        let responseBody;
        if (contentType && contentType.includes("application/json")) {
          responseBody = await response.json();
        } else {
          responseBody = await response.text();
        }

        console.log(`ingestionJoinUnion: Stream '${streamName}' - Status: ${statusCode}`);
        console.log(`ingestionJoinUnion: Stream '${streamName}' - Response:`, JSON.stringify(responseBody));

        if (statusCode >= 200 && statusCode < 300) {
          results.success.push({ stream: streamName, status: statusCode, response: responseBody });
          console.log(`ingestionJoinUnion: ✓ Stream '${streamName}' ingestion SUCCEEDED`);
        } else {
          results.failed.push({ stream: streamName, status: statusCode, response: responseBody });
          console.error(`ingestionJoinUnion: ✗ Stream '${streamName}' ingestion FAILED with status ${statusCode}`);
        }
      } catch (error) {
        results.failed.push({ stream: streamName, error: error.message });
        console.error(`ingestionJoinUnion: ✗ Stream '${streamName}' ingestion ERROR: ${error.message}`);
      }
    }

    // Summary
    console.log(`ingestionJoinUnion: Results - Success: ${results.success.length}, Failed: ${results.failed.length}`);

    if (results.failed.length > 0) {
      const failedStreams = results.failed.map(f => `${f.stream} (${f.status || f.error})`).join(", ");
      throw new Error(`ingestionJoinUnion: Failed to ingest to streams: ${failedStreams}`);
    }

    // Return stream names so test can use them for selection
    return { streamA, streamB, testRunId: runId, results };
  }
}
