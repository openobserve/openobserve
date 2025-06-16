import { test, expect } from '@playwright/test';
import PipelinePage from '../pages/pipelinePage.js';
import logsdata from '../../test-data/logs_data.json';
import { getHeaders, getIngestionUrl, sendRequest } from '../utils/apiUtils.js';

test.describe('Pipeline Dynamic Stream Names', () => {
  let page;
  let pipelinePage;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    pipelinePage = new PipelinePage(page);

    // Login - happens only once before all tests
    await page.goto(process.env["ZO_BASE_URL"]);
    if (await page.getByText('Login as internal user').isVisible()) {
      await page.getByText('Login as internal user').click();
    }
    await page.waitForTimeout(1000);
    await page
      .locator('[data-cy="login-user-id"]')
      .fill(process.env["ZO_ROOT_USER_EMAIL"]);
    await page
      .locator('[data-cy="login-password"]')
      .fill(process.env["ZO_ROOT_USER_PASSWORD"]);
    await page.locator('[data-cy="login-sign-in"]').click();
    await page.waitForTimeout(4000);
  });

  test.beforeEach(async () => {
    // Ingestion - happens before each test
    const orgId = process.env["ORGNAME"];
    const streamNames = ["e2e_automate", "e2e_automate1", "e2e_automate2", "e2e_automate3"];
    const headers = getHeaders();
    
    for(const streamName of streamNames) {
      const url = getIngestionUrl(orgId, streamName);
      const response = await sendRequest(page, url, logsdata, headers);
      console.log(response);
    }
    await page.waitForTimeout(2000);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('Verify pipeline with dynamic destination name using kubernetes_container_name', async () => {
    await pipelinePage.exploreStreamAndNavigateToPipeline('e2e_automate1');
    await pipelinePage.setupPipelineWithSourceStream('e2e_automate1');
    await pipelinePage.setupContainerNameCondition();
    await pipelinePage.setupDestinationStream('dynamiczioxdynamic');
    await pipelinePage.createAndVerifyPipeline('dynamiczioxdynamic', 'e2e_automate1');
  });

  test('Verify pipeline with dynamic destination name using kubernetes_container_name with underscores', async () => {
    await pipelinePage.exploreStreamAndNavigateToPipeline('e2e_automate2');
    await pipelinePage.setupPipelineWithSourceStream('e2e_automate2');
    await pipelinePage.setupContainerNameCondition();
    await pipelinePage.setupDestinationStream('dynamic_ziox_dynamic');
    await pipelinePage.createAndVerifyPipeline('dynamic_ziox_dynamic', 'e2e_automate2');
  });

  test('Verify pipeline with dynamic destination name using kubernetes_container_name directly', async () => {
    await pipelinePage.exploreStreamAndNavigateToPipeline('e2e_automate3');
    await pipelinePage.setupPipelineWithSourceStream('e2e_automate3');
    await pipelinePage.setupContainerNameCondition();
    await pipelinePage.setupDestinationStream('ziox');
    await pipelinePage.createAndVerifyPipeline('ziox', 'e2e_automate3');
  });
}); 