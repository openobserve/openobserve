// Copyright 2026 OpenObserve Inc.

// An env override set from a catalog env chip, then removed, restored and removed again in
// Settings → Correlation → Environments & versions. Enterprise-only via the probe.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ServiceVersionsPage } = require('../../pages/tracesPages/serviceVersionsPage.js');

test.describe('Service versions — env overrides settings', {
  tag: ['@serviceVersions', '@traces', '@enterprise', '@P1', '@all'],
}, () => {
  const gate = { available: false, reason: '' };
  let api;
  let fixture;
  let whereKey;
  let pm;

  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(360_000);
    api = await playwright.request.newContext();
    Object.assign(gate, await ServiceVersionsPage.probe(api));
    if (!gate.available) return;
    fixture = ServiceVersionsPage.fixture('env');
    const rows = await ServiceVersionsPage.seed(api, fixture, { services: ['single'] });
    whereKey = rows.single[fixture.singleVersion].where_key;
  });

  test.afterAll(async () => {
    if (whereKey) {
      for (const row of await ServiceVersionsPage.overridesFor(api, whereKey)) {
        await ServiceVersionsPage.deleteOverride(api, row.rule_key);
      }
    }
    await api?.dispose();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    test.skip(!gate.available, gate.reason);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('An override set from the env chip is listed, removed, restored by Undo and removed again', async () => {
    const sv = pm.serviceVersionsPage;
    const env = `e2eqa${Date.now().toString(36)}`;
    await sv.gotoCatalog();
    await sv.expectServiceRow(fixture.single);
    await sv.setEnvFromChip(fixture.single, env);
    await sv.expectEnvCell(fixture.single, env);

    const saved = await ServiceVersionsPage.overridesFor(api, whereKey);
    expect(saved.map((row) => row.value)).toEqual([env]);
    const ruleKey = saved[0].rule_key;

    await sv.gotoEnvSettings();
    await sv.expectOverrideListed(ruleKey);
    await sv.removeOverride(ruleKey);
    await sv.undoRemove();
    await sv.expectOverrideListed(ruleKey);
    expect((await ServiceVersionsPage.overridesFor(api, whereKey)).map((row) => row.rule_key)).toEqual([ruleKey]);

    await sv.removeOverride(ruleKey);
    await expect.poll(async () => (await ServiceVersionsPage.overridesFor(api, whereKey)).length, {
      message: 'the override is gone server-side',
      timeout: 15_000,
    }).toBe(0);
  });
});
