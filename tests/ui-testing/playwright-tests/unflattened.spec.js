import { test, expect } from "@playwright/test";
import logData from "../../ui-testing/cypress/fixtures/log.json";
import { log } from "console";
import logsdata from "../../test-data/logs_data.json";
import UnflattenedPage from "../pages/unflattened";

test.describe.configure({ mode: "parallel" });
const streamName = `stream${Date.now()}`;

async function login(page) {
  await page.goto(process.env["ZO_BASE_URL"]);
  // await page.getByText("Login as internal user").click();
  await page.waitForTimeout(1000);
  await page
    .locator('[data-cy="login-user-id"]')
    .fill(process.env["ZO_ROOT_USER_EMAIL"]);
  //Enter Password
  await page.locator("label").filter({ hasText: "Password *" }).click();
  await page
    .locator('[data-cy="login-password"]')
    .fill(process.env["ZO_ROOT_USER_PASSWORD"]);
  await page.locator('[data-cy="login-sign-in"]').click();
}
async function toggleQuickModeIfOff(page) {
  await page.waitForSelector(
    '[data-test="logs-search-bar-quick-mode-toggle-btn"]'
  );
  const toggleButton = await page.$(
    '[data-test="logs-search-bar-quick-mode-toggle-btn"] > .q-toggle__inner'
  );
  const isSwitchedOff = await toggleButton.evaluate((node) =>
    node.classList.contains("q-toggle__inner--falsy")
  );

  if (isSwitchedOff) {
    await toggleButton.click();
  }
}

async function ingestion(page) {
  const orgId = process.env["ORGNAME"];
  const streamName = "e2e_automate";
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString("base64");

  const headers = {
    Authorization: `Basic ${basicAuthCredentials}`,
    "Content-Type": "application/json",
  };
  const response = await page.evaluate(
    async ({ url, headers, orgId, streamName, logsdata }) => {
      const fetchResponse = await fetch(
        `${url}/api/${orgId}/${streamName}/_json`,
        {
          method: "POST",
          headers: headers,
          body: JSON.stringify(logsdata),
        }
      );
      return await fetchResponse.json();
    },
    {
      url: process.env.INGESTION_URL,
      headers: headers,
      orgId: orgId,
      streamName: streamName,
      logsdata: logsdata,
    }
  );
  console.log(response);
}

const selectStreamAndStreamTypeForLogs = async (page, stream) => {
  await page.waitForTimeout(4000);
  await page
    .locator('[data-test="log-search-index-list-select-stream"]')
    .click({ force: true });
  await page
    .locator("div.q-item")
    .getByText(`${stream}`)
    .first()
    .click({ force: true });
};

test.describe("Unflattened testcases", () => {
  // let logData;
  function removeUTFCharacters(text) {
    // console.log(text, "tex");
    // Remove UTF characters using regular expression
    return text.replace(/[^\x00-\x7F]/g, " ");
  }
  async function applyQueryButton(page) {
    // click on the run query button
    // Type the value of a variable into an input field
    const search = page.waitForResponse(logData.applyQuery);
    await page.waitForTimeout(3000);
    await page.locator("[data-test='logs-search-bar-refresh-btn']").click({
      force: true,
    });
    // get the data from the search variable
    await expect.poll(async () => (await search).status()).toBe(200);
  }

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(2000);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    const allsearch = page.waitForResponse("**/api/default/_search**");
    await selectStreamAndStreamTypeForLogs(page, logData.Stream);
    await applyQueryButton(page);
  });

  test("stream to toggle store original data toggle and display o2 id", async ({
    page,
  }) => {
    const unflattenedPage = new UnflattenedPage(page);

    await unflattenedPage.streamsMenu.click();
    await unflattenedPage.searchStreamInput.click();
    await unflattenedPage.searchStreamInput.fill("e2e_automate");
    await unflattenedPage.streamDetailButton.click();
    await unflattenedPage.storeOriginalDataToggle.click();
    await unflattenedPage.schemaUpdateButton.click();
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(2000);
    await unflattenedPage.closeButton.click();
    await unflattenedPage.exploreButton.click();
    await page.waitForTimeout(1000);
    await unflattenedPage.dateTimeButton.click();
    await unflattenedPage.relativeTab.click();
    await page.waitForTimeout(2000);
    await unflattenedPage.logTableRowExpandMenu.click();
    await unflattenedPage.logSourceColumn.click();
    await page.waitForTimeout(1000);
    await unflattenedPage.o2IdText.click();
    await unflattenedPage.unflattenedTab.click();
    await page.waitForTimeout(1000);
    await unflattenedPage.closeDialog.click();
  });

  test("stream to display o2 id when quick mode is on and select * query is added", async ({
    page,
  }) => {
    const unflattenedPage = new UnflattenedPage(page); // Instantiate the Page Object

    // Navigate to Streams Menu
    await unflattenedPage.streamsMenu.click();

    // Search for Stream and access details
    await unflattenedPage.searchStreamInput.click();
    await unflattenedPage.searchStreamInput.fill("e2e_automate");
    await unflattenedPage.streamDetailButton.click();

    // Toggle 'Store Original Data' and update schema
    await unflattenedPage.storeOriginalDataToggle.click();
    await unflattenedPage.schemaUpdateButton.click();
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(2000);

    // Close the dialog and explore the stream
    await unflattenedPage.closeButton.click();
    await unflattenedPage.exploreButton.click();
    await page.waitForTimeout(2000);

    // Toggle Quick Mode if it's off
    await toggleQuickModeIfOff(page);
    await page.waitForTimeout(1000);

    // Select date and time
    await unflattenedPage.dateTimeButton.click();
    await unflattenedPage.relativeTab.click();
    await page.waitForTimeout(2000);

    // Search for 'kubernetes_pod_id' field
    await unflattenedPage.indexFieldSearchInput.fill("kubernetes_pod_id");
    await page.waitForTimeout(2000);
    await page
      .locator(
        '[data-test="log-search-index-list-interesting-kubernetes_pod_id-field-btn"]'
      )
      .first()
      .click();

    // Switch to SQL mode and validate query editor content
    await unflattenedPage.sqlModeToggle.click();
    await page.waitForTimeout(2000);
    await expect(
      unflattenedPage.logsSearchBarQueryEditor
        .getByText(/kubernetes_pod_id/)
        .first()
    ).toBeVisible();

    // Update the query editor with 'SELECT * FROM "e2e_automate"'
    await unflattenedPage.logsSearchBarQueryEditor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Delete");
    await page.keyboard.type('SELECT * FROM "e2e_automate"');
    await page.waitForTimeout(2000);

    // Interact with log table rows and verify details
    await unflattenedPage.logTableRowExpandMenu.click();
    await unflattenedPage.logSourceColumn.click();
    await page.waitForTimeout(1000);
    await unflattenedPage.o2IdText.click();
    await unflattenedPage.unflattenedTab.click();
    await page.waitForTimeout(1000);

    // Close the dialog
    await unflattenedPage.closeDialog.click();

    // Repeat the process: Navigate back to Streams Menu, search, toggle, etc.
    await unflattenedPage.streamsMenu.click();
    await unflattenedPage.searchStreamInput.click();
    await unflattenedPage.searchStreamInput.fill("e2e_automate");
    await unflattenedPage.streamDetailButton.click();
    await unflattenedPage.storeOriginalDataToggle.click();
    await unflattenedPage.schemaUpdateButton.click();
    await unflattenedPage.closeButton.click();
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(2000);
    await unflattenedPage.exploreButton.click();
    await page.waitForTimeout(3000);
    await unflattenedPage.dateTimeButton.click();
    await unflattenedPage.relativeTab.click();
    await page.waitForTimeout(2000);

    // Final log row interaction
    await unflattenedPage.logTableRowExpandMenu.click();
    await page.waitForTimeout(2000);
    await page.getByText("arrow_drop_down_timestamp:").click();
  });
});
