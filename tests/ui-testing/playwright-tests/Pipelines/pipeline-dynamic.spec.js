import { test, expect } from '@playwright/test';
import PageManager from '../../pages/page-manager.js';
import logsdata from '../../../test-data/logs_data.json';
import { getHeaders, getIngestionUrl, sendRequest } from '../../utils/apiUtils.js';
const testLogger = require('../utils/test-logger.js');
const path = require('path');

// Use stored authentication state from global setup instead of logging in each test
const authFile = path.join(__dirname, '../utils/auth/user.json');

test.describe('Pipeline Dynamic Stream Names', { tag: ['@all', '@pipelines', '@pipelinesDynamic'] }, () => {

  let page;
  let context;
  let pageManager;
  // Worker-specific stream suffix (set per test in beforeEach) so parallel workers
  // never share a source/destination stream.
  let streamSuffix;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ storageState: authFile });
    page = await context.newPage();
    pageManager = new PageManager(page);

    // Navigate to base URL so the UI is loaded (required for storageState auth)
    await page.goto(`${process.env.ZO_BASE_URL}/web/?org_identifier=${process.env.ORGNAME}`);
    await page.waitForLoadState('networkidle').catch(() => {});
  });

  test.beforeEach(async ({}, testInfo) => {
    // Ensure page is still open
    if (page.isClosed()) {
      throw new Error('Page was closed unexpectedly');
    }
    streamSuffix = `_w${testInfo.parallelIndex}`;

    // Ingestion - happens before each test (worker-scoped stream names)
    const orgId = process.env["ORGNAME"];
    const streamNames = [
      `e2e_automate${streamSuffix}`,
      `e2e_automate1${streamSuffix}`,
      `e2e_automate2${streamSuffix}`,
      `e2e_automate3${streamSuffix}`,
    ];
    const headers = getHeaders();

    for(const streamName of streamNames) {
      const url = getIngestionUrl(orgId, streamName);
      const response = await sendRequest(page, url, logsdata, headers);
      testLogger.debug('API response received', { response });
    }
    // NOTE: no pool-wide pipeline cleanup here. Deleting pipelines across all four shared
    // source streams on every setup races with sibling tests in pipeline-core / pipelines
    // (which share these stream names) and deletes their in-flight pipelines. Each test
    // below frees only its OWN source stream at its start.
  });

  test.afterEach(async () => {
    // Add a small wait after each test to ensure operations are complete
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  });

  test.afterAll(async () => {
    // Add a wait before closing to ensure all operations are complete
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    if (!page.isClosed()) {
      await page.close();
    }
    await context.close();
  });

  test('Verify pipeline with dynamic destination name using kubernetes_container_name', async () => {
    const sourceStream = `e2e_automate1${streamSuffix}`;
    const destStream = `dynamic_ziox_dynamic${streamSuffix}`;
    // Free only this test's own source stream (see note in beforeEach).
    await pageManager.apiCleanup.cleanupPipelines([sourceStream]).catch(() => {});
    // Navigate to stream and pipeline
    await pageManager.pipelinesPage.exploreStreamAndNavigateToPipeline(sourceStream);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Setup source stream
    await pageManager.pipelinesPage.setupPipelineWithSourceStream(sourceStream);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Setup container name condition
    await pageManager.pipelinesPage.setupContainerNameCondition();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Setup destination stream
    await pageManager.pipelinesPage.setupDestinationStream(destStream);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Create and verify pipeline
    await pageManager.pipelinesPage.createAndVerifyPipeline(destStream, sourceStream);
  });

  test('Verify pipeline with dynamic destination name using kubernetes_container_name with underscores', async () => {
    const sourceStream = `e2e_automate2${streamSuffix}`;
    const destStream = `dynamic_ziox_dynamic${streamSuffix}`;
    // Free only this test's own source stream (see note in beforeEach).
    await pageManager.apiCleanup.cleanupPipelines([sourceStream]).catch(() => {});
    await pageManager.pipelinesPage.exploreStreamAndNavigateToPipeline(sourceStream);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pageManager.pipelinesPage.setupPipelineWithSourceStream(sourceStream);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pageManager.pipelinesPage.setupContainerNameCondition();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pageManager.pipelinesPage.setupDestinationStream(destStream);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pageManager.pipelinesPage.createAndVerifyPipeline(destStream, sourceStream);
  });

  test('Verify pipeline with dynamic destination name using kubernetes_container_name directly', async () => {
    const sourceStream = `e2e_automate3${streamSuffix}`;
    const destStream = `ziox${streamSuffix}`;
    // Free only this test's own source stream (see note in beforeEach).
    await pageManager.apiCleanup.cleanupPipelines([sourceStream]).catch(() => {});
    await pageManager.pipelinesPage.exploreStreamAndNavigateToPipeline(sourceStream);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pageManager.pipelinesPage.setupPipelineWithSourceStream(sourceStream);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pageManager.pipelinesPage.setupContainerNameCondition();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pageManager.pipelinesPage.setupDestinationStream(destStream);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pageManager.pipelinesPage.createAndVerifyPipeline(destStream, sourceStream);
  });
}); 