const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe('Fleet management access', { tag: ['@fleet', '@enterprise', '@all'] }, () => {
  // Serial: the roles, users and fleets are made once in beforeAll and shared, as in IAM/iam-roles-enforcement.spec.js.
  test.describe.configure({ mode: 'serial' });

  let seed;
  let fleetA;
  const members = {};

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      const setup = new PageManager(page);
      await setup.fleetManagerPage.assertEnabled();
      seed = setup.fleetSeed;
      await seed.assertRbacEnabled();
      fleetA = await seed.createFleet('a');
      const reader = await seed.createRole('reader', [
        seed.orgGrant('fleets', 'AllowList'),
        seed.orgGrant('fleets', 'AllowGet'),
        seed.orgGrant('fleet_configs', 'AllowGet'),
        seed.orgGrant('fleet_management', 'AllowGet'),
      ]);
      const listOnly = await seed.createRole('list_only', [seed.orgGrant('fleets', 'AllowList')]);
      members.none = await seed.createMember('none');
      members.reader = await seed.createMember('reader', reader);
      members.listOnly = await seed.createMember('list_only', listOnly);
      testLogger.info('Fleet access fixtures ready', { fleetA: fleetA.id });
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
    // The beforeAll page that seeded the fixtures is closed, so seed API calls need this test's live page.
    seed.setPage(page);
  });

  test('FL-RBAC-02 · a member without fleet grants gets the no-access states', {
    tag: ['@fleetAccess', '@P0'],
  }, async ({ browser }) => {
    const member = await seed.loginAsMember(browser, members.none);
    try {
      const mpm = new PageManager(member.page);
      await mpm.fleetManagerPage.gotoFleet({ tab: 'fleets' });
      await mpm.fleetManagerPage.expectFleetNoAccess();
      await mpm.fleetManagerPage.expectCollectorsForbidden();
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

  test('FL-RBAC-08 · a member without GET on a fleet sees "You can see this fleet, but not its collectors or versions"', {
    tag: ['@fleetAccess', '@P2'],
  }, async ({ browser }) => {
    // With O2_OPENFGA_LIST_ONLY_PERMITTED off (this shard), LIST adds nothing over no grant; this proves the no-GET panel only.
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
});
