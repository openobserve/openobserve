const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
import logsdata from '../../../test-data/logs_data.json';
import { getHeaders, getIngestionUrl, sendRequest } from '../../utils/apiUtils.js';
const { waitUtils } = require('../utils/wait-helpers.js');

test.describe('Pipeline Dynamic Stream Names', () => {



  let pageManager;

  test.beforeEach(async ({ page }) => {
    pageManager = new PageManager(page);

    // Ingestion - happens before each test
    const orgId = process.env["ORGNAME"];
    const streamNames = ["e2e_automate", "e2e_automate1", "e2e_automate2", "e2e_automate3"];
    const headers = getHeaders();
    
    for(const streamName of streamNames) {
      const url = getIngestionUrl(orgId, streamName);
      const response = await sendRequest(page, url, logsdata, headers);
      console.log(response);
    }
    await waitUtils.smartWait(page, 2000, 'ingestion data setup');
    
    // Establish UI state for navigation - similar to Streams fix
    await page.goto(`${process.env.ZO_BASE_URL}/web/logs?org_identifier=${process.env.ORGNAME}`);
    await page.waitForLoadState('networkidle');
  });

  test('Verify pipeline with dynamic destination name using kubernetes_container_name', async ({ page }) => {
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

  test('Verify pipeline with dynamic destination name using kubernetes_container_name with underscores', async ({ page }) => {
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

  test('Verify pipeline with dynamic destination name using kubernetes_container_name directly', async ({ page }) => {
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