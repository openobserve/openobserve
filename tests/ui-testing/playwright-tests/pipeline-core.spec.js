import { test, expect } from "./baseFixtures";
import logData from "../../ui-testing/cypress/fixtures/log.json";
import logsdata from "../../test-data/logs_data.json";
import PipelinePage from "../pages/pipelinePage";
import { LogsPage } from '../pages/logsPage.js';

test.describe.configure({ mode: "parallel" });


const randomFunctionName = `Pipeline${Math.floor(Math.random() * 1000)}`;

async function login(page) {
  await page.goto(process.env["ZO_BASE_URL"]);
  if (await page.getByText('Login as internal user').isVisible()) {
    await page.getByText('Login as internal user').click();
  }
  await page.waitForTimeout(1000);
  await page
    .locator('[data-cy="login-user-id"]')
    .fill(process.env["ZO_ROOT_USER_EMAIL"]);
  await page.locator("label").filter({ hasText: "Password *" }).click();
  await page
    .locator('[data-cy="login-password"]')
    .fill(process.env["ZO_ROOT_USER_PASSWORD"]);
  await page.locator('[data-cy="login-sign-in"]').click();
}

async function ingestion(page) {
  const orgId = process.env["ORGNAME"];
  const streamNames = ["e2e_automate", "e2e_automate1", "e2e_automate2", "e2e_automate3"];
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString('base64');

  const headers = {
    "Authorization": `Basic ${basicAuthCredentials}`,
    "Content-Type": "application/json",
  };
  for (const streamName of streamNames) {
    const response = await page.evaluate(async ({ url, headers, orgId, streamName, logsdata }) => {
      const fetchResponse = await fetch(`${url}/api/${orgId}/${streamName}/_json`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(logsdata)
      });
      return await fetchResponse.json();
    }, {
      url: process.env.INGESTION_URL,
      headers: headers,
      orgId: orgId,
      streamName: streamName,
      logsdata: logsdata
    });
    console.log(response);
  }
}

async function exploreStreamAndNavigateToPipeline(page, streamName) {
  await page.locator('[data-test="menu-link-\\/streams-item"]').click();
  await page.waitForTimeout(1000);
  await page.locator('[data-test="log-stream-refresh-stats-btn"]').click();
  await page.waitForTimeout(1000);
  await page.getByPlaceholder('Search Stream').click();
  await page.getByPlaceholder('Search Stream').fill(streamName);
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Explore' }).first().click();
  await page.locator('[data-test="log-table-column-1-_timestamp"] [data-test="table-row-expand-menu"]').click();
  await page.locator('[data-test="menu-link-\\/pipeline-item"]').click();
}

async function exploreStreamAndInteractWithLogDetails(page, streamName) {
  await page.locator('[data-test="menu-link-\\/streams-item"]').click();
  await page.getByPlaceholder('Search Stream').click();
  await page.getByPlaceholder('Search Stream').fill(streamName);
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Explore' }).first().click();
  await page.locator('[data-test="log-table-column-1-_timestamp"] [data-test="table-row-expand-menu"]').click();
  await page.locator('[data-test="log-expand-detail-key-a-text"]').click();
  await page.locator('[data-test="menu-link-\\/pipeline-item"]').click();
}

async function applyQueryButton(page) {
  const search = page.waitForResponse(logData.applyQuery);
  await page.waitForTimeout(3000);
  await page.locator("[data-test='logs-search-bar-refresh-btn']").click({
    force: true,
  });
  await expect.poll(async () => (await search).status()).toBe(200);
}

test.describe("Core Pipeline Tests", () => {
  let logsPage;

  test.beforeEach(async ({ page }) => {
    await login(page);
    logsPage = new LogsPage(page);
    await page.waitForTimeout(5000);

    const orgId = process.env["ORGNAME"];
    const streamName = "e2e_automate";
    const basicAuthCredentials = Buffer.from(
      `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
    ).toString("base64");

    const headers = {
      Authorization: `Basic ${basicAuthCredentials}`,
      "Content-Type": "application/json",
    };

    await ingestion(page);
    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await logsPage.selectStreamAndStreamTypeForLogs("e2e_automate");
    await applyQueryButton(page);
  });

  test("should add source & destination node and then delete the pipeline", async ({ page }) => {
    const pipelinePage = new PipelinePage(page);

    await pipelinePage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pipelinePage.addPipeline();
    await pipelinePage.selectStream();
    await pipelinePage.dragStreamToTarget(pipelinePage.streamButton);
    await pipelinePage.selectLogs();

    await pipelinePage.enterStreamName("e2e");
    await pipelinePage.enterStreamName("e2e_automate3");
    await page.waitForTimeout(2000);
    await page.getByRole("option", { name: "e2e_automate3", exact: true }).click();
    await pipelinePage.saveInputNodeStream();
    await page.waitForTimeout(3000);
    await page.locator("button").filter({ hasText: "delete" }).nth(1).click();
    await page.locator('[data-test="confirm-button"]').click();
    await page.locator("button").filter({ hasText: "edit" }).hover();
    await page.getByRole("img", { name: "Output Stream" }).click();
    await page.getByLabel("Stream Name *").click();
    await page.getByLabel("Stream Name *").fill("destination-node");
    await page.waitForTimeout(1000);
    await pipelinePage.clickInputNodeStreamSave();
    const pipelineName = `pipeline-${Math.random().toString(36).substring(7)}`;
    await pipelinePage.enterPipelineName(pipelineName);
    await pipelinePage.savePipeline();
    await ingestion(page);

    await exploreStreamAndNavigateToPipeline(page, 'destination_node');
    await pipelinePage.searchPipeline(pipelineName);
    await page.waitForTimeout(1000);
    const deletePipelineButton = page.locator(
      `[data-test="pipeline-list-${pipelineName}-delete-pipeline"]`
    );
    await deletePipelineButton.waitFor({ state: "visible" });
    await deletePipelineButton.click();
    await pipelinePage.confirmDeletePipeline();
    await pipelinePage.verifyPipelineDeleted();
  });

  test("should add source, function, destination and then delete pipeline", async ({ page }) => {
    const pipelinePage = new PipelinePage(page);

    await pipelinePage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pipelinePage.addPipeline();
    await pipelinePage.selectStream();
    await pipelinePage.dragStreamToTarget(pipelinePage.streamButton);
    await pipelinePage.selectLogs();
    await pipelinePage.enterStreamName("e2e");
    await pipelinePage.enterStreamName("e2e_automate1");
    await page.waitForTimeout(2000);
    await page.getByRole("option", { name: "e2e_automate1", exact: true }).click();
    await pipelinePage.saveInputNodeStream();
    await page.waitForTimeout(2000);
    await page.locator("button").filter({ hasText: "delete" }).nth(1).click();
    await page.locator('[data-test="confirm-button"]').click();
    await page.locator("button").filter({ hasText: "edit" }).hover();
    await page.getByRole("img", { name: "Function", exact: true }).click();
    await pipelinePage.toggleCreateFunction();
    await pipelinePage.enterFunctionName(randomFunctionName);
    await page.locator('[data-test="logs-vrl-function-editor"]').locator(".cm-content").click();
    await page.keyboard.type(".a=41", { delay: 100 });
    await page.keyboard.press("Enter");
    await page.keyboard.type(".", { delay: 100 });
    await page.getByText("Note: The function will be").click();
    await page.getByText(".a=41 .");
    await page.waitForTimeout(1000);
    await pipelinePage.saveNewFunction();
    await page.waitForTimeout(3000);
    await pipelinePage.saveFunction();
    await page.waitForTimeout(3000);
    await page.getByRole("button", { name: randomFunctionName }).hover();
    await page.getByRole("img", { name: "Output Stream" }).click();
    await page.getByLabel("Stream Name *").click();
    await page.getByLabel("Stream Name *").fill("destination-node");
    await page.waitForTimeout(100);
    await pipelinePage.clickInputNodeStreamSave();
    const pipelineName = `pipeline-${Math.random().toString(36).substring(7)}`;
    await pipelinePage.enterPipelineName(pipelineName);
    await pipelinePage.savePipeline();
    await ingestion(page);

    await exploreStreamAndInteractWithLogDetails(page, 'destination_node');
    await pipelinePage.searchPipeline(pipelineName);
    await page.waitForTimeout(1000);
    const deletePipelineButton = page.locator(
      `[data-test="pipeline-list-${pipelineName}-delete-pipeline"]`
    );
    await deletePipelineButton.waitFor({ state: "visible" });
    await deletePipelineButton.click();
    await pipelinePage.confirmDeletePipeline();
    await pipelinePage.verifyPipelineDeleted();
  });

  test("should add source, condition & destination node and then delete the pipeline", async ({ page }) => {
    const pipelinePage = new PipelinePage(page);

    await pipelinePage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pipelinePage.addPipeline();
    await pipelinePage.selectStream();
    await pipelinePage.dragStreamToTarget(pipelinePage.streamButton);
    await pipelinePage.selectLogs();

    await pipelinePage.enterStreamName("e2e");
    await pipelinePage.enterStreamName("e2e_automate2");
    await page.waitForTimeout(2000);
    await page.getByRole("option", { name: "e2e_automate2", exact: true }).click();
    await pipelinePage.saveInputNodeStream();
    await page.waitForTimeout(2000);
    await page.locator("button").filter({ hasText: "delete" }).nth(1).click();
    await page.locator('[data-test="confirm-button"]').click();
    await page.locator("button").filter({ hasText: "edit" }).hover();
    await page.getByRole("img", { name: "Stream", exact: true }).click();
    await page.getByPlaceholder("Column").click();
    await page.getByPlaceholder("Column").fill("container_name");
    await page.getByRole("option", { name: "kubernetes_container_name" }).click();
    await page.locator(
      "div:nth-child(2) > div:nth-child(2) > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native"
    ).click();
    await page.getByText("Contains", { exact: true }).click();
    await page.getByPlaceholder("Value").click();
    await page.getByPlaceholder("Value").fill("prometheus");
    await pipelinePage.saveCondition();
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: "kubernetes_container_name" }).hover();
    await page.getByRole("img", { name: "Output Stream" }).click();
    await page.getByLabel("Stream Name *").click();
    await page.getByLabel("Stream Name *").fill("destination-node");
    await page.waitForTimeout(1000);
    await pipelinePage.clickInputNodeStreamSave();
    const pipelineName = `pipeline-${Math.random().toString(36).substring(7)}`;
    await pipelinePage.enterPipelineName(pipelineName);
    await pipelinePage.savePipeline();
    await ingestion(page);

    await exploreStreamAndNavigateToPipeline(page, 'destination_node');
    await page.waitForTimeout(1000);
    await pipelinePage.searchPipeline(pipelineName);
    await page.waitForTimeout(1000);
    const deletePipelineButton = page.locator(
      `[data-test="pipeline-list-${pipelineName}-delete-pipeline"]`
    );
    await deletePipelineButton.waitFor({ state: "visible" });
    await deletePipelineButton.click();
    await pipelinePage.confirmDeletePipeline();
    await pipelinePage.verifyPipelineDeleted();
  });
}); 