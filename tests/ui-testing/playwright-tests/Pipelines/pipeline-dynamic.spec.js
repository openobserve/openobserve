import { test, expect } from '@playwright/test';
import { PipelinesPage } from '../../pages/pipelinesPages/pipelinesPage.js';
import logsdata from '../../../test-data/logs_data.json';
import { getHeaders, getIngestionUrl, sendRequest } from '../../utils/apiUtils.js';

test.describe('Pipeline Dynamic Stream Names', () => {
  let page;
  let pipelinePage;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    pipelinePage = new PipelinesPage(page);

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
    // Wait for login to complete and page to be ready
    await page.waitForTimeout(4000);
  });

  test.beforeEach(async () => {
    // Ensure page is still open
    if (page.isClosed()) {
      throw new Error('Page was closed unexpectedly');
    }

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

  test.afterEach(async () => {
    // Add a small wait after each test to ensure operations are complete
    await page.waitForTimeout(1000);
  });

  test.afterAll(async () => {
    // Add a wait before closing to ensure all operations are complete
    await page.waitForTimeout(2000);
    if (!page.isClosed()) {
      await page.close();
    }
  });

  test('Verify pipeline with dynamic destination name using kubernetes_container_name', async () => {
    // Navigate to stream and pipeline
    await pipelinePage.exploreStreamAndNavigateToPipeline('e2e_automate1');
    await page.waitForLoadState('networkidle');
    
    // Setup source stream
    await pipelinePage.setupPipelineWithSourceStream('e2e_automate1');
    await page.waitForLoadState('networkidle');
    
    // Setup container name condition
    await pipelinePage.setupContainerNameCondition();
    await page.waitForLoadState('networkidle');
    
    // Setup destination stream
    await pipelinePage.setupDestinationStream('dynamic_ziox_dynamic');
    await page.waitForLoadState('networkidle');
    
    // Create and verify pipeline
    await pipelinePage.createAndVerifyPipeline('dynamic_ziox_dynamic', 'e2e_automate1');
  });

  test('Verify pipeline with dynamic destination name using kubernetes_container_name with underscores', async () => {
    await pipelinePage.exploreStreamAndNavigateToPipeline('e2e_automate2');
    await page.waitForLoadState('networkidle');
    await pipelinePage.setupPipelineWithSourceStream('e2e_automate2');
    await page.waitForLoadState('networkidle');
    await pipelinePage.setupContainerNameCondition();
    await page.waitForLoadState('networkidle');
    await pipelinePage.setupDestinationStream('dynamic_ziox_dynamic');
    await page.waitForLoadState('networkidle');
    await pipelinePage.createAndVerifyPipeline('dynamic_ziox_dynamic', 'e2e_automate2');
  });

  test('Verify pipeline with dynamic destination name using kubernetes_container_name directly', async () => {
    await pipelinePage.exploreStreamAndNavigateToPipeline('e2e_automate3');
    await page.waitForLoadState('networkidle');
    await pipelinePage.setupPipelineWithSourceStream('e2e_automate3');
    await page.waitForLoadState('networkidle');
    await pipelinePage.setupContainerNameCondition();
    await page.waitForLoadState('networkidle');
    await pipelinePage.setupDestinationStream('ziox');
    await page.waitForLoadState('networkidle');
    await pipelinePage.createAndVerifyPipeline('ziox', 'e2e_automate3');
  });
}); 