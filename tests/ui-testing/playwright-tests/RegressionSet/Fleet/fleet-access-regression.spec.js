const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

test.describe('Fleet management access regressions', { tag: ['@fleet', '@enterprise', '@all'] }, () => {
  // Serial: the roles, users and fleets are made once in beforeAll and shared, as in Fleet/fleet-access.spec.js.
  test.describe.configure({ mode: 'serial' });

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
      const aWriter = await seed.createRole('a_writer', [seed.fleetGrant(fleetA.id, 'AllowAll')]);
      members.none = await seed.createMember('none');
      members.aWriter = await seed.createMember('a_writer', aWriter);
      testLogger.info('Fleet access regression fixtures ready', { fleetA: fleetA.id, fleetB: fleetB.id });
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

  test('R-16105a · a member without fleet grants sees no pipelines error banner on the Overview', {
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
});
