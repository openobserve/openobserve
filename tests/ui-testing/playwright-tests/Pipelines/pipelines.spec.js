import { test, expect } from "../baseFixtures.js";
import logData from "../../fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import PageManager from "../../pages/page-manager.js";
import { LoginPage } from "../../pages/generalPages/loginPage.js";
const testLogger = require('../utils/test-logger.js');


test.describe.configure({ mode: "parallel" });

const randomPipelineName = `Pipeline${Math.floor(Math.random() * 1000)}`;
const randomFunctionName = `Pipeline${Math.floor(Math.random() * 1000)}`;
test.describe("Pipeline testcases", { tag: ['@all', '@pipelines'] }, () => {
  let pageManager;
  let loginPage;

  function removeUTFCharacters(text) {
    // Remove UTF characters using regular expression
    return text.replace(/[^\x00-\x7F]/g, " ");
  }

  test.beforeEach(async ({ page }) => {
    // Login using LoginPage
    loginPage = new LoginPage(page);
    await loginPage.gotoLoginPage();
    await loginPage.loginAsInternalUser();
    await loginPage.login();

    pageManager = new PageManager(page);

    // Ingest data using page object method
    const streamNames = ["e2e_automate", "e2e_automate1", "e2e_automate2", "e2e_automate3"];
    await pageManager.pipelinesPage.bulkIngestToStreams(streamNames, logsdata);

    // Navigate to logs page and select stream
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await pageManager.logsPage.selectStream("e2e_automate");
    await pageManager.logsPage.applyQuery();
  });

  test("should display error when stream not selected while adding source", async ({
    page,
  }) => {
    const pipelinePage = pageManager.pipelinesPage;

    await pipelinePage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pipelinePage.addPipeline();
    await pipelinePage.selectStream();
    await pipelinePage.dragStreamToTarget(pipelinePage.streamButton);
    await pipelinePage.selectLogs();
    await pipelinePage.saveStream();
    await pipelinePage.confirmStreamError();
  });

  test("should display error when user directly clicks on save without adding details", async ({
    page,
  }) => {
    const pipelinePage = pageManager.pipelinesPage;
    await pipelinePage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pipelinePage.addPipeline();
    await pipelinePage.savePipeline();
    await pipelinePage.confirmPipelineNameRequired();
  });

  test("should display error on entering only pipeline name and save", async ({
    page,
  }) => {
    const pipelinePage = pageManager.pipelinesPage;
    await pipelinePage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pipelinePage.addPipeline();
    const pipelineName = `pipeline-${Math.random().toString(36).substring(7)}`;
    await pipelinePage.enterPipelineName(pipelineName);
    await pipelinePage.savePipeline();
    await pipelinePage.confirmSourceNodeRequired();
  });

  test("should display error on entering only source node and save", async ({
    page,
  }) => {
    const pipelinePage = pageManager.pipelinesPage;

    await pipelinePage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pipelinePage.addPipeline();
    await pipelinePage.selectStream();
    await pipelinePage.dragStreamToTarget(pipelinePage.streamButton);
    await pipelinePage.selectLogs();

    // Interact with stream name and save
    await pipelinePage.enterStreamName("e2e");
    await pipelinePage.enterStreamName("e2e_automate");
    await page.waitForTimeout(1000);
    await pipelinePage.selectStreamOption();
    await pipelinePage.saveInputNodeStream();
    // Delete the output stream node using page object method
    await pipelinePage.deleteOutputStreamNode();

    // Generate a random pipeline name and save
    const pipelineName = `pipeline-${Math.random().toString(36).substring(7)}`;
    await pipelinePage.enterPipelineName(pipelineName);
    await pipelinePage.savePipeline();

    // Confirm the destination node required error message
    await pipelinePage.confirmDestinationNodeRequired();
  });

  test("should delete the create source node on confirmation", async ({
    page,
  }) => {
    const pipelinePage = pageManager.pipelinesPage;

    await pipelinePage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pipelinePage.addPipeline();
    await pipelinePage.selectStream();
    await pipelinePage.streamButton.waitFor({ state: "visible" });
    await pipelinePage.dragStreamToTarget(pipelinePage.streamButton);
    await pipelinePage.selectLogs();

    // Interact with stream name and save
    await page.waitForTimeout(2000);
    await pipelinePage.enterStreamName("e2e");
    await pipelinePage.enterStreamName("e2e_automate");
    await page.waitForTimeout(2000);
    await pipelinePage.selectStreamOption();
    await pipelinePage.saveInputNodeStream();
    // Delete the output stream node using page object method
    await pipelinePage.deleteOutputStreamNode();

    // Verify the node was deleted (assertion for this test)
    const nodeDeleted = await pipelinePage.verifyOutputStreamNodeDeleted();
    expect(nodeDeleted).toBe(true);
  });

  test.skip("should add source & destination node and then delete the pipeline", async ({
    page,
  }) => {
    const pipelinePage = pageManager.pipelinesPage;

    await pipelinePage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pipelinePage.addPipeline();
    await pipelinePage.selectStream();
    await pipelinePage.dragStreamToTarget(pipelinePage.streamButton);
    await pipelinePage.selectLogs();

    // Interact with stream name and save
    await pipelinePage.enterStreamName("e2e");
    await pipelinePage.enterStreamName("e2e_automate3");
    await page.waitForTimeout(2000);
    await page.getByRole("option", { name: "e2e_automate3" , exact: true}).click();
    await pipelinePage.saveInputNodeStream();
    await page.waitForTimeout(3000);
    await page.locator("button").filter({ hasText: "delete" }).nth(1).click();
    await page.locator('[data-test="confirm-button"]').click();
    await page.locator("button").filter({ hasText: "edit" }).hover();
    await page.getByRole("img", { name: "Output Stream" }).click();
    // await pipelinePage.toggleCreateStream();
    await page.getByLabel("Stream Name *").click();
    await page.getByLabel("Stream Name *").fill("destination-node");
    await page.waitForTimeout(1000);
    
    // await page
    //   .locator(
    //     ".q-form > div:nth-child(2) > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native"
    //   )
    //   .click();
    // await page
    //   .getByRole("option", { name: "Logs" })
    //   .locator("div")
    //   .nth(2)
    //   .click();
    // await pipelinePage.clickSaveStream();

    await pipelinePage.clickInputNodeStreamSave();
    const pipelineName = `pipeline-${Math.random().toString(36).substring(7)}`;
    await pipelinePage.enterPipelineName(pipelineName);
    await pipelinePage.savePipeline();
    await ingestion(page);


    // Verify the data ingested in destination and verify under logs page
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

  test("should create query source and delete it", async ({ page }) => {
    const pipelinePage = pageManager.pipelinesPage;

    // Open the pipeline menu and wait for a moment
    await pipelinePage.openPipelineMenu();
    await page.waitForTimeout(1000);

    // Add a new pipeline
    await pipelinePage.addPipeline();

    // Drag and drop the stream to target
    await pipelinePage.dragStreamToTarget(pipelinePage.queryButton);

    // Select logs from the list
    await page
      .locator('div').filter({ hasText: /^Stream Type \*$/ }).first().click();
    await page.getByLabel('Stream Type *').click();
    await page.waitForTimeout(1000);
    await page.locator('[data-test="scheduled-pipeline-sql-editor"] .view-lines').click();
    // Click on the editor to type the query
    // await page.locator(".cm-lines").first().click();
    const sqlQuery = 'select * from "default"';

    // Locate the editor and type the SQL query if it's not already typed
    await page.click('[data-test="scheduled-pipeline-sql-editor"]');
    await page.keyboard.type(sqlQuery);

    // Wait for a moment to ensure the query is properly typed
    await page.waitForTimeout(1000);

    // Check if the query exists in the editor (using `hasText` to ensure it's typed)
    const queryTyped = await page
      .locator(".view-lines")
      .locator(".view-line")
      .filter({ hasText: sqlQuery })
      .count();

    // If the query is found, click the frequency unit
    if (queryTyped > 0) {
      await page
        .locator('[data-test="scheduled-pipeline-frequency-unit"]')
        .click(); // Click frequency unit
    }
    await pipelinePage.saveQuery();

    // Wait for the modal to close by waiting for the query section to be hidden
    await page.locator('[data-test="add-stream-query-routing-section "]').waitFor({ state: 'hidden', timeout: 60000 });

    // Wait for the query node to be visible before interacting
    await page.locator('[data-test="pipeline-node-input-query-node"]').first().waitFor({ state: 'visible', timeout: 30000 });

    // Delete the query node first
    await page.locator('[data-test="pipeline-node-input-query-node"]').first().hover();
    await page.waitForTimeout(500);
    await page.locator('[data-test="pipeline-node-input-delete-btn"]').first().click();
    await page.locator('[data-test="confirm-button"]').click();
    
    // Navigate back from pipeline editing and confirm
    await page.locator('[data-test="add-pipeline-cancel-btn"]').click();
  });

  test.skip("should add source, function,destination and then delete pipeline", async ({
    page,
  }) => {
    const pipelinePage = pageManager.pipelinesPage;

    await pipelinePage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pipelinePage.addPipeline();
    await pipelinePage.selectStream();
    await pipelinePage.dragStreamToTarget(pipelinePage.streamButton);
    await pipelinePage.selectLogs();
    await pipelinePage.enterStreamName("e2e");
    await pipelinePage.enterStreamName("e2e_automate1");
    await page.waitForTimeout(2000);
    await page.getByRole("option", { name: "e2e_automate1" , exact: true}).click();
    await pipelinePage.saveInputNodeStream();
    // await pipelinePage.selectAndDragFunction(); // Function drag
    await page.waitForTimeout(2000);
    await page.locator("button").filter({ hasText: "delete" }).nth(1).click();
    await page.locator('[data-test="confirm-button"]').click();
    await page.locator("button").filter({ hasText: "edit" }).hover();
    await page.getByRole("img", { name: "Function", exact: true }).click();
    await pipelinePage.toggleCreateFunction();
    await pipelinePage.enterFunctionName(randomFunctionName);
    await page.locator('[data-test="logs-vrl-function-editor"] .view-lines').click();    // Type the function text with a delay to ensure each character registers
    await page.keyboard.type(".a=41", { delay: 100 });
    await page.keyboard.press("Enter");
    await page.keyboard.type(".", { delay: 100 });
    await page.getByText("Note: The function will be").click();

    // Check if the required text is present in the editor
    await page.getByText(".a=41 .");

    // Optional: Add a short wait to confirm the action is processed
    await page.waitForTimeout(1000);

    // Optional: Add a brief wait to allow any validation messages to process
    await pipelinePage.saveNewFunction();
    await page.waitForTimeout(3000);
    await pipelinePage.saveFunction();
    await page.waitForTimeout(3000);
    await page.getByText(randomFunctionName).hover();
    await page.getByRole("img", { name: "Output Stream" }).click();
    // await pipelinePage.toggleCreateStream();
    // await page.getByLabel("Name *").click();
    // await page.getByLabel("Name *").fill("destination-node");
    // await page
    //   .locator(
    //     ".q-form > div:nth-child(2) > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native"
    //   )
    //   .click();
    // await page
    //   .getByRole("option", { name: "Logs" })
    //   .locator("div")
    //   .nth(2)
    //   .click();
    // await pipelinePage.clickSaveStream();
    await page.getByLabel("Stream Name *").click();
    await page.getByLabel("Stream Name *").fill("destination-node");
    await page.waitForTimeout(1000);
    await pipelinePage.clickInputNodeStreamSave();
    const pipelineName = `pipeline-${Math.random().toString(36).substring(7)}`;
    await pipelinePage.enterPipelineName(pipelineName);
    await pipelinePage.savePipeline();
    await ingestion(page);
    // Verify the data ingested in destination & function and verify under logs page 
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

  test("should display error when function name is not added", async ({
    page,
  }) => {
    const pipelinePage = pageManager.pipelinesPage;

    await pipelinePage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pipelinePage.addPipeline();
    await pipelinePage.selectAndDragFunction(); // Function drag
    await page.waitForTimeout(2000);
    await pipelinePage.toggleCreateFunction();
    await page.waitForTimeout(1000);
    await pipelinePage.saveNewFunction();
    await pipelinePage.assertFunctionNameRequiredErrorVisible();
  });

  test("should create function when name added but function is not added", async ({
    page,
  }) => {
    const pipelinePage = pageManager.pipelinesPage;

    await pipelinePage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pipelinePage.addPipeline();
    await pipelinePage.selectAndDragFunction(); // Function drag
    await page.waitForTimeout(2000);
    await pipelinePage.toggleCreateFunction();
    await page.waitForTimeout(1000);
    await pipelinePage.enterFunctionName(randomFunctionName);
    await pipelinePage.saveNewFunction();
    await pipelinePage.assertFunctionNameRequiredErrorNotToBeVisible();
  });

  test.skip("should display error if query added without sql", async ({
    page,
  }) => {
    const pipelinePage = pageManager.pipelinesPage;

    // Open the pipeline menu and wait for a moment
    await pipelinePage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pipelinePage.addPipeline();
    await pipelinePage.dragStreamToTarget(pipelinePage.queryButton);
    await page
      .locator("div")
      .filter({ hasText: /^logs$/ })
      .click();
    await page.getByRole("option", { name: "logs" }).click();
    await pipelinePage.saveQuery();
    await page.waitForTimeout(2000);
    // TODO: Change the locator to the correct one, once fixed
    await page.getByText("Invalid SQL Query").click();
  });

  test("should display error when save clicked directly while adding destination", async ({
    page,
  }) => {
    const pipelinePage = pageManager.pipelinesPage;

    await pipelinePage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pipelinePage.addPipeline();
    await pipelinePage.selectAndDragSecondStream();
    await page.waitForTimeout(2000);
    await pipelinePage.saveStream();
    await pipelinePage.assertStreamSelectionErrorVisible();
  });

  test.skip("should add source, condition & destination node and then delete the pipeline", async ({
    page,
  }) => {
    const pipelinePage = pageManager.pipelinesPage;

    await pipelinePage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pipelinePage.addPipeline();
    await pipelinePage.selectStream();
    await pipelinePage.dragStreamToTarget(pipelinePage.streamButton);
    await pipelinePage.selectLogs();

    // Interact with stream name and save
    await pipelinePage.enterStreamName("e2e");
    await pipelinePage.enterStreamName("e2e_automate2");
    await page.waitForTimeout(2000);
    await page.getByRole("option", { name: "e2e_automate2" , exact: true}).click();
    await pipelinePage.saveInputNodeStream();
    await page.waitForTimeout(2000);
    await page.locator("button").filter({ hasText: "delete" }).nth(1).click();
    await page.locator('[data-test="confirm-button"]').click();
    await page.locator("button").filter({ hasText: "edit" }).hover();
    await page.getByRole("img", { name: "Stream", exact: true }).click();
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

    await pipelinePage.saveCondition();
    await page.waitForTimeout(2000);
    await page.getByText("kubernetes_container_name").hover();
    await page.getByRole("img", { name: "Output Stream" }).click();
    // await pipelinePage.toggleCreateStream();
    // await page.getByLabel("Name *").click();
    // await page.getByLabel("Name *").fill("destination-node");
    // await page
    //   .locator(
    //     ".q-form > div:nth-child(2) > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native"
    //   )
    //   .click();
    // await page
    //   .getByRole("option", { name: "Logs" })
    //   .locator("div")
    //   .nth(2)
    //   .click();
    // await pipelinePage.clickSaveStream();
    await page.getByLabel("Stream Name *").click();
    await page.getByLabel("Stream Name *").fill("destination-node");
    await page.waitForTimeout(1000);
    await pipelinePage.clickInputNodeStreamSave();
    const pipelineName = `pipeline-${Math.random().toString(36).substring(7)}`;
    await pipelinePage.enterPipelineName(pipelineName);
    await pipelinePage.savePipeline();
    await ingestion(page);
    // Verify the data ingested in destination and verify under logs page
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

  test("should display error when function is not selected under select function", async ({
    page,
  }) => {
    const pipelinePage = pageManager.pipelinesPage;
    await pipelinePage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pipelinePage.addPipeline();
    await pipelinePage.selectAndDragFunction(); // Function drag
    await page.waitForTimeout(2000);
    await page.waitForTimeout(1000);
    await pipelinePage.saveFunction();
    await pipelinePage.verifyFieldRequiredError();
  });

  test("should display error when condition is not added but user clicks save", async ({
    page,
  }) => {
    const pipelinePage = pageManager.pipelinesPage;
    await pipelinePage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pipelinePage.addPipeline();
    await pipelinePage.selectAndDragCondition(); // Function drag;
    await page.waitForTimeout(1000);
    await pipelinePage.saveCondition();
    await pipelinePage.verifyFieldRequiredError();
  });

  test("should add source & destination node without connection and error to be displayed", async ({
    page,
  }) => {
    const pipelinePage = pageManager.pipelinesPage;

    await pipelinePage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pipelinePage.addPipeline();
    await pipelinePage.selectStream();
    await pipelinePage.dragStreamToTarget(pipelinePage.streamButton);
    await pipelinePage.selectLogs();

    // Interact with stream name and save
    await pipelinePage.enterStreamName("e2e");
    await pipelinePage.enterStreamName("e2e_automate");
    await page.waitForTimeout(2000);
    await pipelinePage.selectStreamOption();
    await pipelinePage.saveInputNodeStream();
    await page.waitForTimeout(1000);
    // Delete the output stream node using page object method
    await pipelinePage.deleteOutputStreamNode();
    await pipelinePage.dragStreamToTarget(pipelinePage.streamButton); // First stream drag

    // Select the second stream, drag, and drop
    await pipelinePage.selectAndDragSecondStream();
    await page.waitForTimeout(2000);
    // await pipelinePage.toggleCreateStream();
    // await page.getByLabel("Name *").click();
    // await page.getByLabel("Name *").fill("destination-node");
    // await page
    //   .locator(
    //     ".q-form > div:nth-child(2) > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native"
    //   )
    //   .click();
    // await page
    //   .getByRole("option", { name: "Logs" })
    //   .locator("div")
    //   .nth(2)
    //   .click();
    // await pipelinePage.clickSaveStream();
    await page.getByLabel("Stream Name *").click();
    await page.getByLabel("Stream Name *").fill("destination-node");
    await page.waitForTimeout(1000);
    await pipelinePage.clickInputNodeStreamSave();
    
    // Wait for dialog to close and add edge connections if needed
    await page.waitForTimeout(2000);
    await page.waitForSelector('[data-test="pipeline-node-input-output-handle"]', { state: 'visible' }).catch(() => {
        // Handle case where handles don't exist for this test scenario
    });
    await page.waitForSelector('[data-test="pipeline-node-output-input-handle"]', { state: 'visible' }).catch(() => {
        // Handle case where handles don't exist for this test scenario
    });
    
    // Ensure no dialogs are blocking the interaction
    await page.waitForSelector('.q-dialog__backdrop', { state: 'hidden', timeout: 3000 }).catch(() => {
        // Ignore if no backdrop exists
    });
    
    const pipelineName = `pipeline-${Math.random().toString(36).substring(7)}`;
    await pipelinePage.enterPipelineName(pipelineName);
    await pipelinePage.savePipeline();
    await page.getByText("Please connect all nodes").click();
  });


  test("should navigate to dashboard page if user accepts dialog box", async ({
    page,
  }) => {
    const pipelinePage = pageManager.pipelinesPage;

    await pipelinePage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pipelinePage.addPipeline();
    await pipelinePage.selectStream();
    await pipelinePage.streamButton.waitFor({ state: "visible" });
    await pipelinePage.dragStreamToTarget(pipelinePage.streamButton);
    await pipelinePage.selectLogs();

    // Interact with stream name and save
    await page.waitForTimeout(2000);
    await pipelinePage.enterStreamName("e2e");
    await pipelinePage.enterStreamName("e2e_automate");
    await page.waitForTimeout(2000);
    await pipelinePage.selectStreamOption();
    await pipelinePage.saveInputNodeStream();
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    page.once('dialog', async (dialog) => {
      testLogger.debug('Dialog message', { message: dialog.message() });
      await dialog.accept();
    });
    
    // Click on the first menu link
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    
    // Assert the page navigates to the desired URL containing "dashboards"
    await page.waitForURL(/dashboards/);
    
  });

  test("should stay on pipeline page if user dismisses the dialog box", async ({
    page,
  }) => {
    const pipelinePage = pageManager.pipelinesPage;

    await pipelinePage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pipelinePage.addPipeline();
    await pipelinePage.selectStream();
    await pipelinePage.streamButton.waitFor({ state: "visible" });
    await pipelinePage.dragStreamToTarget(pipelinePage.streamButton);
    await pipelinePage.selectLogs();

    // Interact with stream name and save
    await page.waitForTimeout(2000);
    await pipelinePage.enterStreamName("e2e");
    await pipelinePage.enterStreamName("e2e_automate");
    await page.waitForTimeout(2000);
    await pipelinePage.selectStreamOption();
    await pipelinePage.saveInputNodeStream();
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    page.once('dialog', async (dialog) => {
      testLogger.debug('Dialog message', { message: dialog.message() });
      await dialog.dismiss();
    });
    
    // Click on the first menu link
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    
    
    // Assert page url to have pipeline
    await expect(page).toHaveURL(/pipeline/);

    // Log confirmation
    testLogger.debug('URL contains pipeline')
    
  });

  
});
