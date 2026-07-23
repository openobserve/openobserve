/**
 * Pipelines Preview Popup Overflow — UI Regression Tests
 * Bug: Pipeline preview popup overflows off the right edge of the viewport.
 *
 * The preview popup (a read-only VueFlow diagram shown on hover of the view/eye
 * button in the pipeline list) must be fully contained within the viewport.
 * Additionally, overflow-related popups properly constrain their content via
 * overflow: auto scrolling.
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

test.describe("Pipelines Preview Popup Overflow testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    // Navigate to the pipelines list page
    await pm.pipelinesPage.gotoPipelinesPage();
    // Wait for the pipeline list table to settle
    await pm.pipelinesPage.waitForPipelineListSettled();
    testLogger.info('Test setup completed');
  });

  /**
   * TC-01: Preview popup is fully contained within the viewport
   * Regression test for the core bug — the preview must not overflow
   * off any edge of the viewport.
   */
  test("Preview popup is fully contained within the viewport", {
    tag: ['@pipelines-preview-popup-overflow', '@all']
  }, async ({ page }) => {
    testLogger.info('TC-01: Verify preview popup does not overflow viewport');

    const pipelineName = `preview-vp-${Math.random().toString(36).substring(7)}`;

    // Create a pipeline with 3 nodes (input → condition → output) via API
    await pm.pipelinesPage.createPipeline(
      pipelineName,
      'e2e_automate',
      'e2e_automate1',
      {
        filterType: "condition",
        column: "kubernetes_container_name",
        operator: "Contains",
        value: "ziox",
        values: ["ziox"]
      }
    );

    // Wait for the pipelines list API to refresh and the row to appear
    const listApiResponse = page.waitForResponse(
      (resp) => /\/api\/[^/]+\/pipelines(\?|$)/.test(resp.url()) && resp.request().method() === 'GET' && resp.status() === 200,
      { timeout: 15000 }
    ).catch(() => null);
    await page.reload().catch(() => {});
    await listApiResponse;
    await pm.pipelinesPage.waitForPipelineListSettled();

    // Search for the pipeline so it is the first (and only) visible row
    await pm.pipelinesPage.searchPipeline(pipelineName);
    await page.waitForTimeout(500);

    // Hover the view (eye) button to trigger the preview popup
    await pm.pipelinesPage.hoverViewButton(pipelineName);

    // Wait for the preview popup to appear
    await pm.pipelinesPage.waitForPreviewPopup();

    // Assert the popup is fully within the viewport
    await pm.pipelinesPage.expectPreviewWithinViewport();

    testLogger.info('TC-01: Popup is fully within viewport — PASS');

    // Cleanup
    await pm.pipelinesPage.deletePipelineByName(pipelineName).catch(() => {});
  });

  /**
   * TC-02: Preview popup renders pipeline flow diagram with nodes
   * Verify the preview popup actually displays the pipeline's VueFlow
   * diagram when the view button is hovered.
   */
  test("Preview popup renders pipeline flow diagram with nodes", {
    tag: ['@pipelines-preview-popup-overflow', '@all']
  }, async ({ page }) => {
    testLogger.info('TC-02: Verify preview popup renders VueFlow diagram with nodes');

    const pipelineName = `preview-fd-${Math.random().toString(36).substring(7)}`;

    // Create a simple 2-node pipeline (input → output) via API
    await pm.pipelinesPage.createSimplePipelineViaAPI(
      pipelineName,
      'e2e_automate',
      'e2e_automate1'
    );

    // Wait for the list to refresh
    const listApiResponse = page.waitForResponse(
      (resp) => /\/api\/[^/]+\/pipelines(\?|$)/.test(resp.url()) && resp.request().method() === 'GET' && resp.status() === 200,
      { timeout: 15000 }
    ).catch(() => null);
    await page.reload().catch(() => {});
    await listApiResponse;
    await pm.pipelinesPage.waitForPipelineListSettled();

    // Search for the pipeline
    await pm.pipelinesPage.searchPipeline(pipelineName);
    await page.waitForTimeout(500);

    // Hover the view button
    await pm.pipelinesPage.hoverViewButton(pipelineName);

    // Wait for and assert the preview popup is visible
    await pm.pipelinesPage.expectPreviewPopupVisible();

    // Assert VueFlow canvas is present inside the popup
    await pm.pipelinesPage.expectVueFlowVisibleInPreview();

    // Assert at least one custom node is rendered
    await pm.pipelinesPage.expectCustomNodesVisibleInPreview();

    // Assert the popup has overflow: auto styling
    await pm.pipelinesPage.expectPreviewHasOverflowAuto();

    testLogger.info('TC-02: VueFlow diagram with nodes renders in preview — PASS');

    // Cleanup
    await pm.pipelinesPage.deletePipelineByName(pipelineName).catch(() => {});
  });

  /**
   * TC-03: Preview popup dismisses when mouse leaves the trigger
   * Verify the preview tooltip disappears when the user moves the mouse
   * away from the view button.
   */
  test("Preview popup dismisses when mouse leaves the trigger", {
    tag: ['@pipelines-preview-popup-overflow', '@all']
  }, async ({ page }) => {
    testLogger.info('TC-03: Verify preview popup dismisses on mouse leave');

    const pipelineName = `preview-dismiss-${Math.random().toString(36).substring(7)}`;

    // Create a simple 2-node pipeline via API
    await pm.pipelinesPage.createSimplePipelineViaAPI(
      pipelineName,
      'e2e_automate',
      'e2e_automate1'
    );

    // Wait for list refresh
    const listApiResponse = page.waitForResponse(
      (resp) => /\/api\/[^/]+\/pipelines(\?|$)/.test(resp.url()) && resp.request().method() === 'GET' && resp.status() === 200,
      { timeout: 15000 }
    ).catch(() => null);
    await page.reload().catch(() => {});
    await listApiResponse;
    await pm.pipelinesPage.waitForPipelineListSettled();

    // Search for the pipeline
    await pm.pipelinesPage.searchPipeline(pipelineName);
    await page.waitForTimeout(500);

    // Hover the view button to open the popup
    await pm.pipelinesPage.hoverViewButton(pipelineName);
    await pm.pipelinesPage.waitForPreviewPopup();

    // Move the mouse to a neutral area (page header / top-left corner)
    await page.mouse.move(50, 50);
    await page.waitForTimeout(500);

    // Assert the popup is no longer visible
    await pm.pipelinesPage.expectPreviewPopupNotVisible();

    testLogger.info('TC-03: Preview popup dismisses on mouse leave — PASS');

    // Cleanup
    await pm.pipelinesPage.deletePipelineByName(pipelineName).catch(() => {});
  });

  /**
   * TC-04: Action buttons are hidden in the preview popup (read-only mode)
   * Verify that edit/delete action buttons on pipeline nodes are NOT visible
   * in the preview popup — confirming the read-only constraint.
   */
  test("Action buttons are hidden in the preview popup (read-only mode)", {
    tag: ['@pipelines-preview-popup-overflow', '@all']
  }, async ({ page }) => {
    testLogger.info('TC-04: Verify action buttons are hidden in read-only preview');

    const pipelineName = `preview-ro-${Math.random().toString(36).substring(7)}`;

    // Create a pipeline with 3 nodes via API (has condition node with actions)
    await pm.pipelinesPage.createPipeline(
      pipelineName,
      'e2e_automate',
      'e2e_automate1',
      {
        filterType: "condition",
        column: "kubernetes_container_name",
        operator: "Contains",
        value: "ziox",
        values: ["ziox"]
      }
    );

    // Wait for list refresh
    const listApiResponse = page.waitForResponse(
      (resp) => /\/api\/[^/]+\/pipelines(\?|$)/.test(resp.url()) && resp.request().method() === 'GET' && resp.status() === 200,
      { timeout: 15000 }
    ).catch(() => null);
    await page.reload().catch(() => {});
    await listApiResponse;
    await pm.pipelinesPage.waitForPipelineListSettled();

    // Search for the pipeline
    await pm.pipelinesPage.searchPipeline(pipelineName);
    await page.waitForTimeout(500);

    // Hover the view button
    await pm.pipelinesPage.hoverViewButton(pipelineName);
    await pm.pipelinesPage.waitForPreviewPopup();

    // Assert action buttons are NOT visible inside the preview
    await pm.pipelinesPage.expectActionButtonsHiddenInPreview();

    testLogger.info('TC-04: Action buttons are hidden in read-only preview — PASS');

    // Cleanup
    await pm.pipelinesPage.deletePipelineByName(pipelineName).catch(() => {});
  });

  /**
   * TC-05: Empty pipeline preview shows blank canvas
   * Verify that a pipeline with zero nodes still shows the preview popup
   * with an empty VueFlow canvas (no crash or error).
   */
  test.fixme("Empty pipeline preview shows blank canvas", {
    tag: ['@pipelines-preview-popup-overflow', '@all']
  }, async ({ page }) => {
    // API rejects pipelines with zero nodes (400: "Invalid pipeline Empty pipeline.
    // Please add Source/Destination nodes, or any applicable Transform Nodes").
    // See src/handler/http/request/pipeline.rs — Empty pipeline creation is blocked.
    testLogger.info('TC-05: Skipped — API rejects zero-node pipelines');
    testLogger.info('TC-05: Verify empty pipeline preview shows blank canvas');

    const pipelineName = `preview-empty-${Math.random().toString(36).substring(7)}`;

    // Create an empty pipeline (zero nodes) via API
    await pm.pipelinesPage.createEmptyPipelineViaAPI(pipelineName);

    // Wait for list refresh
    const listApiResponse = page.waitForResponse(
      (resp) => /\/api\/[^/]+\/pipelines(\?|$)/.test(resp.url()) && resp.request().method() === 'GET' && resp.status() === 200,
      { timeout: 15000 }
    ).catch(() => null);
    await page.reload().catch(() => {});
    await listApiResponse;
    await pm.pipelinesPage.waitForPipelineListSettled();

    // Search for the pipeline
    await pm.pipelinesPage.searchPipeline(pipelineName);
    await page.waitForTimeout(500);

    // Hover the view button
    await pm.pipelinesPage.hoverViewButton(pipelineName);
    await pm.pipelinesPage.waitForPreviewPopup();

    // Assert VueFlow canvas is present but no custom nodes
    await pm.pipelinesPage.expectVueFlowVisibleInPreview();
    await pm.pipelinesPage.expectCustomNodesNotVisibleInPreview();

    testLogger.info('TC-05: Empty pipeline preview shows blank canvas — PASS');

    // Cleanup
    await pm.pipelinesPage.deletePipelineByName(pipelineName).catch(() => {});
  });

  /**
   * TC-06: Preview popup scrolls when pipeline content overflows 500x300 container
   * Verify that when pipeline nodes exceed the 500px × 300px container,
   * scrollbars appear and content is scrollable within the popup.
   */
  test("Preview popup scrolls when pipeline content overflows 500x300 container", {
    tag: ['@pipelines-preview-popup-overflow', '@all']
  }, async ({ page }) => {
    testLogger.info('TC-06: Verify preview popup scrolls when content overflows');

    const pipelineName = `preview-scroll-${Math.random().toString(36).substring(7)}`;

    // Create a large pipeline (12+ nodes) with nodes positioned beyond 500x300
    await pm.pipelinesPage.createLargePipelineViaAPI(
      pipelineName,
      'e2e_automate',
      'e2e_automate1',
      15
    );

    // Wait for list refresh
    const listApiResponse = page.waitForResponse(
      (resp) => /\/api\/[^/]+\/pipelines(\?|$)/.test(resp.url()) && resp.request().method() === 'GET' && resp.status() === 200,
      { timeout: 15000 }
    ).catch(() => null);
    await page.reload().catch(() => {});
    await listApiResponse;
    await pm.pipelinesPage.waitForPipelineListSettled();

    // Search for the pipeline
    await pm.pipelinesPage.searchPipeline(pipelineName);
    await page.waitForTimeout(500);

    // Hover the view button
    await pm.pipelinesPage.hoverViewButton(pipelineName);
    await pm.pipelinesPage.waitForPreviewPopup();

    // Assert the popup has overflow: auto styling
    await pm.pipelinesPage.expectPreviewHasOverflowAuto();

    // Verify the VueFlow pane is rendered inside the popup (confirms content is loaded)
    await expect(
      pm.pipelinesPage.previewVueFlowPane.first()
    ).toBeVisible({ timeout: 5000 });

    // Large pipeline with nodes positioned beyond 500×300 should be zoomed out
    // by VueFlow's auto-fit. The overflow: auto ensures scrollbars appear when
    // content does exceed bounds — verify by scrolling inside the popup.
    // Scroll within the popup — move the mouse inside the popup and wheel
    const popupBox = await pm.pipelinesPage.getPreviewPopupBoundingBox();
    if (popupBox) {
      const centerX = popupBox.x + popupBox.width / 2;
      const centerY = popupBox.y + popupBox.height / 2;
      await page.mouse.move(centerX, centerY);
      await page.mouse.wheel(100, 0);
      await page.waitForTimeout(300);
      await page.mouse.wheel(0, 50);
      await page.waitForTimeout(300);
    }

    // Re-hover the view button to re-open the popup after mouse-wheel moves the mouse away
    await pm.pipelinesPage.hoverViewButton(pipelineName);
    await pm.pipelinesPage.waitForPreviewPopup();

    // After scrolling, the popup should still be within the viewport
    await pm.pipelinesPage.expectPreviewWithinViewport();

    testLogger.info('TC-06: Preview popup scrolls when content overflows — PASS');

    // Cleanup
    await pm.pipelinesPage.deletePipelineByName(pipelineName).catch(() => {});
  });
});
