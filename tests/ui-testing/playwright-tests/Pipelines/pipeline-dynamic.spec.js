import { test, expect } from '@playwright/test';
import PageManager from '../../pages/page-manager.js';
import { LoginPage } from '../../pages/generalPages/loginPage.js';
import logsdata from '../../../test-data/logs_data.json';
import { getHeaders, getIngestionUrl, sendRequest } from '../../utils/apiUtils.js';
const testLogger = require('../utils/test-logger.js');

test.describe('Pipeline Dynamic Stream Names', { tag: ['@all', '@pipelines', '@pipelinesDynamic'] }, () => {

  let page;
  let pageManager;
  let loginPage;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    pageManager = new PageManager(page);
    loginPage = new LoginPage(page);

    // Login using LoginPage - happens only once before all tests
    await loginPage.gotoLoginPage();
    await loginPage.loginAsInternalUser();
    await loginPage.login();
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
      testLogger.debug('API response received', { response });
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
    await pageManager.pipelinesPage.exploreStreamAndNavigateToPipeline('e2e_automate1');
    await page.waitForLoadState('networkidle');
    
    // Setup source stream
    await pageManager.pipelinesPage.setupPipelineWithSourceStream('e2e_automate1');
    await page.waitForLoadState('networkidle');
    
    // Setup container name condition
    await pageManager.pipelinesPage.setupContainerNameCondition();
    await page.waitForLoadState('networkidle');
    
    // Setup destination stream
    await pageManager.pipelinesPage.setupDestinationStream('dynamic_ziox_dynamic');
    await page.waitForLoadState('networkidle');
    
    // Create and verify pipeline
    await pageManager.pipelinesPage.createAndVerifyPipeline('dynamic_ziox_dynamic', 'e2e_automate1');
  });

  test('Verify pipeline with dynamic destination name using kubernetes_container_name with underscores', async () => {
    await pageManager.pipelinesPage.exploreStreamAndNavigateToPipeline('e2e_automate2');
    await page.waitForLoadState('networkidle');
    await pageManager.pipelinesPage.setupPipelineWithSourceStream('e2e_automate2');
    await page.waitForLoadState('networkidle');
    await pageManager.pipelinesPage.setupContainerNameCondition();
    await page.waitForLoadState('networkidle');
    await pageManager.pipelinesPage.setupDestinationStream('dynamic_ziox_dynamic');
    await page.waitForLoadState('networkidle');
    await pageManager.pipelinesPage.createAndVerifyPipeline('dynamic_ziox_dynamic', 'e2e_automate2');
  });

  test('Verify pipeline with dynamic destination name using kubernetes_container_name directly', async () => {
    await pageManager.pipelinesPage.exploreStreamAndNavigateToPipeline('e2e_automate3');
    await page.waitForLoadState('networkidle');
    await pageManager.pipelinesPage.setupPipelineWithSourceStream('e2e_automate3');
    await page.waitForLoadState('networkidle');
    await pageManager.pipelinesPage.setupContainerNameCondition();
    await page.waitForLoadState('networkidle');
    await pageManager.pipelinesPage.setupDestinationStream('ziox');
    await page.waitForLoadState('networkidle');
    await pageManager.pipelinesPage.createAndVerifyPipeline('ziox', 'e2e_automate3');
  });
}); 