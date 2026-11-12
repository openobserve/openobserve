const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const FleetInstallPage = require('../../../pages/fleetPages/fleetInstallPage.js');

test.describe('Fleet management Add collector regressions', { tag: ['@fleet', '@enterprise', '@all'] }, () => {
  test.describe.configure({ mode: 'parallel' });

  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    // Cleared first so a failed navigation never leaves afterEach the previous test's closed page.
    pm = undefined;
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.fleetManagerPage.assertEnabled();
  });

  test.afterEach(async () => {
    if (!pm) return;
    await pm.fleetSeed.cleanup();
    expect(await pm.fleetSeed.survivors()).toEqual([]);
  });

  test('R-16042 · a Kubernetes cluster name becomes --set-string clusterName with commas escaped; empty adds no flag', {
    tag: ['@fleetInstall', '@regression', '@P2'],
  }, async () => {
    const fleet = await pm.fleetSeed.createFleet('cluster');
    const token = await pm.fleetSeed.createToken(fleet.id, 'tok');
    await pm.fleetManagerPage.gotoFleet({ tab: 'fleets', fleet: fleet.id });
    await pm.fleetFleetsPage.openAddCollector();
    await pm.fleetInstallPage.expectCommandShown();
    await pm.fleetInstallPage.selectPlatform('kubernetes');
    const target = { ...(await pm.fleetInstallPage.installTarget(pm.fleetSeed, token.token)), http: true, role: 'agent' };
    await pm.fleetInstallPage.revealToken();

    await pm.fleetInstallPage.setClusterName('prod,us-east');
    const withName = FleetInstallPage.expectedInstallLines('kubernetes', { ...target, clusterName: 'prod,us-east' });
    expect(withName).toContain("  --set-string clusterName='prod\\,us-east' \\");
    await pm.fleetInstallPage.expectCommandLines(withName);

    await pm.fleetInstallPage.setClusterName('');
    const withoutName = FleetInstallPage.expectedInstallLines('kubernetes', target);
    expect(withoutName.some((line) => line.includes('clusterName'))).toBe(false);
    await pm.fleetInstallPage.expectCommandLines(withoutName);
  });

  test('R-3311-9 · the token form leaves Max uses empty, so a token created with defaults has no enrollment limit', {
    tag: ['@fleetInstall', '@regression', '@P2'],
  }, async () => {
    const fleet = await pm.fleetSeed.createFleet('unlimited');
    await pm.fleetManagerPage.gotoFleet({ tab: 'fleets', fleet: fleet.id });
    await pm.fleetFleetsPage.openAddCollector();
    await pm.fleetInstallPage.expectNoTokenState();
    // Spec §5: maximum enrollments is optional; the field's help text says empty is unlimited.
    await pm.fleetInstallPage.expectInlineMaxUses('');

    const created = await pm.fleetInstallPage.createInlineTokenAndAwaitCollectorsPoll(pm.fleetSeed.fleetName('unlimited'));
    expect(created.max_uses).not.toBe(100);
    expect(created.max_uses).toBeNull();
  });
});
