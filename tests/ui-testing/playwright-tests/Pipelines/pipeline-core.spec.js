import { test, expect } from "../baseFixtures.js";
import logData from "../../fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import PageManager from "../../pages/page-manager.js";
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: "parallel" });


const randomFunctionName = `Pipeline${Math.floor(Math.random() * 1000)}`;

const toggleQuickModeIfOn = async (page) => {
  const toggleButton = await page.locator(
    '[data-test="logs-search-bar-quick-mode-toggle-btn"] > .q-toggle__inner'
  );
  const isSwitchedOn = await toggleButton.evaluate((node) =>
    node.classList.contains("q-toggle__inner--truthy")
  );
  if (isSwitchedOn) {
    await toggleButton.click();
  }
}

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
    testLogger.debug('API response received', { response });
  }
}

async function exploreStreamAndNavigateToPipeline(page, streamName) {
  await page.locator('[data-test="menu-link-\\/streams-item"]').click();
  await page.waitForTimeout(1000);
  await page.locator('[data-test="log-stream-refresh-stats-btn"]').click();
  await page.waitForTimeout(2000);
  await page.getByPlaceholder('Search Stream').click();
  await page.getByPlaceholder('Search Stream').fill(streamName);
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Explore' }).first().click();

  // Wait for logs page to load and query to complete
  await page.waitForTimeout(2000);
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  // Wait for the log table to have data
  await page.waitForSelector('[data-test="log-table-column-1-_timestamp"]', { state: 'visible', timeout: 30000 });
  const expandButton = page.locator('[data-test="log-table-column-1-_timestamp"] [data-test="table-row-expand-menu"]');
  await expandButton.waitFor({ state: 'visible', timeout: 15000 });
  await expandButton.click();

  await page.locator('[data-test="menu-link-\\/pipeline-item"]').click();
}

async function exploreStreamAndInteractWithLogDetails(page, streamName) {
  await page.locator('[data-test="menu-link-\\/streams-item"]').click();
  await page.waitForTimeout(1000);
  await page.getByPlaceholder('Search Stream').click();
  await page.getByPlaceholder('Search Stream').fill(streamName);
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Explore' }).first().click();
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'Run query' }).waitFor();
  await toggleQuickModeIfOn(page);

  await page.locator("[data-test='logs-search-bar-refresh-btn']").click({
    force: true,
  });
  await page.waitForTimeout(2000);
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  await page.waitForSelector('[data-test="log-table-column-1-_timestamp"]', { state: 'visible', timeout: 30000 });
  const expandButton = page.locator('[data-test="log-table-column-1-_timestamp"] [data-test="table-row-expand-menu"]');
  await expandButton.waitFor({ state: 'visible', timeout: 15000 });
  await expandButton.click();
  const expandDetailElement = page.locator('[data-test="log-expand-detail-key-a"]');
  await expandDetailElement.waitFor({ state: 'visible' });
  await expandDetailElement.click();
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
  let pageManager;

  test.beforeEach(async ({ page }) => {
    await login(page);
    pageManager = new PageManager(page);
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
    await pageManager.logsPage.selectStream("e2e_automate");
    await applyQueryButton(page);
  });

  test.skip("should add source & destination node and then delete the pipeline", async ({ page }) => {
    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.addPipeline();
    await pageManager.pipelinesPage.selectStream();
    await pageManager.pipelinesPage.dragStreamToTarget(pageManager.pipelinesPage.streamButton);
    await pageManager.pipelinesPage.selectLogs();

    await pageManager.pipelinesPage.enterStreamName("e2e");
    await pageManager.pipelinesPage.enterStreamName("e2e_automate3");
    await page.waitForTimeout(2000);
    await page.getByRole("option", { name: "e2e_automate3", exact: true }).click();
    await pageManager.pipelinesPage.saveInputNodeStream();
    await page.waitForTimeout(3000);
    // Hover over the output stream node to show delete button, then click it
    await page.locator('[data-test="pipeline-node-output-stream-node"]').first().hover();
    await page.waitForTimeout(500);
    await page.locator('[data-test="pipeline-node-output-delete-btn"]').first().click();
    await page.locator('[data-test="confirm-button"]').click();
    // Drag and drop output stream instead of hover-click
    await pageManager.pipelinesPage.selectAndDragSecondStream();
    await page.getByLabel("Stream Name *").click();
    await page.getByLabel("Stream Name *").fill("destination-node");
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.clickInputNodeStreamSave();
    
    // Wait for dialog to close and ensure canvas is ready for interaction
    await page.waitForTimeout(2000);
    await page.waitForSelector('[data-test="pipeline-node-input-output-handle"]', { state: 'visible' });
    await page.waitForSelector('[data-test="pipeline-node-output-input-handle"]', { state: 'visible' });
    
    // Ensure no dialogs are blocking the interaction
    await page.waitForSelector('.q-dialog__backdrop', { state: 'hidden', timeout: 3000 }).catch(() => {
      // Ignore if no backdrop exists
    });

    // Connect the input node to the output node by dragging from output handle to input handle
    await page.locator('[data-test="pipeline-node-input-output-handle"]').hover({ force: true });
    await page.mouse.down();
    await page.locator('[data-test="pipeline-node-output-input-handle"]').hover({ force: true });
    await page.mouse.up();
    await page.waitForTimeout(1000);

    const pipelineName = `pipeline-${Math.random().toString(36).substring(7)}`;
    await pageManager.pipelinesPage.enterPipelineName(pipelineName);
    await pageManager.pipelinesPage.savePipeline();
    await ingestion(page);

    await exploreStreamAndNavigateToPipeline(page, 'destination_node');
    await pageManager.pipelinesPage.searchPipeline(pipelineName);
    await page.waitForTimeout(1000);
    const deletePipelineButton = page.locator(
      `[data-test="pipeline-list-${pipelineName}-delete-pipeline"]`
    );
    await deletePipelineButton.waitFor({ state: "visible" });
    await deletePipelineButton.click();
    await pageManager.pipelinesPage.confirmDeletePipeline();
    await pageManager.pipelinesPage.verifyPipelineDeleted();
  });

  test.skip("should add source, function, destination and then delete pipeline", async ({ page }) => {
    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.addPipeline();
    await pageManager.pipelinesPage.selectStream();
    await pageManager.pipelinesPage.dragStreamToTarget(pageManager.pipelinesPage.streamButton);
    await pageManager.pipelinesPage.selectLogs();
    await pageManager.pipelinesPage.enterStreamName("e2e");
    await pageManager.pipelinesPage.enterStreamName("e2e_automate1");
    await page.waitForTimeout(2000);
    await page.getByRole("option", { name: "e2e_automate1", exact: true }).click();
    await pageManager.pipelinesPage.saveInputNodeStream();
    await page.waitForTimeout(2000);
    // Hover over the output stream node to show delete button, then click it
    await page.locator('[data-test="pipeline-node-output-stream-node"]').first().hover();
    await page.waitForTimeout(500);
    await page.locator('[data-test="pipeline-node-output-delete-btn"]').first().click();
    await page.locator('[data-test="confirm-button"]').click();
    // Drag and drop function instead of hover-click
    await pageManager.pipelinesPage.selectAndDragFunction();
    await pageManager.pipelinesPage.toggleCreateFunction();
    await pageManager.pipelinesPage.enterFunctionName(randomFunctionName);
    await page.locator('[data-test="logs-vrl-function-editor"]').locator('.monaco-editor').click();
    await page.keyboard.type(".a=41", { delay: 100 });
    await page.keyboard.press("Enter");
    await page.keyboard.type(".", { delay: 100 });
    await page.getByText("Note: The function will be").click();
    await page.getByText(".a=41 .");
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.saveNewFunction();
    await page.waitForTimeout(3000);
    await pageManager.pipelinesPage.saveFunction();
    await page.waitForTimeout(3000);
    // Drag and drop output stream instead of hover-click
    await pageManager.pipelinesPage.selectAndDragSecondStream();
    await page.getByLabel("Stream Name *").click();
    await page.getByLabel("Stream Name *").fill("destination-node");
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.clickInputNodeStreamSave();
    
    // Wait for dialog to close and ensure canvas is ready for interaction
    await page.waitForTimeout(2000);
    await page.waitForSelector('[data-test="pipeline-node-input-output-handle"]', { state: 'visible' });
    await page.waitForSelector('[data-test="pipeline-node-default-input-handle"]', { state: 'visible' });
    await page.waitForSelector('[data-test="pipeline-node-output-input-handle"]', { state: 'visible' });
    
    // Ensure no dialogs are blocking the interaction
    await page.waitForSelector('.q-dialog__backdrop', { state: 'hidden', timeout: 3000 }).catch(() => {
      // Ignore if no backdrop exists
    });
    
    // Connect the input node to function to output node by creating edges
    await page.locator('[data-test="pipeline-node-input-output-handle"]').hover({ force: true });
    await page.mouse.down();
    await page.locator('[data-test="pipeline-node-default-input-handle"]').hover({ force: true });
    await page.mouse.up();
    await page.waitForTimeout(500);
    
    await page.locator('[data-test="pipeline-node-default-output-handle"]').hover({ force: true });
    await page.mouse.down();
    await page.locator('[data-test="pipeline-node-output-input-handle"]').hover({ force: true });
    await page.mouse.up();
    await page.waitForTimeout(1000);
    
    const pipelineName = `pipeline-${Math.random().toString(36).substring(7)}`;
    await pageManager.pipelinesPage.enterPipelineName(pipelineName);
    await pageManager.pipelinesPage.savePipeline();
    await ingestion(page);

    await exploreStreamAndInteractWithLogDetails(page, 'destination_node');
    await pageManager.pipelinesPage.searchPipeline(pipelineName);
    await page.waitForTimeout(1000);
    const deletePipelineButton = page.locator(
      `[data-test="pipeline-list-${pipelineName}-delete-pipeline"]`
    );
    await deletePipelineButton.waitFor({ state: "visible" });
    await deletePipelineButton.click();
    await pageManager.pipelinesPage.confirmDeletePipeline();
    await pageManager.pipelinesPage.verifyPipelineDeleted();
  });

  test.skip("should add source, condition & destination node and then delete the pipeline", async ({ page }) => {
    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.addPipeline();
    await pageManager.pipelinesPage.selectStream();
    await pageManager.pipelinesPage.dragStreamToTarget(pageManager.pipelinesPage.streamButton);
    await pageManager.pipelinesPage.selectLogs();

    await pageManager.pipelinesPage.enterStreamName("e2e");
    await pageManager.pipelinesPage.enterStreamName("e2e_automate2");
    await page.waitForTimeout(2000);
    await page.getByRole("option", { name: "e2e_automate2", exact: true }).click();
    await pageManager.pipelinesPage.saveInputNodeStream();
    await page.waitForTimeout(2000);
    // Hover over the output stream node to show delete button, then click it
    await page.locator('[data-test="pipeline-node-output-stream-node"]').first().hover();
    await page.waitForTimeout(500);
    await page.locator('[data-test="pipeline-node-output-delete-btn"]').first().click();
    await page.locator('[data-test="confirm-button"]').click();
    // Drag and drop condition instead of hover-click
    await pageManager.pipelinesPage.selectAndDragCondition();
    await page.waitForTimeout(1000);

    // FilterGroup UI: Fill column select
    await page.locator('[data-test="alert-conditions-select-column"]').locator('input').click();
    await page.locator('[data-test="alert-conditions-select-column"]').locator('input').fill("container_name");
    await page.waitForTimeout(500);
    await page.getByRole("option", { name: "kubernetes_container_name" }).click();

    // Select operator
    await page.locator('[data-test="alert-conditions-operator-select"]').click();
    await page.waitForTimeout(300);
    await page.getByText("Contains", { exact: true }).click();

    // Fill value input
    await page.locator('[data-test="alert-conditions-value-input"]').locator('input').click();
    await page.locator('[data-test="alert-conditions-value-input"]').locator('input').fill("prometheus");

    await pageManager.pipelinesPage.saveCondition();
    await page.waitForTimeout(2000);
    // Drag and drop output stream instead of hover-click
    await pageManager.pipelinesPage.selectAndDragSecondStream();
    await page.getByLabel("Stream Name *").click();
    await page.getByLabel("Stream Name *").fill("destination-node");
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.clickInputNodeStreamSave();
    
    // Wait for dialog to close and ensure canvas is ready for interaction
    await page.waitForTimeout(2000);
    await page.waitForSelector('[data-test="pipeline-node-input-output-handle"]', { state: 'visible' });
    await page.waitForSelector('[data-test="pipeline-node-default-input-handle"]', { state: 'visible' });
    await page.waitForSelector('[data-test="pipeline-node-output-input-handle"]', { state: 'visible' });
    
    // Ensure no dialogs are blocking the interaction
    await page.waitForSelector('.q-dialog__backdrop', { state: 'hidden', timeout: 3000 }).catch(() => {
      // Ignore if no backdrop exists
    });
    
    // Connect the input node to condition to output node by creating edges
    await page.locator('[data-test="pipeline-node-input-output-handle"]').hover({ force: true });
    await page.mouse.down();
    await page.locator('[data-test="pipeline-node-default-input-handle"]').hover({ force: true });
    await page.mouse.up();
    await page.waitForTimeout(500);
    
    await page.locator('[data-test="pipeline-node-default-output-handle"]').hover({ force: true });
    await page.mouse.down();
    await page.locator('[data-test="pipeline-node-output-input-handle"]').hover({ force: true });
    await page.mouse.up();
    await page.waitForTimeout(1000);
    
    const pipelineName = `pipeline-${Math.random().toString(36).substring(7)}`;
    await pageManager.pipelinesPage.enterPipelineName(pipelineName);
    await pageManager.pipelinesPage.savePipeline();
    await ingestion(page);

    await exploreStreamAndNavigateToPipeline(page, 'destination_node');
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.searchPipeline(pipelineName);
    await page.waitForTimeout(1000);
    const deletePipelineButton = page.locator(
      `[data-test="pipeline-list-${pipelineName}-delete-pipeline"]`
    );
    await deletePipelineButton.waitFor({ state: "visible" });
    await deletePipelineButton.click();
    await pageManager.pipelinesPage.confirmDeletePipeline();
    await pageManager.pipelinesPage.verifyPipelineDeleted();
  });
}); 