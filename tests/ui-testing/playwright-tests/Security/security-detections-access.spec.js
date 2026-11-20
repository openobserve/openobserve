const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe('Security detections and access', { tag: ['@security', '@enterprise', '@all'] }, () => {
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

  test('a Sigma rule written in New detection compiles against the chosen stream and is listed once saved', {
    tag: ['@securityDetections', '@P1'],
  }, async () => {
    const seed = pm.securitySeed;
    const sec = pm.securityPage;
    const marker = `${seed.fleetPrefix}detect_marker`;
    const { stream } = await seed.ingestLogonFailure('detect', { actor: 'probe', message: marker });
    const title = `${seed.fleetPrefix}custom rule`;
    const yaml = [
      `title: ${title}`,
      'level: high',
      'logsource:',
      '  product: sec_auto',
      'detection:',
      '  sel:',
      `    message|contains: ${marker}`,
      '  condition: sel',
      '',
    ].join('\n');

    await sec.goto('detections');
    await sec.openNewDetection();
    await sec.writeSigma(yaml);
    await sec.pickDetectionStream(stream);
    await sec.expectCompilesAgainst(stream);
    await sec.createDetection();
    await sec.expectDetectionListed(title, stream);

    // The dialog saves the rule as a scheduled alert on that stream; the scheduler firing it is not asserted.
    const saved = (await seed.callV2('GET', '/alerts?page_size=1000')).body?.list ?? [];
    expect(saved.filter((a) => a.name?.endsWith(`__${stream}`)).map((a) => a.folder_name)).toEqual(['Security Detections']);
  });

  test('a member without the Security grant gets the page lock naming the viewer preset; a viewer reads Detections', {
    tag: ['@securityAccess', '@P1'],
  }, async ({ browser }) => {
    const seed = pm.securitySeed;
    await seed.assertRbacEnabled();
    const none = await seed.createMember('none');
    const viewerRole = await seed.createRole('viewer', seed.viewerGrants());
    const viewer = await seed.createMember('viewer', viewerRole);

    const locked = await seed.loginAsMember(browser, none);
    try {
      const mpm = new PageManager(locked.page);
      await mpm.securityPage.goto('detections');
      await mpm.securityPage.expectSecurityLocked('Security viewer');
      // The switcher is also hidden while access is still loading, so it is checked only once the lock proves access resolved.
      await mpm.securityPage.expectSwitcherHidden();
    } finally {
      await locked.context.close();
    }

    const reader = await seed.loginAsMember(browser, viewer);
    try {
      await seed.waitForMemberStatus(reader.page, '/security/sources', 200);
      const mpm = new PageManager(reader.page);
      await mpm.securityPage.goto('detections');
      await mpm.securityPage.expectDetectionsReadable({ canCreate: false });
      await mpm.securityPage.expectSolution('Security');
    } finally {
      await reader.context.close();
    }
  });
});
