const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const {
  assertSyntheticsEnabled,
  uniqueName,
  createLocation,
  cleanupWorkerEntities,
} = require('../../utils/synthetics-helpers.js');

const META_ORG = '_meta';
const TAGS = ['@bug-16308', '@P2', '@regression', '@syntheticsRegression'];

test.describe('Add Location offers only AWS as the provider (#16308)', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' });
    const page = await context.newPage();
    await assertSyntheticsEnabled(page);
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

  test('the add form lists AWS and nothing else', { tag: TAGS }, async () => {
    const settings = pm.syntheticsSettingsPage;
    await settings.gotoLocations(META_ORG);
    await settings.openAddForm();
    testLogger.info('Reading the provider options of the add form');
    expect(await settings.offeredProviders()).toEqual(['aws']);
  });

  test('editing a GCP location still names its provider, locked', { tag: TAGS }, async ({ page }, testInfo) => {
    const region = uniqueName('loc', testInfo);
    const { status, body } = await createLocation(page, {
      kind: 'public',
      provider: 'gcp',
      region,
      label: `E2E ${region}`,
      enabled: true,
    });
    expect(status, JSON.stringify(body)).toBe(200);
    const settings = pm.syntheticsSettingsPage;
    testLogger.info('Opening a location saved with another provider', { id: body.location.id });
    await settings.gotoLocations(META_ORG);
    await settings.openEditForm(body.location.id);
    await settings.expectProviderLocked('GCP');
  });
});
