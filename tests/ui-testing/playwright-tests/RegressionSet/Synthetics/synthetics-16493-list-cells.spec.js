const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const {
  assertSyntheticsEnabled,
  ensureSyntheticsLocation,
  createCheck,
  createLocation,
  seedRuns,
  uniqueName,
  cleanupWorkerEntities,
} = require('../../utils/synthetics-helpers.js');

const ORG = process.env['ORGNAME'];
const TAGS = ['@bug-16493', '@P2', '@regression', '@syntheticsRegression'];
const LOCATION_COUNT = 6;

test.describe('Synthetics list cells read well and fit their column (#16493)', () => {
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

  test(
    'response times read as ms or s, and a browser check carries no latency colour',
    { tag: TAGS },
    async ({ page }, testInfo) => {
      const stem = uniqueName('rt', testInfo);
      const fast = await createCheck(page, 'http', testInfo, { name: `${stem}_fast`, locations: [locationId] });
      const slow = await createCheck(page, 'http', testInfo, { name: `${stem}_slow`, locations: [locationId] });
      const journey = await createCheck(page, 'browser', testInfo, {
        name: `${stem}_journey`,
        locations: [locationId],
      });
      testLogger.info('Seeding one run per check with a known response time');
      await seedRuns(page, fast, [{ template: 'http_passed', overrides: { response_time_ms: 85 } }]);
      await seedRuns(page, slow, [{ template: 'http_passed', overrides: { response_time_ms: 62580 } }]);
      await seedRuns(page, journey, [{ template: 'browser_passed', overrides: { response_time_ms: 85 } }]);

      const list = pm.syntheticsListPage;
      await list.goto(ORG);
      await list.search(stem);
      await list.expectRowCount(3);
      await list.expectResponseTime(fast.id, '85 ms', 'success');
      await list.expectResponseTime(slow.id, '62.58 s', 'error');
      await list.expectResponseTime(journey.id, '85 ms', null);
    },
  );

  test(
    'widening the Locations column shows more names and shrinks the +N',
    { tag: TAGS },
    async ({ page }, testInfo) => {
      const locationIds = [];
      for (let i = 0; i < LOCATION_COUNT; i++) {
        const region = uniqueName(`fit${i}`, testInfo);
        const { status, body } = await createLocation(page, {
          kind: 'public',
          provider: 'e2e',
          region,
          label: region,
          enabled: true,
        });
        expect(status, JSON.stringify(body)).toBe(200);
        locationIds.push(body.location.id);
      }
      const check = await createCheck(page, 'http', testInfo, { locations: locationIds });

      const list = pm.syntheticsListPage;
      await list.goto(ORG);
      await list.search(check.name);
      await list.expectRowVisible(check.id);
      await expect.poll(() => list.hiddenLocationCount(check.id), { timeout: 15000 }).toBeGreaterThan(0);
      const hiddenBefore = await list.hiddenLocationCount(check.id);
      testLogger.info('Locations hidden behind +N before widening', { hiddenBefore });

      await list.widenColumn('locations', 700);
      await expect.poll(() => list.hiddenLocationCount(check.id), { timeout: 15000 }).toBeLessThan(hiddenBefore);
    },
  );
});
