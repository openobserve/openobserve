const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe('Fleet management access', { tag: ['@fleet', '@enterprise', '@all'] }, () => {
  // Serial: the roles, users and fleets are made once in beforeAll and shared, as in IAM/iam-roles-enforcement.spec.js.
  test.describe.configure({ mode: 'serial' });

  let pm;
  let seed;
  let fleetA;
  let fleetB;
  const members = {};

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      const setup = new PageManager(page);
      await setup.fleetManagerPage.assertEnabled();
      seed = setup.fleetSeed;
      await seed.assertRbacEnabled();
      fleetA = await seed.createFleet('a');
      fleetB = await seed.createFleet('b');
      const reader = await seed.createRole('reader', [
        seed.orgGrant('fleets', 'AllowList'),
        seed.orgGrant('fleets', 'AllowGet'),
        seed.orgGrant('fleet_configs', 'AllowGet'),
        seed.orgGrant('fleet_management', 'AllowGet'),
      ]);
      const aWriter = await seed.createRole('a_writer', [seed.fleetGrant(fleetA.id, 'AllowAll')]);
      const listOnly = await seed.createRole('list_only', [seed.orgGrant('fleets', 'AllowList')]);
      members.none = await seed.createMember('none');
      members.reader = await seed.createMember('reader', reader);
      members.aWriter = await seed.createMember('a_writer', aWriter);
      members.listOnly = await seed.createMember('list_only', listOnly);
      testLogger.info('Fleet access fixtures ready', { fleetA: fleetA.id, fleetB: fleetB.id });
    } finally {
      await page.close();
    }
  });

  test.afterAll(async ({ browser }) => {
    if (!seed) return;
    const page = await browser.newPage();
    try {
      seed.setPage(page);
      await seed.cleanup();
      expect(await seed.survivors()).toEqual([]);
    } finally {
      await page.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test('FL-RBAC-02 + R-16105a · a member without fleet grants gets the no-access states and no pipelines error banner', {
    tag: ['@fleetAccess', '@regression', '@P0'],
  }, async ({ browser }) => {
    const member = await seed.loginAsMember(browser, members.none);
    try {
      const mpm = new PageManager(member.page);
      await mpm.fleetManagerPage.gotoFleet({ tab: 'fleets' });
      await mpm.fleetManagerPage.expectFleetNoAccess();
      await mpm.fleetManagerPage.expectCollectorsForbidden();

      await mpm.fleetManagerPage.clickTab('overview');
      await mpm.fleetManagerPage.expectOverviewNoFleetsWithoutErrorBanner();
    } finally {
      await member.context.close();
    }
  });

  test('FL-RBAC-03 + R-16105b · a reader clicking New fleet gets "You don\'t have permission to do this" and nothing is created', {
    tag: ['@fleetAccess', '@regression', '@P0'],
  }, async ({ browser }) => {
    const member = await seed.loginAsMember(browser, members.reader);
    try {
      await seed.waitForMemberStatus(member.page, `/fleet/fleets/${fleetA.id}`, 200);
      const mpm = new PageManager(member.page);
      const refused = seed.fleetName('refused');
      await mpm.fleetManagerPage.gotoFleet({ tab: 'fleets', fleet: fleetA.id });
      await mpm.fleetFleetsPage.expectPanelFor(fleetA.name);
      await mpm.fleetManagerPage.clickCreate('fleets');
      await mpm.fleetFleetsPage.submitNewFleet(refused);
      await mpm.fleetManagerPage.expectErrorToast("You don't have permission to do this");
      await seed.expectNoFleetNamed(refused);
    } finally {
      await member.context.close();
    }
  });

  test('R-3232-ui · a writer of fleet A only can open the Fleets tab and read fleet A, not fleet B', {
    tag: ['@fleetAccess', '@regression', '@P0'],
  }, async ({ browser }) => {
    const member = await seed.loginAsMember(browser, members.aWriter);
    try {
      await seed.waitForMemberStatus(member.page, `/fleet/fleets/${fleetA.id}`, 200);
      const mpm = new PageManager(member.page);
      await mpm.fleetManagerPage.gotoFleet({ tab: 'fleets', fleet: fleetA.id });
      await mpm.fleetFleetsPage.expectPanelFor(fleetA.name);
      await mpm.fleetManagerPage.expectCollectorsNotForbidden();
      await mpm.fleetFleetsPage.expectRailItemReadable(fleetA.id, true);
      await mpm.fleetFleetsPage.expectRailItemReadable(fleetB.id, false);

      await mpm.fleetManagerPage.gotoFleet({ tab: 'fleets', fleet: fleetB.id });
      await mpm.fleetManagerPage.expectFleetNoAccess();
    } finally {
      await member.context.close();
    }
  });

  test('FL-RBAC-08 · a LIST-only member sees "You can see this fleet, but not its collectors or versions"', {
    tag: ['@fleetAccess', '@P2'],
  }, async ({ browser }) => {
    const member = await seed.loginAsMember(browser, members.listOnly);
    try {
      const mpm = new PageManager(member.page);
      await mpm.fleetManagerPage.gotoFleet({ tab: 'fleets', fleet: fleetA.id });
      await mpm.fleetManagerPage.expectFleetNoAccess('You can see this fleet, but not its collectors or versions');
      await mpm.fleetFleetsPage.expectRailItemReadable(fleetA.id, false);
    } finally {
      await member.context.close();
    }
  });

  test('R-16104c · the Settings tab has no "Alerts for fleets" section', {
    tag: ['@fleetAccess', '@regression', '@P2'],
  }, async () => {
    await pm.fleetManagerPage.gotoFleet({ tab: 'settings' });
    await pm.fleetManagerPage.expectTabActive('settings');
    await pm.fleetManagerPage.expectSettingsWithoutFleetAlerts(['Alerts for fleets', 'Open the alert library']);
  });

  test('R-16105c · collectors "Reset to default" keeps Architecture and Last connected from hidden', {
    tag: ['@fleetAccess', '@regression', '@P3'],
  }, async () => {
    await pm.fleetManagerPage.gotoFleet({ tab: 'fleets', fleet: fleetA.id });
    await pm.fleetFleetsPage.expectPanelFor(fleetA.name);
    await pm.fleetManagerPage.expectColumnChecked('arch', false);
    await pm.fleetManagerPage.expectColumnChecked('lastConnectedFrom', false);

    await pm.fleetManagerPage.toggleColumn('os');
    await pm.fleetManagerPage.expectColumnChecked('os', false);
    await pm.fleetManagerPage.expectColumnShown('os', false);

    await pm.fleetManagerPage.resetColumns();
    await pm.fleetManagerPage.expectColumnChecked('os', true);
    await pm.fleetManagerPage.expectColumnChecked('arch', false);
    await pm.fleetManagerPage.expectColumnChecked('lastConnectedFrom', false);
    await pm.fleetManagerPage.expectColumnShown('os', true);
    await pm.fleetManagerPage.expectColumnShown('arch', false);
    await pm.fleetManagerPage.expectColumnShown('lastConnectedFrom', false);
  });
});
