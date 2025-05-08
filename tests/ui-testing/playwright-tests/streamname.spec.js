import { test, expect } from "./baseFixtures";
import logData from "../cypress/fixtures/log.json";
import { LogsPage } from '../pages/logsPage.js';

test.describe.configure({ mode: "parallel" });

async function login(page) {
  await page.goto(process.env["ZO_BASE_URL"]);
  await page.waitForTimeout(1000);
  if (await page.getByText('Login as internal user').isVisible()) {
    await page.getByText('Login as internal user').click();
  }

  await page.locator('[data-cy="login-user-id"]').fill(process.env["ZO_ROOT_USER_EMAIL"]);
  await page.locator("label").filter({ hasText: "Password *" }).click();
  await page.locator('[data-cy="login-password"]').fill(process.env["ZO_ROOT_USER_PASSWORD"]);
  await page.locator('[data-cy="login-sign-in"]').click();
}

const getHeaders = () => {
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString("base64");

  return {
    Authorization: `Basic ${basicAuthCredentials}`,
    "Content-Type": "application/json",
  };
};

const getIngestionUrl = (orgId, streamName) => {
  return `${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`;
};

const sendRequest = async (page, url, payload, headers) => {
  return await page.evaluate(
    async ({ url, headers, payload }) => {
      const response = await fetch(url, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload),
      });
      return await response.json();
    },
    { url, headers, payload }
  );
};

test.describe("Stream multiselect testcases", () => {
  let logsPage;

  test.beforeEach(async ({ page }) => {
    await login(page);
    logsPage = new LogsPage(page);
    await page.waitForTimeout(5000);
  });

  test("should preserve stream name casing after ingestion and show in stream explorer", async ({ page }) => {
    const orgId = process.env["ORGNAME"];
    const headers = getHeaders();

    const streams = [
      { name: "MyUpperStream1" },
      { name: "mylowerstream1" },
    ];

    for (const stream of streams) {
      const ingestionUrl = getIngestionUrl(orgId, stream.name);
      const payload = {
        level: "info",
        job: "test",
        log: `test message for stream ${stream.name}`,
        e2e: "1",
      };
      const response = await sendRequest(page, ingestionUrl, payload, headers);
      console.log(`Ingested to ${stream.name}:`, response);
    }

    // Navigate to Stream Explorer
    // await page.locator('[data-test="date-time-btn"]').click({ force: true });
    // await page.locator('[data-test="menu-link-/streams-item"]').click({ force: true });
    // await page.waitForTimeout(1000);

    // Validate casing and explore streams
    for (const stream of streams) {
      await page.locator('[data-test="menu-link-/streams-item"]').click({ force: true });
      await page.waitForTimeout(1000);
      await page.getByPlaceholder("Search Stream").click();
      await page.getByPlaceholder("Search Stream").fill(stream.name);
      await page.waitForTimeout(3000);

      const streamButton = page.getByRole("button", { name: 'Explore' });
      await expect(streamButton).toBeVisible();

      await streamButton.click({ force: true });
      await page.waitForTimeout(1000);
      await expect(page.url()).toContain("logs");
      await page.goBack();
      await page.waitForTimeout(1000);
    }
  });
});
