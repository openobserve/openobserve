const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const {
  assertSyntheticsEnabled,
  ensureSyntheticsLocation,
  createCheck,
  getCheck,
  uniqueName,
  findCheckByName,
  cleanupWorkerEntities,
} = require('../../utils/synthetics-helpers.js');

const ORG = process.env['ORGNAME'];
const TAGS = ['@bug-16181', '@P1', '@regression', '@syntheticsRegression'];
const BROWSER_ZONE = 'Asia/Kolkata';
const CRON_ZONE = 'America/New_York';
const CRON = '0 0 9 * * *';

test.describe('A cron check keeps its chosen time zone (#16181)', () => {
  test.describe.configure({ mode: 'parallel' });
  // A browser already in the cron zone would hide an overwrite with the browser zone.
  test.use({ timezoneId: BROWSER_ZONE });
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

  test(
    'a new cron check saves and reopens with the zone picked in the editor',
    { tag: TAGS },
    async ({ page }, testInfo) => {
      const create = pm.syntheticsCreatePage;
      const name = uniqueName('cron_tz', testInfo);
      testLogger.info('Creating a cron check in a zone other than the browser zone', { name, zone: CRON_ZONE });
      await create.gotoCreate(ORG, 'http');
      await create.fillName(name);
      await create.fillTarget('https://example.com');
      await create.setCron(CRON);
      await create.setCronTimezone(CRON_ZONE);
      await create.selectLocation(locationId);
      await create.setEnabled(false);
      const { payload, status } = await create.saveCapturingPayload();
      expect(status).toBe(200);
      expect(payload.frequency).toMatchObject({ type: 'cron', cron: CRON, timezone: CRON_ZONE });
      await create.expectSavedAndListed();

      const saved = await findCheckByName(page, name);
      expect(saved.frequency.timezone).toBe(CRON_ZONE);

      testLogger.info('Reopening the check', { id: saved.id });
      await create.gotoEdit(ORG, saved.id);
      await create.expectNameValue(name);
      await create.expectFrequencyPreset('cron');
      await create.expectCronTimezone(CRON_ZONE);
    },
  );

  test('editing a cron check keeps its stored zone on save', { tag: TAGS }, async ({ page }, testInfo) => {
    const create = pm.syntheticsCreatePage;
    const check = await createCheck(page, 'http', testInfo, {
      locations: [locationId],
      frequency: { type: 'cron', interval: 0, cron: CRON, timezone: CRON_ZONE },
    });
    testLogger.info('Renaming a cron check and saving it', { id: check.id });
    await create.gotoEdit(ORG, check.id);
    await create.expectNameValue(check.name);
    await create.expectCronTimezone(CRON_ZONE);
    await create.fillName(`${check.name}_renamed`);
    const { payload, status } = await create.saveCapturingPayload();
    expect(status).toBe(200);
    expect(payload.frequency.timezone).toBe(CRON_ZONE);
    await create.expectUpdatedAndListed();

    const { body } = await getCheck(page, check.id);
    expect(body.name).toBe(`${check.name}_renamed`);
    expect(body.frequency).toMatchObject({ type: 'cron', cron: CRON, timezone: CRON_ZONE });
  });
});
