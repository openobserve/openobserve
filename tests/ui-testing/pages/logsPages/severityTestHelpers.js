import severityColorData from "../../../test-data/severity_color_data.json";
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class SeverityTestHelpers {
  constructor(page) {
    this.page = page;
  }

  async severityColorIngestionToStream(streamName) {
    const orgId = process.env["ORGNAME"];
    const basicAuthCredentials = Buffer.from(
      `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
    ).toString('base64');

    const headers = {
      "Authorization": `Basic ${basicAuthCredentials}`,
      "Content-Type": "application/json",
    };

    try {
      const response = await this.page.evaluate(async ({ url, headers, orgId, streamName, severityColorData }) => {
        const fetchResponse = await fetch(`${url}/api/${orgId}/${streamName}/_json`, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(severityColorData)
        });
        if (!fetchResponse.ok) {
          throw new Error(`HTTP error! status: ${fetchResponse.status}`);
        }
        return await fetchResponse.json();
      }, {
        url: process.env.INGESTION_URL,
        headers: headers,
        orgId: orgId,
        streamName: streamName,
        severityColorData: severityColorData
      });
      return response;
    } catch (error) {
      testLogger.error('Severity color ingestion failed:', { error: error.message });
      throw error;
    }
  }

  async deleteStream(streamName) {
    const orgId = process.env["ORGNAME"];
    const basicAuthCredentials = Buffer.from(
      `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
    ).toString('base64');

    const headers = {
      "Authorization": `Basic ${basicAuthCredentials}`,
    };

    try {
      const response = await this.page.evaluate(async ({ url, headers, orgId, streamName }) => {
        const fetchResponse = await fetch(`${url}/api/${orgId}/streams/${streamName}`, {
          method: 'DELETE',
          headers: headers
        });
        if (!fetchResponse.ok && fetchResponse.status !== 404) {
          throw new Error(`HTTP error! status: ${fetchResponse.status}`);
        }
        return { status: fetchResponse.status };
      }, {
        url: process.env.INGESTION_URL,
        headers: headers,
        orgId: orgId,
        streamName: streamName
      });
      return response;
    } catch (error) {
      testLogger.error('Stream deletion failed:', { error: error.message });
      throw error;
    }
  }
}
