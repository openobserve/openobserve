const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe('Security solution switcher and Events', { tag: ['@security', '@enterprise', '@all'] }, () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = undefined;
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterEach(async () => {
    if (!pm) return;
    await pm.securitySeed.cleanup();
    expect(await pm.securitySeed.survivors()).toEqual([]);
  });

  test('the header switcher opens Security, Events shows a seeded OCSF event normalised, and switches back', {
    tag: ['@securityEvents', '@P1'],
  }, async ({ page }) => {
    const sec = pm.securityPage;
    const marker = `${pm.securitySeed.fleetPrefix}logon_marker`;
    const actor = `${pm.securitySeed.fleetPrefix}analyst`;
    const seeded = await pm.securitySeed.ingestLogonFailure('ocsf', { actor, message: marker });

    await sec.expectSolution('Observability');
    await sec.switchSolution('security');
    await expect(page).toHaveURL(/\/web\/security\/overview/);
    await sec.expectSolution('Security');

    await sec.openNav('/security/events');
    await sec.selectEventsStream(seeded.stream);
    await sec.expectEventRow(marker, {
      className: 'Authentication',
      activity: 'Logon',
      statusId: 'Failure',
      severityId: 'High',
      actor,
      srcIp: seeded.srcIp,
    });

    await sec.switchSolution('observability');
    await expect(page).not.toHaveURL(/\/web\/security/);
    await sec.expectSolution('Observability');
    await expect(sec.navItem('/security/events')).toHaveCount(0);
  });
});
