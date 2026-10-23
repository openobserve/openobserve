// Copyright 2026 OpenObserve Inc.
//
// Running Queries Cancel (org-scoped) — E2E tests for the cancel flow on the
// Settings → Query Management page. The cancel contract changed from a bare
// trace-id list to org-scoped pairs [{ trace_id, org_id }], and the frontend was
// reworked to carry org_id per query and key table rows by `${org_id}/${trace_id}`.
// These tests assert the exact cancel PUT body the frontend sends on each path.
//
// The Running Queries page is enterprise-only and meta-org-only, so every test
// skips on an OSS build. No real running queries are required: the status list is
// stubbed and the cancel PUT is intercepted to read its body.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Running Queries Cancel testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  test("should cancel only the chosen org's copy when the same trace_id runs in two orgs", {
    tag: ['@running-queries-cancel', '@all', '@enterprise', '@P0']
  }, async ({ page }) => {
    const edition = await pm.editionFeaturesPage.detectEdition();
    test.skip(edition === 'opensource', `Query Management is enterprise-only (detected: ${edition})`);

    await pm.queryManagementPage.stubRunningQueries('_meta', [
      pm.queryManagementPage.runningQuery('shared-trace', 'org-a', 'a@example.com'),
      pm.queryManagementPage.runningQuery('shared-trace', 'org-b', 'b@example.com'),
    ]);
    await pm.queryManagementPage.stubCancel('_meta');

    await pm.queryManagementPage.navigateToRunningQueries('_meta');
    await pm.queryManagementPage.selectQueryTypeTab('all');

    const bodyPromise = pm.queryManagementPage.captureCancelRequest('_meta');
    await pm.queryManagementPage.cancelAllQueriesRow('org-a');
    await pm.queryManagementPage.confirmCancel();

    const body = await bodyPromise;
    expect(body).toEqual([{ trace_id: 'shared-trace', org_id: 'org-a' }]);
    testLogger.info('Cancel payload scoped to the chosen org only');
  });

  test("should send each selected row's org-scoped pair on bulk cancel", {
    tag: ['@running-queries-cancel', '@all', '@enterprise', '@P1']
  }, async ({ page }) => {
    const edition = await pm.editionFeaturesPage.detectEdition();
    test.skip(edition === 'opensource', `Query Management is enterprise-only (detected: ${edition})`);

    await pm.queryManagementPage.stubRunningQueries('_meta', [
      pm.queryManagementPage.runningQuery('trace-a', 'org-a', 'a@example.com'),
      pm.queryManagementPage.runningQuery('trace-b', 'org-b', 'b@example.com'),
      pm.queryManagementPage.runningQuery('trace-c', 'org-c', 'c@example.com'),
    ]);
    await pm.queryManagementPage.stubCancel('_meta');

    await pm.queryManagementPage.navigateToRunningQueries('_meta');
    await pm.queryManagementPage.selectQueryTypeTab('all');

    await pm.queryManagementPage.selectAllQueriesRow('org-a');
    await pm.queryManagementPage.selectAllQueriesRow('org-b');

    const bodyPromise = pm.queryManagementPage.captureCancelRequest('_meta');
    await pm.queryManagementPage.clickAllQueriesMultiCancel();
    await pm.queryManagementPage.confirmCancel();

    const body = await bodyPromise;
    expect(body).toHaveLength(2);
    expect(body).toEqual(expect.arrayContaining([
      expect.objectContaining({ trace_id: 'trace-a', org_id: 'org-a' }),
      expect.objectContaining({ trace_id: 'trace-b', org_id: 'org-b' }),
    ]));
    testLogger.info('Bulk cancel payload carries each selected row org-scoped pair');
  });

  test("should flatten a user's queries across orgs into org-scoped pairs on summary cancel", {
    tag: ['@running-queries-cancel', '@all', '@enterprise', '@P1']
  }, async ({ page }) => {
    const edition = await pm.editionFeaturesPage.detectEdition();
    test.skip(edition === 'opensource', `Query Management is enterprise-only (detected: ${edition})`);

    await pm.queryManagementPage.stubRunningQueries('_meta', [
      pm.queryManagementPage.runningQuery('trace-a', 'org-a', 'same@example.com'),
      pm.queryManagementPage.runningQuery('trace-b', 'org-b', 'same@example.com'),
    ]);
    await pm.queryManagementPage.stubCancel('_meta');

    await pm.queryManagementPage.navigateToRunningQueries('_meta');

    const bodyPromise = pm.queryManagementPage.captureCancelRequest('_meta');
    await pm.queryManagementPage.cancelSummaryRow('same@example.com');
    await pm.queryManagementPage.confirmCancel();

    const body = await bodyPromise;
    expect(body).toHaveLength(2);
    expect(body).toEqual(expect.arrayContaining([
      expect.objectContaining({ trace_id: 'trace-a', org_id: 'org-a' }),
      expect.objectContaining({ trace_id: 'trace-b', org_id: 'org-b' }),
    ]));
    testLogger.info('Summary cancel payload flattens every query into org-scoped pairs');
  });

  test("should not fire a cancel request when the confirm dialog is dismissed", {
    tag: ['@running-queries-cancel', '@all', '@enterprise', '@P2']
  }, async ({ page }) => {
    const edition = await pm.editionFeaturesPage.detectEdition();
    test.skip(edition === 'opensource', `Query Management is enterprise-only (detected: ${edition})`);

    await pm.queryManagementPage.stubRunningQueries('_meta', [
      pm.queryManagementPage.runningQuery('trace-a', 'org-a', 'a@example.com'),
    ]);
    await pm.queryManagementPage.stubCancel('_meta');

    await pm.queryManagementPage.navigateToRunningQueries('_meta');
    await pm.queryManagementPage.selectQueryTypeTab('all');

    const watcher = pm.queryManagementPage.startCancelWatcher('_meta');
    await pm.queryManagementPage.cancelAllQueriesRow('org-a');
    await pm.queryManagementPage.dismissCancelDialog();
    await pm.queryManagementPage.expectConfirmDialogHidden();

    const cancelFired = await watcher.stop();
    expect(cancelFired).toBe(false);
    testLogger.info('Dismissing the confirm dialog issued no cancel request');
  });
});
