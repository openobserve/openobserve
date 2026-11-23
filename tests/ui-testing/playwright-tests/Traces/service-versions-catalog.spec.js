// Copyright 2026 OpenObserve Inc.

// Services catalog version columns over spans seeded here. Enterprise-only: the probe skips on OSS and
// fails an enterprise build that does not serve the routes. Verdict cells need rollups, so none is asserted.

const { test, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ServiceVersionsPage } = require('../../pages/tracesPages/serviceVersionsPage.js');

test.describe('Service versions — catalog columns and env filter', {
  tag: ['@serviceVersions', '@traces', '@enterprise', '@P1', '@all'],
}, () => {
  test.describe.configure({ mode: 'parallel' });
  const gate = { available: false, reason: '' };
  let api;
  let fixture;
  let pm;

  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(360_000);
    api = await ServiceVersionsPage.apiContext(playwright);
    Object.assign(gate, await ServiceVersionsPage.probe(api));
    if (!gate.available) return;
    fixture = ServiceVersionsPage.fixture('cat');
    await ServiceVersionsPage.seed(api, fixture, { services: ['multi', 'noEnv'] });
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

  test('The four version column headers render and the Env, Where and Version cells show the registry values', async () => {
    const sv = pm.serviceVersionsPage;
    await sv.expectServiceRow(fixture.multi);
    await sv.expectVersionColumns();
    await sv.expectVersionCell(fixture.multi, fixture.multiVersions);
    await sv.expectWhereNamespace(fixture.multi, fixture.namespace);
    await sv.expectEnvCell(fixture.multi, 'prod');
  });

  test('A service without k8s attributes reads as outside Kubernetes', async () => {
    const sv = pm.serviceVersionsPage;
    await sv.expectServiceRow(fixture.noEnv);
    await sv.expectOutsideKubernetes(fixture.noEnv);
  });

  test('The No env option keeps the env "default" service and drops the prod one', async () => {
    const sv = pm.serviceVersionsPage;
    await sv.expectServiceRow(fixture.multi);
    await sv.expectServiceRow(fixture.noEnv);
    await sv.openEnvFilter();
    await sv.pickNoEnv();
    await sv.expectServiceRow(fixture.noEnv);
    await sv.expectNoServiceRow(fixture.multi);
  });
});
