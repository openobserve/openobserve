import { test, expect } from "@playwright/test";
import logData from "../cypress/fixtures/log.json";
import logsdata from "../../test-data/logs_data.json";

test.describe.configure({ mode: "parallel" });

async function login(page) {
  await page.goto(process.env["ZO_BASE_URL"]);
  await page.waitForTimeout(1000);
    await page.getByText('Login as internal user').click();
  await page
    .locator('[data-cy="login-user-id"]')
    .fill(process.env["ZO_ROOT_USER_EMAIL"]);
  //Enter Password
  await page
    .locator('[data-cy="login-password"]')
    .fill(process.env["ZO_ROOT_USER_PASSWORD"]);
  await page.locator('[data-cy="login-sign-in"]').click();
  await page.waitForTimeout(4000);
  await page.goto(process.env["ZO_BASE_URL"]);
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
test.describe(" visualize UI testcases", () => {
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
    // await search.hits.FIXME_should("be.an", "array");
  }
  // tebefore(async function () {
  //   // logData("log");
  //   // const data = page;
  //   // logData = data;

  //   console.log("--logData--", logData);
  // });
  test.beforeEach(async ({ page }) => {
    console.log("running before each");

    await login(page);
    await page.waitForTimeout(5000);

    // ("ingests logs via API", () => {
    const orgId = process.env["ORGNAME"];
    const streamName = "e2e_automate";
    const basicAuthCredentials = Buffer.from(
      `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
    ).toString("base64");

    const headers = {
      Authorization: `Basic ${basicAuthCredentials}`,
      "Content-Type": "application/json",
    };

    // const logsdata = {}; // Fill this with your actual data

    // Making a POST request using fetch API
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
    //  });
    // const allorgs = page.waitForResponse("**/api/default/organizations**");
    // const functions = page.waitForResponse("**/api/default/functions**");
    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    const allsearch = page.waitForResponse("**/api/default/_search**");
    await selectStreamAndStreamTypeForLogs(page, logData.Stream);
    await applyQueryButton(page);
    // const streams = page.waitForResponse("**/api/default/streams**");
  });


  test('should allow adding a VRL function in the visualization chart ', async ({ page }) => {
    await page1.getByLabel('Expand "kubernetes_annotations_kubernetes_io_psp"').click();
    await page1.locator('[data-test="logs-search-subfield-add-kubernetes_annotations_kubernetes_io_psp-eks\\.privileged"] [data-test="log-search-subfield-list-equal-kubernetes_annotations_kubernetes_io_psp-field-btn"]').click();
    await page1.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page1.locator('[data-test="logs-visualize-toggle"]').click();
    await page1.locator('#fnEditor > .monaco-editor > .overflow-guard > div:nth-child(2) > .lines-content > .view-lines > .view-line').click();
    await page1.locator('#fnEditor').getByLabel('Editor content;Press Alt+F1').fill('.vrl12=123');
    await page1.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await expect(page1.getByText('drag_indicatortext_fields vrl12')).toBeVisible();
    await page1.locator('[data-test="field-list-item-logs-e2e_automate-vrl12"] [data-test="dashboard-add-b-data"]').click();
    await page1.locator('[data-test="logs-search-bar-refresh-btn"]').click();
  });


})