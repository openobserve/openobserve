// Copyright 2026 OpenObserve Inc.

// Version compare drawer opened from the Versions tab. Enterprise-only via the probe. Verdicts, tiles and
// deploy markers need rollups that take ~40 min to warm up, so only the drawer and its deep link are asserted.

const { test, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ServiceVersionsPage } = require('../../pages/tracesPages/serviceVersionsPage.js');

test.describe('Service versions — compare drawer', {
  tag: ['@serviceVersions', '@traces', '@enterprise', '@P1', '@all'],
}, () => {
  const gate = { available: false, reason: '' };
  let api;
  let fixture;
  let rows;
  let pm;

  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(360_000);
    api = await ServiceVersionsPage.apiContext(playwright);
    Object.assign(gate, await ServiceVersionsPage.probe(api));
    if (!gate.available) return;
    fixture = ServiceVersionsPage.fixture('cmp');
    rows = await ServiceVersionsPage.seed(api, fixture, { services: ['multi'] });
  });

  test.afterAll(async () => {
    if (gate.available && fixture) await ServiceVersionsPage.deleteSeeded(api, fixture);
    await api?.dispose();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    test.skip(!gate.available, gate.reason);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.serviceVersionsPage.gotoCatalog();
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('Two ticked versions open the drawer, a third is blocked, and a reload reopens it', async () => {
    const sv = pm.serviceVersionsPage;
    const [first, second, third] = fixture.multiVersions.map((version) => rows.multi[version].version_key);
    await sv.expectServiceRow(fixture.multi);
    await sv.openVersionsTab(fixture.multi);

    await sv.selectVersion(first);
    await sv.selectVersion(second);
    await sv.expectVersionSelectBlocked(third);
    await sv.compareSelected();

    await sv.expectDrawerOpen();
    await sv.expectCompareUrl(fixture.multi, fixture.multiVersions.slice(0, 2));
    await sv.reload();
    await sv.expectDrawerOpen();
    await sv.expectCompareUrl(fixture.multi, fixture.multiVersions.slice(0, 2));
  });
});
