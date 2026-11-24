const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const {
  assertSyntheticsEnabled,
  ensureSyntheticsLocation,
  createCheck,
  uniqueName,
  findCheckByName,
  cleanupWorkerEntities,
} = require('../../utils/synthetics-helpers.js');

const ORG = process.env['ORGNAME'];
const TAGS = ['@bug-16383', '@P1', '@regression', '@syntheticsRegression'];

test.describe('Day, week and month schedules reopen as Custom (#16383)', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let locationId;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' });
    const page = await context.newPage();
    await assertSyntheticsEnabled(page);
    locationId = await ensureSyntheticsLocation(page);
    await context.close();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterAll(async ({ browser }, testInfo) => {
    await cleanupWorkerEntities(browser, testInfo);
  });

  test('a check saved every 1 day reopens as Custom 1 day', { tag: TAGS }, async ({ page }, testInfo) => {
    const create = pm.syntheticsCreatePage;
    const name = uniqueName('day', testInfo);
    testLogger.info('Creating an HTTP check that runs every 1 day', { name });
    await create.gotoCreate(ORG, 'http');
    await create.fillName(name);
    await create.fillTarget('https://example.com');
    await create.setCustomIntervalWithUnit(1, 'days');
    await create.selectLocation(locationId);
    await create.setEnabled(false);
    await create.save();
    await create.expectSavedAndListed();

    const saved = await findCheckByName(page, name);
    expect(saved.frequency).toMatchObject({ type: 'days', interval: 1 });

    testLogger.info('Reopening the check in the editor', { id: saved.id });
    await create.gotoEdit(ORG, saved.id);
    await create.expectNameValue(name);
    await create.expectCustomInterval(1, 'days');
  });

  for (const unit of ['weeks', 'months']) {
    test(
      `a check saved every 1 ${unit.slice(0, -1)} reopens as Custom 1 ${unit.slice(0, -1)}`,
      { tag: TAGS },
      async ({ page }, testInfo) => {
        const create = pm.syntheticsCreatePage;
        const check = await createCheck(page, 'http', testInfo, {
          locations: [locationId],
          frequency: { type: unit, interval: 1, cron: '' },
        });
        testLogger.info('Reopening a check scheduled in whole units', { id: check.id, unit });
        await create.gotoEdit(ORG, check.id);
        await create.expectNameValue(check.name);
        await create.expectCustomInterval(1, unit);
      },
    );
  }

  test('a 30 min preset still reopens as the 30 min preset', { tag: TAGS }, async ({ page }, testInfo) => {
    const create = pm.syntheticsCreatePage;
    const check = await createCheck(page, 'http', testInfo, {
      locations: [locationId],
      frequency: { type: 'minutes', interval: 30, cron: '' },
    });
    testLogger.info('Reopening a check on the 30 min preset', { id: check.id });
    await create.gotoEdit(ORG, check.id);
    await create.expectNameValue(check.name);
    await create.expectFrequencyPreset('30min');
    await expect(page.locator(create.locators.customIntervalField)).toHaveCount(0);
  });
});
