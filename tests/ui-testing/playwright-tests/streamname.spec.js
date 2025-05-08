import { test, expect } from "./baseFixtures";
import { LogsPage } from '../pages/logsPage.js';
import { StreamPage } from '../pages/streamPage.js';
import { getHeaders, getIngestionUrl, sendRequest } from '../utils/apiUtils.js';

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

test.describe("Stream multiselect testcases", () => {
  let logsPage;
  let streamPage;

  test.beforeEach(async ({ page }) => {
    await login(page);
    logsPage = new LogsPage(page);
    streamPage = new StreamPage(page);
    await page.waitForTimeout(5000);
  });

  test("should preserve stream name casing after ingestion and show in stream explorer", async ({ page }) => {
    const orgId = process.env["ORGNAME"];
    const headers = getHeaders();

    const streams = [
      { name: "MyUpperStream1" },
      { name: "mylowerstream1" },
    ];

    // Ingest data into streams
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

    // Validate streams in Stream Explorer
    for (const stream of streams) {
      await streamPage.navigateToStreamExplorer();
      await streamPage.searchStream(stream.name);
      await streamPage.exploreStream();
      await streamPage.verifyStreamExploration();
      await streamPage.goBack();
    }
  });
});
