const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe('Security case queue', { tag: ['@security', '@enterprise', '@all'] }, () => {
  let pm;
  let stream;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = undefined;
    await navigateToBase(page);
    pm = new PageManager(page);
    ({ stream } = await pm.securitySeed.ingestLogonFailure('cases', { actor: 'probe', message: 'case seed' }));
  });

  test.afterEach(async () => {
    if (!pm) return;
    await pm.securitySeed.cleanup();
    expect(await pm.securitySeed.survivors()).toEqual([]);
  });

  test('closing a case records the verdict and the reason on its timeline and resolves it', {
    tag: ['@securityCases', '@P1'],
  }, async () => {
    const seed = pm.securitySeed;
    const sec = pm.securityPage;
    const target = await seed.openEventCase('close', stream);
    const reason = `${seed.fleetPrefix}closed after review`;

    await sec.goto('cases');
    await sec.searchCases(target.title);
    await sec.openCase(target.id);
    await sec.closeOpenCase('false_positive', reason);

    expect(await seed.caseStatus(target.id)).toBe('resolved');
    await sec.goto('cases', { case: target.id });
    await sec.expectTimeline(['Verdict: false positive', reason, 'Closed']);
  });

  test('merging two cases keeps the chosen one open and closes the other as a duplicate with the reason', {
    tag: ['@securityCases', '@P1'],
  }, async () => {
    const seed = pm.securitySeed;
    const sec = pm.securityPage;
    const keep = await seed.openEventCase('keep', stream);
    const dup = await seed.openEventCase('dup', stream);
    const reason = `${seed.fleetPrefix}same host`;

    await sec.goto('cases');
    await sec.searchCases(`${seed.fleetPrefix}case_`);
    await sec.expectCaseListed(keep.id, true);
    await sec.expectCaseListed(dup.id, true);
    await sec.mergeCases([keep.id, dup.id], keep.id, reason);
    await sec.expectCaseListed(dup.id, false);
    await sec.expectCaseListed(keep.id, true);

    expect(await seed.caseStatus(keep.id)).toBe('open');
    expect(await seed.caseStatus(dup.id)).toBe('resolved');
    await sec.goto('cases', { case: keep.id });
    await sec.expectTimeline([`Merged cases ${dup.id} into this case`]);
    await sec.goto('cases', { case: dup.id });
    await sec.expectTimeline(['Verdict: duplicate', `Merged into ${keep.id}: ${reason}`]);
  });
});
