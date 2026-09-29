const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestTestData } = require('../../utils/data-ingestion.js');

// Smallest payload createPipeline accepts; the pipeline's logic is irrelevant to this test.
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
  let sourceStream;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('domcontentloaded');
    testLogger.info('Pipeline preview bounds setup completed');
  });

  test.afterEach(async () => {
    if (sourceStream) {
      // deletePipeline() takes the server-assigned pipeline_id, not the name we chose —
      // cleanupPipelines() looks the pipeline up by its source stream and deletes by id.
      await pm.apiCleanup.cleanupPipelines([sourceStream]).catch((e) =>
        testLogger.warn(`Pipeline cleanup failed: ${e.message}`)
      );
      sourceStream = undefined;
      pipelineName = undefined;
    }
  });

  test("the row View preview should render fully inside the viewport", {
    tag: ['@bug-12647', '@bug-9498', '@P2', '@regression', '@pipelinesRegression', '@pipelinesRegressionPreview']
  }, async ({ page }) => {
    // Created via API: the canvas editor's node-wiring pass is pure flake surface for a hover test.
    const suffix = Math.random().toString(36).substring(7);
    // A realtime pipeline is the only one OpenObserve allows per source stream, so a
    // dedicated stream keeps this test from colliding with any other pipeline test.
    sourceStream = `e2e_12647_src_${suffix}`;
    const destName = `e2e_12647_dest_${suffix}`;
    pipelineName = `e2e-12647-${suffix}`;
    await ingestTestData(page, sourceStream);
    const result = await pm.pipelinesPage.createPipeline(pipelineName, sourceStream, destName, minimalCondition());
    expect(result.status, `Pipeline creation must succeed: ${JSON.stringify(result.data)}`).toBe(200);
    testLogger.info(`Created pipeline ${pipelineName}`);

    await pm.pipelinesPage.openPipelineMenu();
    await pm.pipelinesPage.searchPipeline(pipelineName);

    const box = await pm.pipelinesPage.hoverViewAndGetPreviewBox(pipelineName);
    expect(box, 'Preview must have a measurable box').not.toBeNull();

    const viewport = page.viewportSize();
    testLogger.info(`Preview box: ${JSON.stringify(box)} viewport: ${JSON.stringify(viewport)}`);

    // 1px: sub-pixel popper rounding on a fractional device scale would otherwise flake.
    const TOLERANCE = 1;

    expect(box.x,
      'Bug #12647: preview must not be clipped off the left edge'
    ).toBeGreaterThanOrEqual(-TOLERANCE);

    expect(box.x + box.width,
      'Bug #12647: preview must not overflow past the right edge of the viewport'
    ).toBeLessThanOrEqual(viewport.width + TOLERANCE);

    expect(box.width, 'Preview must actually render content').toBeGreaterThan(0);

    testLogger.info('PASSED: pipeline preview contained in viewport (Bug #12647)');
  });
});
