// Copyright 2026 OpenObserve Inc.
// openobserve#16795: clicking the selected SLO health card again kept its filter instead of clearing it.
const { test, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const {
  seedMinimalStream,
  createSloViaApi,
  countDefinition,
  deleteSlosByPrefix,
  deleteFixturesByPrefix,
  uniqueName,
} = require('../../utils/slo-seed.js');

const PREFIX = 'e2e_slo_16795';
const ORG = process.env['ORGNAME'];

test.describe('SLO health card toggles off on a second click (#16795)', { tag: ['@slo', '@regression', '@all'] }, () => {
  let pm;
  let wp;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    wp = `${PREFIX}_w${testInfo.workerIndex}`;
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterEach(async ({ page }) => {
    await deleteSlosByPrefix(page, `${wp}_`);
    await deleteFixturesByPrefix(page, `${wp}_`);
  });

  test('re-clicking the selected health card clears the filter and brings the rows back', { tag: ['@bug-16795', '@P2'] }, async ({ page }) => {
    const stream = uniqueName(`${wp}_stream`);
    const name = uniqueName(wp);
    await seedMinimalStream(page, stream);
    await createSloViaApi(page, countDefinition({ name, stream }));

    await pm.sloListPage.goto(ORG);
    await pm.sloListPage.expectRowVisible(name);
    await pm.sloListPage.expectStatSelected('total', true);

    // A brand-new SLO is unmeasured (no_data), so the Meeting filter hides it.
    await pm.sloListPage.clickStat('meeting');
    await pm.sloListPage.expectStatSelected('meeting', true);
    await pm.sloListPage.expectRowAbsent(name);

    await pm.sloListPage.clickStat('meeting');
    await pm.sloListPage.expectStatSelected('meeting', false);
    await pm.sloListPage.expectStatSelected('total', true);
    await pm.sloListPage.expectRowVisible(name);
  });
});
