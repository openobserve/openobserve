/**
 * Pipeline bulk export — #7030.
 *
 * #7030 asked for three things: bulk export, an error on an empty pipeline
 * name, and the function definition travelling with the export. The
 * empty-name validation is already covered by
 * `Pipelines/pipelines.spec.js` (`confirmPipelineNameRequired`), so this spec
 * covers only the export half and does not duplicate it.
 *
 * The assertion reads the downloaded file rather than trusting the success
 * toast: `exportBulkPipelines` builds a Blob and clicks a synthetic link
 * (components/pipeline/PipelinesList.vue), so a toast can fire while the
 * payload is empty or missing the node graph — which is exactly the
 * "function definition is not in the export" half of the report.
 *
 * The list is filtered to this run's own prefix before Select All, so the
 * export contains only pipelines this test created. Without that, Select All
 * on a shared environment sweeps in unrelated pipelines and the count
 * assertion becomes meaningless.
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestTestData } = require('../../utils/data-ingestion.js');

const SOURCE_STREAM = 'e2e_automate';

const condition = () => ({
  filterType: 'group',
  logicalOperator: 'AND',
  groupId: `group-${Date.now()}`,
  conditions: [
    {
      filterType: 'condition',
      column: 'kubernetes_container_name',
      operator: '!=',
      value: 'e2e-7030-never-matches',
      values: [],
      logicalOperator: 'AND',
      id: `cond-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    },
  ],
});

test.describe("Pipeline bulk export", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;
  const created = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await ingestTestData(page);
    await page.waitForLoadState('domcontentloaded');
    testLogger.info('Pipeline export setup completed');
  });

  test.afterEach(async () => {
    while (created.length) {
      const name = created.pop();
      await pm.apiCleanup.deletePipeline(name).catch((e) =>
        testLogger.warn(`Cleanup failed for ${name}: ${e.message}`)
      );
    }
  });

  // ==========================================================================
  // Bug #7030: pipeline improvements — bulk export
  // https://github.com/openobserve/openobserve/issues/7030
  // ==========================================================================
  test("selecting pipelines should offer a bulk export carrying their full definition", {
    tag: ['@bug-7030', '@P2', '@regression', '@pipelinesRegression', '@pipelinesRegressionExport']
  }, async ({ page }) => {
    testLogger.info('Test: pipeline bulk export (Bug #7030)');

    const prefix = `e2e7030${Math.random().toString(36).substring(2, 7)}`;
    const names = [`${prefix}-alpha`, `${prefix}-beta`];
    for (const name of names) {
      await pm.pipelinesPage.createPipeline(name, SOURCE_STREAM, `${name}_dest`, condition());
      created.push(name);
    }
    testLogger.info(`Created ${names.length} pipelines under prefix ${prefix}`);

    await pm.pipelinesPage.openPipelineMenu();
    await pm.pipelinesPage.searchPipeline(prefix);

    // Both rows must be in the filtered list before Select All, or the export
    // silently covers whatever subset had rendered.
    for (const name of names) {
      await expect(page.locator(`[data-test="pipeline-list-${name}-update-pipeline"]`),
        `Precondition: ${name} must be in the filtered list`
      ).toBeVisible({ timeout: 20000 });
    }

    const exportBtn = page.locator('[data-test="pipeline-list-export-pipelines-btn"]');
    await expect(exportBtn,
      'Bug #7030: the bulk export button must stay hidden while nothing is selected'
    ).toBeHidden();

    await page.locator('[data-test="o2-table-select-all"]').click();

    await expect(exportBtn,
      'Bug #7030: selecting pipelines must reveal a bulk export action'
    ).toBeVisible({ timeout: 10000 });

    const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
    await exportBtn.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename(),
      'Bug #7030: the bulk export must be a dated pipelines_export JSON'
    ).toMatch(/^pipelines_export_\d{4}-\d{2}-\d{2}\.json$/);

    const payload = JSON.parse(
      require('fs').readFileSync(await download.path(), 'utf8')
    );
    testLogger.info(`Export payload: ${Array.isArray(payload) ? payload.length : 'not an array'} entries`);

    expect(Array.isArray(payload),
      'Bug #7030: a bulk export must be an array of pipelines'
    ).toBe(true);

    const exported = payload.map((p) => p.name).sort();
    expect(exported,
      'Bug #7030: the export must contain exactly the selected pipelines'
    ).toEqual([...names].sort());

    // The "function definition at the time of export" half of the report: the
    // export has to carry the node graph, not just the pipeline's metadata.
    for (const p of payload) {
      expect(Array.isArray(p.nodes) && p.nodes.length > 0,
        `Bug #7030: exported pipeline ${p.name} must carry its node definitions`
      ).toBe(true);
    }

    testLogger.info('✓ PASSED: bulk export carries full pipeline definitions (Bug #7030)');
  });
});
