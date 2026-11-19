// Copyright 2026 OpenObserve Inc.

// Service panel Versions tab over spans seeded here. Enterprise-only: the probe skips on OSS and fails an
// enterprise build that does not serve the routes.

const { test, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ServiceVersionsPage } = require('../../pages/tracesPages/serviceVersionsPage.js');

test.describe('Service versions — service panel Versions tab', {
  tag: ['@serviceVersions', '@traces', '@enterprise', '@P1', '@all'],
}, () => {
  test.describe.configure({ mode: 'parallel' });
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
    fixture = ServiceVersionsPage.fixture('panel');
    rows = await ServiceVersionsPage.seed(api, fixture, { services: ['multi', 'single'] });
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

  test('A one-version service lists that version and keeps Compare disabled with a hint', async () => {
    const sv = pm.serviceVersionsPage;
    await sv.expectServiceRow(fixture.single);
    await sv.openVersionsTab(fixture.single);
    await sv.expectVersionRows([rows.single[fixture.singleVersion].version_key]);
    await sv.expectCompareDisabled();
    await sv.expectOnlyOneVersionHint();
  });

  test('A three-version service lists every version in the tab', async () => {
    const sv = pm.serviceVersionsPage;
    await sv.expectServiceRow(fixture.multi);
    await sv.openVersionsTab(fixture.multi);
    await sv.expectVersionRows(fixture.multiVersions.map((version) => rows.multi[version].version_key));
    await sv.expectCompareDisabled();
  });
});
