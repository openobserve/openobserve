
import logsdata from "../../../test-data/logs_data.json";
const testLogger = require('../../playwright-tests/utils/test-logger.js');
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
        testLogger.debug(`ingestion: Status ${response.status}`);
        testLogger.debug(`ingestion: URL ${response.url}`);
      } else {
        const textData = await response.text();
        testLogger.warn("ingestion: Response is not JSON:", textData);
      }
    } catch (error) {
      testLogger.error("ingestion: Failed to parse JSON response:", error);
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
          testLogger.debug(`ingestionJoin: Status ${response.status}`);
          testLogger.debug(`ingestionJoin: URL ${response.url}`);
        } else {
          const textData = await response.text();
          testLogger.warn("ingestionJoin: Response is not JSON:", textData);
        }
      } catch (error) {
        testLogger.error("ingestionJoin: Failed to parse JSON response:", error);
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
        testLogger.debug(`ingestionMultiOrg: Status ${response.status}`);
        testLogger.debug(`ingestionMultiOrg: URL ${response.url}`);
      } else {
        const textData = await response.text();
        testLogger.warn("ingestionMultiOrg: Response is not JSON:", textData);
      }
    } catch (error) {
      testLogger.error("ingestionMultiOrg: Failed to parse JSON response:", error);
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
        testLogger.debug(`ingestionMultiOrgStream: Status ${response.status}`);
        testLogger.debug(`ingestionMultiOrgStream: URL ${response.url}`);
      } else {
        const textData = await response.text();
        testLogger.warn("ingestionMultiOrgStream: Response is not JSON:", textData);
      }
    } catch (error) {
      testLogger.error("ingestionMultiOrgStream: Failed to parse JSON response:", error);
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

    testLogger.info(`ingestionJoinUnion: Starting ingestion to UNIQUE streams: ${streams.join(", ")}`);
    testLogger.debug(`ingestionJoinUnion: TestRunId: ${runId}`);
    testLogger.debug(`ingestionJoinUnion: Using URL: ${ingestionUrl}/api/${orgId}/[stream]/_json`);

    // Ingest data to each stream
    for (const streamName of streams) {
      const url = `${ingestionUrl}/api/${orgId}/${streamName}/_json`;
      testLogger.debug(`ingestionJoinUnion: Ingesting to stream '${streamName}' at ${url}`);

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

        testLogger.debug(`ingestionJoinUnion: Stream '${streamName}' - Status: ${statusCode}`);
        testLogger.debug(`ingestionJoinUnion: Stream '${streamName}' - Response: ${JSON.stringify(responseBody)}`);

        if (statusCode >= 200 && statusCode < 300) {
          results.success.push({ stream: streamName, status: statusCode, response: responseBody });
          testLogger.debug(`ingestionJoinUnion: ✓ Stream '${streamName}' ingestion SUCCEEDED`);
        } else {
          results.failed.push({ stream: streamName, status: statusCode, response: responseBody });
          testLogger.error(`ingestionJoinUnion: ✗ Stream '${streamName}' ingestion FAILED with status ${statusCode}`);
        }
      } catch (error) {
        results.failed.push({ stream: streamName, error: error.message });
        testLogger.error(`ingestionJoinUnion: ✗ Stream '${streamName}' ingestion ERROR: ${error.message}`);
      }
    }

    // Summary
    testLogger.info(`ingestionJoinUnion: Results - Success: ${results.success.length}, Failed: ${results.failed.length}`);

    if (results.failed.length > 0) {
      const failedStreams = results.failed.map(f => `${f.stream} (${f.status || f.error})`).join(", ");
      throw new Error(`ingestionJoinUnion: Failed to ingest to streams: ${failedStreams}`);
    }

    // Return stream names so test can use them for selection
    return { streamA, streamB, testRunId: runId, results };
  }
}
