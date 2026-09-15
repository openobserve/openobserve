/**
 * Pipeline list preview stays inside the viewport — #12647 (and its earlier
 * duplicate #9498).
 *
 * Hovering a pipeline row's View (eye) action shows a floating graph preview.
 * It used to be anchored so that it ran off the right edge of the window and
 * got clipped; the fix anchors the OTooltip to `side="left"` with
 * `max-width="none"` (components/pipeline/PipelinesList.vue).
 *
 * The assertion is pure geometry against the viewport rather than a screenshot
 * or a class check, because "clipped off the right edge" is exactly a
 * bounding-box claim and nothing else expresses it without being brittle.
 *
 * `pages/pipelinesPages/pipelinesPage.js` already carried `hoverPipelineRow`
 * and `getPreviewBoundingBox` for this bug, but no test ever called them — the
 * locators there are deliberately loose (`[class*="preview"]`), so this spec
 * targets the tooltip bubble's own `o-tooltip-content` instead.
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestTestData } = require('../../utils/data-ingestion.js');

const SOURCE_STREAM = 'e2e_automate';
const TOOLTIP = '[data-test="o-tooltip-content"]';

/**
 * Minimal single-condition group. The pipeline's logic is irrelevant here — the
 * test only needs a row in the list with a View action — so this is the
 * smallest payload `createPipeline` will accept rather than anything meaningful.
 */
const minimalCondition = () => ({
  filterType: 'group',
  logicalOperator: 'AND',
  groupId: `group-${Date.now()}`,
  conditions: [
    {
      filterType: 'condition',
      column: 'kubernetes_container_name',
      operator: '!=',
      value: 'e2e-12647-never-matches',
      values: [],
      logicalOperator: 'AND',
      id: `cond-${Date.now()}`,
    },
  ],
});

test.describe("Pipeline list preview bounds", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;
  let pipelineName;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await ingestTestData(page);
    await page.waitForLoadState('domcontentloaded');
    testLogger.info('Pipeline preview bounds setup completed');
  });

  test.afterEach(async () => {
    if (pipelineName) {
      await pm.apiCleanup.deletePipeline(pipelineName).catch((e) =>
        testLogger.warn(`Pipeline cleanup failed: ${e.message}`)
      );
      pipelineName = undefined;
    }
  });

  // ==========================================================================
  // Bug #12647 (dup #9498): preview popup on View hover overflows the viewport
  // https://github.com/openobserve/openobserve/issues/12647
  // ==========================================================================
  test("the row View preview should render fully inside the viewport", {
    tag: ['@bug-12647', '@bug-9498', '@P2', '@regression', '@pipelinesRegression', '@pipelinesRegressionPreview']
  }, async ({ page }) => {
    testLogger.info('Test: pipeline preview stays within viewport (Bug #12647)');

    // Created through the API rather than the canvas: the drag-and-drop editor
    // needs an input→condition→output wiring pass that has nothing to do with
    // this bug, and every second of it is a flake surface for a test whose
    // whole subject is one hover.
    const destName = `e2e_12647_dest_${Math.random().toString(36).substring(7)}`;
    pipelineName = `e2e-12647-${Math.random().toString(36).substring(7)}`;
    await pm.pipelinesPage.createPipeline(pipelineName, SOURCE_STREAM, destName, minimalCondition());
    testLogger.info(`Created pipeline ${pipelineName}`);

    await pm.pipelinesPage.openPipelineMenu();
    await pm.pipelinesPage.searchPipeline(pipelineName);

    const viewBtn = page.locator(`[data-test="pipeline-list-${pipelineName}-view-pipeline"]`);
    await expect(viewBtn, 'Precondition: the row View action must be present').toBeVisible({ timeout: 20000 });

    await viewBtn.hover();

    const tooltip = page.locator(TOOLTIP).first();
    await expect(tooltip, 'Hovering View must open the graph preview').toBeVisible({ timeout: 10000 });

    const box = await tooltip.boundingBox();
    expect(box, 'Preview must have a measurable box').not.toBeNull();

    const viewport = page.viewportSize();
    testLogger.info(`Preview box: ${JSON.stringify(box)} viewport: ${JSON.stringify(viewport)}`);

    // Sub-pixel rounding in the popper transform can land a hair over the edge
    // on a fractional device scale, so allow 1px rather than asserting exact
    // containment and inviting a flake that says nothing about the bug.
    const TOLERANCE = 1;

    expect(box.x,
      'Bug #12647: preview must not be clipped off the left edge'
    ).toBeGreaterThanOrEqual(-TOLERANCE);

    expect(box.x + box.width,
      'Bug #12647: preview must not overflow past the right edge of the viewport'
    ).toBeLessThanOrEqual(viewport.width + TOLERANCE);

    expect(box.width, 'Preview must actually render content').toBeGreaterThan(0);

    testLogger.info('✓ PASSED: pipeline preview contained in viewport (Bug #12647)');
  });
});
