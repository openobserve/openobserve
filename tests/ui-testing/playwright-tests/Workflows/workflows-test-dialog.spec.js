/**
 * Workflows v1 — the Test drawer (TST-*)
 *
 * Enterprise-only. Reworked in #14027: a rehearsal can now take its payload from the
 * seeded sample OR from a previous run, start from a chosen step, and — critically —
 * suppresses destinations BY DEFAULT so testing a workflow cannot post to production.
 *
 * That default is the safety property worth pinning: only the suppressed state is safe,
 * and turning it off must warn before anything is dispatched. These tests exercise the
 * controls WITHOUT running, so they stay fast and never send.
 *
 * Self-cleaning: every artifact is namespaced `wf_auto_*`; cleanup.spec.js sweeps by prefix.
 */

const { test, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

const uniq = () => `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;
const URL_STUB = 'https://example.com/wf-test-drawer';

test.describe.configure({ mode: 'parallel' });

test.describe('Workflows test drawer', { tag: ['@workflows', '@enterprise', '@all'] }, () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.workflowsPage.assertEnabled();
    await pm.workflowsPage.goToAdd();
    await pm.workflowsPage.setName(`wf_auto_tst_${uniq()}`);
    await pm.workflowsPage.addNodeFromPalette('destination');
    await pm.workflowsPage.createDestinationInline({ name: `wf_auto_dest_${uniq()}`, url: URL_STUB });
    await pm.workflowsPage.saveNodeDrawer();
  });

  // TST-01 — the drawer opens and offers a payload source. Without this control a
  // rehearsal can only ever use the seeded sample.
  test('TST-01: the test drawer offers an input source', { tag: ['@workflowsTestDrawer'] }, async () => {
    await pm.workflowsPage.openTestDrawer();
    await pm.workflowsPage.expectTestControl(pm.workflowsPage.testInputSource);
  });

  // TST-06 — a rehearsal can start partway down the graph, which is what makes debugging
  // a long workflow cheap.
  test('TST-06: the test drawer offers a run-from step', { tag: ['@workflowsTestDrawer'] }, async () => {
    await pm.workflowsPage.openTestDrawer();
    await pm.workflowsPage.expectTestControl(pm.workflowsPage.testRunFrom);
  });

  // TST-04 — reset-to-sample is the escape hatch after editing the payload by hand.
  test('TST-04: reset to sample is offered', { tag: ['@workflowsTestDrawer'] }, async () => {
    await pm.workflowsPage.openTestDrawer();
    await pm.workflowsPage.expectTestControl(pm.workflowsPage.testResetSample);
  });

  // TST-05a — destinations are suppressed by DEFAULT. This is the safety property: opening
  // the drawer and pressing Run must not be able to post to a live endpoint.
  test('TST-05a: destinations are suppressed by default', { tag: ['@workflowsTestDrawer'] }, async () => {
    await pm.workflowsPage.openTestDrawer();
    await pm.workflowsPage.expectSuppressDestinations(true);
    await pm.workflowsPage.expectNoDispatchWarning();
  });

  // TST-05b — turning suppression off means a rehearsal WILL send for real, so the drawer
  // has to say so before the author presses Run.
  test('TST-05b: un-suppressing destinations warns that the run will dispatch', { tag: ['@workflowsTestDrawer'] }, async () => {
    await pm.workflowsPage.openTestDrawer();
    await pm.workflowsPage.setSuppressDestinations(false);
    await pm.workflowsPage.expectDispatchWarning();
  });
});
