import { test, expect } from "@playwright/test";
import logData from "../../ui-testing/cypress/fixtures/log.json";
import { log } from "console";
import logsdata from "../../test-data/logs_data.json";

test.describe.configure({ mode: 'parallel' });

const randomPipelineName = `Pipeline${Math.floor(Math.random() * 1000)}`;
const randomFunctionName = `Pipeline${Math.floor(Math.random() * 1000)}`;

async function login(page) {
      await page.goto(process.env["ZO_BASE_URL"]);
    //   await page.getByText('Login as internal user').click();
      await page.waitForTimeout(1000);
      await page
        .locator('[data-cy="login-user-id"]')
        .fill(process.env["ZO_ROOT_USER_EMAIL"]);
      //Enter Password
      await page.locator('label').filter({ hasText: 'Password *' }).click();
      await page
        .locator('[data-cy="login-password"]')
        .fill(process.env["ZO_ROOT_USER_PASSWORD"]);
      await page.locator('[data-cy="login-sign-in"]').click();
  //     await page.waitForTimeout(4000);
  // await page.goto(process.env["ZO_BASE_URL"]);
}


const selectStreamAndStreamTypeForLogs = async (page,stream) => {await page.waitForTimeout(
  4000);await page.locator(
  '[data-test="log-search-index-list-select-stream"]').click({ force: true });await page.locator(
  "div.q-item").getByText(`${stream}`).first().click({ force: true });
};
test.describe("Pipeline testcases", () => {
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
    await login(page);
    await page.waitForTimeout(5000)

    // ("ingests logs via API", () => {
      const orgId = process.env["ORGNAME"];
      const streamName = "e2e_automate";
      const basicAuthCredentials = Buffer.from(
        `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
      ).toString('base64');
    
      const headers = {
        "Authorization": `Basic ${basicAuthCredentials}`,
        "Content-Type": "application/json",
      };
    
      // const logsdata = {}; // Fill this with your actual data
    
      // Making a POST request using fetch API
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
    //  });
    // const allorgs = page.waitForResponse("**/api/default/organizations**");
    // const functions = page.waitForResponse("**/api/default/functions**");
    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    const allsearch = page.waitForResponse("**/api/default/_search**");
    await selectStreamAndStreamTypeForLogs(page,logData.Stream);
    await applyQueryButton(page);
    // const streams = page.waitForResponse("**/api/default/streams**");
  });
  
  test('display error if mandatory fields not added on pipeline creation UI ', async ({ page }) => {
    await page.locator('[data-test="menu-link-\\/pipeline-item"]').click();
    await page.getByRole('main').locator('div').filter({ hasText: 'Enrichment TablesFunctionsStream AssociationStream' }).first().click();
    await page.locator('[data-test="stream-pipelines-tab"]').click();
    await page.locator('[data-test="pipeline-list-add-pipeline-btn"]').click();
    await page.locator('[data-test="add-pipeline-name-input"]').getByLabel('Name *').click();
    await page.locator('[data-test="add-pipeline-name-input"]').getByLabel('Name *').fill('e2epipeline');
    await page.locator('[data-test="add-pipeline-submit-btn"]').click();
    await page.getByText('Field is required!').click();
  });

  test('should close Add pipeline UI on clicking close icon', async ({ page }) => {
    await page.locator('[data-test="menu-link-\\/pipeline-item"]').click();
    await page.getByRole('main').locator('div').filter({ hasText: 'Enrichment TablesFunctionsStream AssociationStream' }).first().click();
    await page.locator('[data-test="stream-pipelines-tab"]').click();
    await page.locator('[data-test="pipeline-list-add-pipeline-btn"]').click();
    await page.locator('[data-test="add-pipeline-name-input"]').getByLabel('Name *').click();
    await page.locator('[data-test="add-pipeline-name-input"]').getByLabel('Name *').fill('e2epipeline');
    await page.locator('[data-test="add-pipeline-submit-btn"]').click();
    await page.getByText('Field is required!').click();
    await page.locator('[data-test="add-pipeline-close-dialog-btn"]').click();
    
    // const isElementVisible = await page.locator('[data-test="add-pipeline-name-input"] label').isVisible();
    // expect(isElementVisible).toBe(false); 
  });

  test('should add and delete pipeline', async ({ page }) => {
    await page.locator('[data-test="menu-link-\\/pipeline-item"]').click();
    await page.getByRole('main').locator('div').filter({ hasText: 'Enrichment TablesFunctionsStream AssociationStream' }).first().click();
    await page.locator('[data-test="stream-pipelines-tab"]').click();
    await page.locator('[data-test="pipeline-list-add-pipeline-btn"]').click();
    await page.locator('[data-test="add-pipeline-name-input"]').getByLabel('Name *').click();
    await page.locator('[data-test="add-pipeline-name-input"]').getByLabel('Name *').fill(randomPipelineName);
    await page.waitForSelector('.alert-stream-type > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native');
    await page.locator('.alert-stream-type > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native').click();
    await page.waitForTimeout(2000);
    await page.getByRole('option', { name: 'Logs' }).locator('div').nth(2).click({force:true});
    await page.waitForTimeout(2000);
    // await page.waitForSelector('[data-test="Stream Name *"]')
    await page.getByLabel('Stream Name *').click();
    // await page.waitForSelector(':text("e2e_automate")')
    await page.getByRole('option', { name: 'e2e_automate' }).locator('div').nth(2).click();
    await page.locator('[data-test="add-pipeline-submit-btn"]').click();
    await page.waitForTimeout(2000)
    await page.locator(`[data-test="pipeline-list-${randomPipelineName}-delete-pipeline"]`).click();
    await page.locator('[data-test="confirm-button"]').click();
  });

  test('should add function to pipeline', async ({ page }) => {
    await page.locator('[data-test="menu-link-\\/pipeline-item"]').click();
    await page.getByRole('main').locator('div').filter({ hasText: 'Enrichment TablesFunctionsStream AssociationStream' }).first().click();
    await page.locator('[data-test="stream-pipelines-tab"]').click();
    await page.locator('[data-test="pipeline-list-add-pipeline-btn"]').click();
    await page.locator('[data-test="add-pipeline-name-input"]').getByLabel('Name *').click();
    await page.locator('[data-test="add-pipeline-name-input"]').getByLabel('Name *').fill(randomPipelineName);
    await page.waitForSelector('.alert-stream-type > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native');
    await page.locator('.alert-stream-type > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native').click();
    await page.waitForTimeout(2000);
    await page.getByRole('option', { name: 'Logs' }).locator('div').nth(2).click({force:true});
    await page.waitForTimeout(2000);
    // await page.waitForSelector('[data-test="Stream Name *"]')
    await page.getByLabel('Stream Name *').click();
    // await page.waitForSelector(':text("e2e_automate")')
    await page.getByRole('option', { name: 'e2e_automate' }).locator('div').nth(2).click();
    await page.locator('[data-test="add-pipeline-submit-btn"]').click();
    await page.waitForTimeout(2000)
    await page.locator(`[data-test="pipeline-list-${randomPipelineName}-udpate-pipeline"]`).click();
    await page.waitForTimeout(2000)

  // Locate the function node and pipeline chart
  const functionNode = await page.waitForSelector('[data-test="pipeline-editor-function-node"]');
  const pipelineChart = await page.waitForSelector('[data-test="pipeline-editor-pipeline-chart"]');

  // Get the bounding boxes of both elements
  await page.waitForTimeout(2000)
  const functionNodeBoundingBox = await functionNode.boundingBox();
  const pipelineChartBoundingBox = await pipelineChart.boundingBox();

  // Calculate the center coordinates of the function node
  const functionNodeCenterX = functionNodeBoundingBox.x + functionNodeBoundingBox.width / 2;
  const functionNodeCenterY = functionNodeBoundingBox.y + functionNodeBoundingBox.height / 2;

  // Calculate the center coordinates of the pipeline chart
  const pipelineChartCenterX = pipelineChartBoundingBox.x + pipelineChartBoundingBox.width / 2;
  const pipelineChartCenterY = pipelineChartBoundingBox.y + pipelineChartBoundingBox.height / 2;

  // Simulate the drag-and-drop operation
  await page.mouse.move(functionNodeCenterX, functionNodeCenterY);
  await page.mouse.down();
  await page.mouse.move(pipelineChartCenterX, pipelineChartCenterY);
  await page.mouse.up();
  await page.waitForTimeout(2000)
  await page.locator('[data-test="create-function-toggle"] div').nth(2).click();
  await page.getByLabel('Name').click();
  await page.getByLabel('Name').fill(randomFunctionName);
  await page.locator('[data-test="associate-function-save-btn"]').click();
  await page.locator('#q-notify').getByRole('alert').click();
  });



  test('should display error when no name added while adding function to pipeline', async ({ page }) => {
    await page.locator('[data-test="menu-link-\\/pipeline-item"]').click();
    await page.getByRole('main').locator('div').filter({ hasText: 'Enrichment TablesFunctionsStream AssociationStream' }).first().click();
    await page.locator('[data-test="stream-pipelines-tab"]').click();
    await page.locator('[data-test="pipeline-list-add-pipeline-btn"]').click();
    await page.locator('[data-test="add-pipeline-name-input"]').getByLabel('Name *').click();
    await page.locator('[data-test="add-pipeline-name-input"]').getByLabel('Name *').fill(randomPipelineName);
    await page.waitForSelector('.alert-stream-type > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native');
    await page.locator('.alert-stream-type > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native').click();
    await page.waitForTimeout(2000);
    await page.getByRole('option', { name: 'Logs' }).locator('div').nth(2).click({force:true});
    await page.waitForTimeout(2000);
    // await page.waitForSelector('[data-test="Stream Name *"]')
    await page.getByLabel('Stream Name *').click();
    // await page.waitForSelector(':text("e2e_automate")')
    await page.getByRole('option', { name: 'e2e_automate' }).locator('div').nth(2).click();
    await page.locator('[data-test="add-pipeline-submit-btn"]').click();
    await page.waitForTimeout(2000)
    await page.locator(`[data-test="pipeline-list-${randomPipelineName}-udpate-pipeline"]`).click();
    await page.waitForTimeout(2000)

  // Locate the function node and pipeline chart
  const functionNode = await page.waitForSelector('[data-test="pipeline-editor-function-node"]');
  const pipelineChart = await page.waitForSelector('[data-test="pipeline-editor-pipeline-chart"]');

  // Get the bounding boxes of both elements
  await page.waitForTimeout(2000)
  const functionNodeBoundingBox = await functionNode.boundingBox();
  const pipelineChartBoundingBox = await pipelineChart.boundingBox();

  // Calculate the center coordinates of the function node
  const functionNodeCenterX = functionNodeBoundingBox.x + functionNodeBoundingBox.width / 2;
  const functionNodeCenterY = functionNodeBoundingBox.y + functionNodeBoundingBox.height / 2;

  // Calculate the center coordinates of the pipeline chart
  const pipelineChartCenterX = pipelineChartBoundingBox.x + pipelineChartBoundingBox.width / 2;
  const pipelineChartCenterY = pipelineChartBoundingBox.y + pipelineChartBoundingBox.height / 2;

  // Simulate the drag-and-drop operation
  await page.mouse.move(functionNodeCenterX, functionNodeCenterY);
  await page.mouse.down();
  await page.mouse.move(pipelineChartCenterX, pipelineChartCenterY);
  await page.mouse.up();
  await page.waitForTimeout(2000)
  await page.locator('[data-test="associate-function-save-btn"]').click();
  await page.getByText('Function is already associated').click();


  });


  test('should add streamroute node', async ({ page }) => {
    await page.locator('[data-test="menu-link-\\/pipeline-item"]').click();
    await page.getByRole('main').locator('div').filter({ hasText: 'Enrichment TablesFunctionsStream AssociationStream' }).first().click();
    await page.locator('[data-test="stream-pipelines-tab"]').click();
    await page.locator('[data-test="pipeline-list-add-pipeline-btn"]').click();
    await page.locator('[data-test="add-pipeline-name-input"]').getByLabel('Name *').click();
    await page.locator('[data-test="add-pipeline-name-input"]').getByLabel('Name *').fill(randomPipelineName);
    await page.waitForSelector('.alert-stream-type > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native');
    await page.locator('.alert-stream-type > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native').click();
    await page.waitForTimeout(2000);
    await page.getByRole('option', { name: 'Logs' }).locator('div').nth(2).click({force:true});
    await page.waitForTimeout(2000);
    // await page.waitForSelector('[data-test="Stream Name *"]')
    await page.getByLabel('Stream Name *').click();
    // await page.waitForSelector(':text("e2e_automate")')
    await page.getByRole('option', { name: 'e2e_automate' }).locator('div').nth(2).click();
    await page.locator('[data-test="add-pipeline-submit-btn"]').click();
    await page.waitForTimeout(2000)
    await page.locator(`[data-test="pipeline-list-${randomPipelineName}-udpate-pipeline"]`).click();
    await page.waitForTimeout(2000)

  // Locate the function node and pipeline chart
  const functionNode = await page.waitForSelector('[data-test="pipeline-editor-streamRoute-node"]');
  const pipelineChart = await page.waitForSelector('[data-test="pipeline-editor-pipeline-chart"]');

  // Get the bounding boxes of both elements
  await page.waitForTimeout(2000)
  const functionNodeBoundingBox = await functionNode.boundingBox();
  const pipelineChartBoundingBox = await pipelineChart.boundingBox();

  // Calculate the center coordinates of the function node
  const functionNodeCenterX = functionNodeBoundingBox.x + functionNodeBoundingBox.width / 2;
  const functionNodeCenterY = functionNodeBoundingBox.y + functionNodeBoundingBox.height / 2;

  // Calculate the center coordinates of the pipeline chart
  const pipelineChartCenterX = pipelineChartBoundingBox.x + pipelineChartBoundingBox.width / 2;
  const pipelineChartCenterY = pipelineChartBoundingBox.y + pipelineChartBoundingBox.height / 2;

  // Simulate the drag-and-drop operation
  await page.mouse.move(functionNodeCenterX, functionNodeCenterY);
  await page.mouse.down();
  await page.mouse.move(pipelineChartCenterX, pipelineChartCenterY);
  await page.mouse.up();
  await page.waitForTimeout(2000)
  await page.getByLabel('Stream Name *').click();
  await page.getByLabel('Stream Name *').fill('piplelineauto');
  await page.locator('.q-ml-none > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native').first().click();
  await page.getByRole('option', { name: '_timestamp' }).locator('div').nth(2).click();
  await page.locator('div:nth-child(2) > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native').click();
  await page.getByRole('option', { name: '=', exact: true }).locator('div').nth(2).click();
  await page.getByPlaceholder('Value').click();
  await page.getByPlaceholder('Value').fill('1');
  await page.locator('[data-test="add-report-save-btn"]').click();
  await page.waitForTimeout(2000)
  await page.locator('[data-test="add-pipeline-back-btn"]').click();
  await page.locator('[data-test="confirm-button"]').click();
  await page.waitForTimeout(2000)
  await page.locator('[data-test="pipeline-list-search-input"]').click();
  await page.locator('[data-test="pipeline-list-search-input"]').fill(randomPipelineName);
  await page.locator(`[data-test="pipeline-list-${randomPipelineName}-delete-pipeline"]`).click();
  await page.locator('[data-test="confirm-button"]').click();
});

  test('should display error when only blank spaces added in stream route name', async ({ page }) => {
    await page.locator('[data-test="menu-link-\\/pipeline-item"]').click();
    await page.getByRole('main').locator('div').filter({ hasText: 'Enrichment TablesFunctionsStream AssociationStream' }).first().click();
    await page.locator('[data-test="stream-pipelines-tab"]').click();
    await page.locator('[data-test="pipeline-list-add-pipeline-btn"]').click();
    await page.locator('[data-test="add-pipeline-name-input"]').getByLabel('Name *').click();
    await page.locator('[data-test="add-pipeline-name-input"]').getByLabel('Name *').fill(randomPipelineName);
    await page.waitForSelector('.alert-stream-type > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native');
    await page.locator('.alert-stream-type > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native').click();
    await page.waitForTimeout(2000);
    await page.getByRole('option', { name: 'Logs' }).locator('div').nth(2).click({force:true});
    await page.waitForTimeout(2000);
    // await page.waitForSelector('[data-test="Stream Name *"]')
    await page.getByLabel('Stream Name *').click();
    // await page.waitForSelector(':text("e2e_automate")')
    await page.getByRole('option', { name: 'e2e_automate' }).locator('div').nth(2).click();
    await page.locator('[data-test="add-pipeline-submit-btn"]').click();
    await page.waitForTimeout(2000)
    await page.locator(`[data-test="pipeline-list-${randomPipelineName}-udpate-pipeline"]`).click();
    await page.waitForTimeout(2000)

  // Locate the function node and pipeline chart
  const functionNode = await page.waitForSelector('[data-test="pipeline-editor-streamRoute-node"]');
  const pipelineChart = await page.waitForSelector('[data-test="pipeline-editor-pipeline-chart"]');

  // Get the bounding boxes of both elements
  await page.waitForTimeout(2000)
  const functionNodeBoundingBox = await functionNode.boundingBox();
  const pipelineChartBoundingBox = await pipelineChart.boundingBox();

  // Calculate the center coordinates of the function node
  const functionNodeCenterX = functionNodeBoundingBox.x + functionNodeBoundingBox.width / 2;
  const functionNodeCenterY = functionNodeBoundingBox.y + functionNodeBoundingBox.height / 2;

  // Calculate the center coordinates of the pipeline chart
  const pipelineChartCenterX = pipelineChartBoundingBox.x + pipelineChartBoundingBox.width / 2;
  const pipelineChartCenterY = pipelineChartBoundingBox.y + pipelineChartBoundingBox.height / 2;

  // Simulate the drag-and-drop operation
  await page.mouse.move(functionNodeCenterX, functionNodeCenterY);
  await page.mouse.down();
  await page.mouse.move(pipelineChartCenterX, pipelineChartCenterY);
  await page.mouse.up();
  await page.waitForTimeout(2000)
  await page.getByLabel('Stream Name *').fill('    ');
  await page.locator('[data-test="add-report-save-btn"]').click();
  await page.getByText('Use alphanumeric and \'+=,.@-_').click();
  await page.locator('[data-test="stream-routing-cancel-btn"]').click();
  await page.locator('[data-test="confirm-button"]').click();
  await page.locator('[data-test="add-pipeline-back-btn"]').click();
  await page.locator('[data-test="confirm-button"]').click();
  await page.waitForTimeout(2000)
  await page.locator('[data-test="pipeline-list-search-input"]').click();
  await page.locator('[data-test="pipeline-list-search-input"]').fill(randomPipelineName);
  await page.locator(`[data-test="pipeline-list-${randomPipelineName}-delete-pipeline"]`).click();
  await page.locator('[data-test="confirm-button"]').click();
  
  });

})