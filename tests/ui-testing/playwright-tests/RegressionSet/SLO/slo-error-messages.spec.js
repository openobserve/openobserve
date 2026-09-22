const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const {
  seedMinimalStream,
  deleteFixturesByPrefix,
  uniqueName,
} = require('../../utils/slo-seed.js');

const PREFIX = 'e2e_slo_14269';
const ORG = process.env['ORGNAME'];

test.describe.configure({ mode: 'serial' });

test.describe('SLO form surfaces the server reason', () => {
  let pm;
  let stream;

  test.beforeAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    stream = uniqueName(`${PREFIX}_w${testInfo.workerIndex}_stream`);
    await seedMinimalStream(page, stream, { records: 30 });
    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    pm = new PageManager(page);
    await navigateToBase(page);
  });

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await deleteFixturesByPrefix(page, PREFIX);
    await context.close();
  });

  test('save failure shows the server body, not the axios status string', {
    tag: ['@bug-14269', '@P1', '@regression', '@sloRegression', '@sloRegressionErrors']
  }, async () => {
    const reason = 'slo definition rejected: target must be below 100';
    await pm.sloFormPage.stubSaveFailure(reason);
    await pm.sloFormPage.gotoNew(ORG);

    await pm.sloFormPage.fillCountSlo({
      name: uniqueName(`${PREFIX}_save`),
      stream,
      goodExpr: 'status_code < 500',
    });
    await pm.sloFormPage.save();

    await pm.sloFormPage.expectError(reason);
    await pm.sloFormPage.expectNoError(/Request failed with status code/);
    testLogger.info('Plain-text save rejection surfaced verbatim');
  });

  test('source-alert load failure reports the reason on the picker', {
    tag: ['@bug-14269', '@P1', '@regression', '@sloRegression', '@sloRegressionErrors']
  }, async () => {
    const reason = 'org has no alerts configured';
    await pm.sloFormPage.stubEligibleAlertsFailure(reason);
    await pm.sloFormPage.gotoNew(ORG);

    await pm.sloFormPage.selectSliType('alert');

    await pm.sloFormPage.expectAlertSourceError(reason);
    // The empty-state banner and a load error are mutually exclusive — showing
    // both tells the user their org has no alerts when the lookup merely failed.
    await expect(pm.sloFormPage.getAlertSourceEmpty()).toHaveCount(0);
    testLogger.info('Source-alert load failure surfaced on the picker');
  });
});
