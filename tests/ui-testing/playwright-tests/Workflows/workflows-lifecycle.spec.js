/**
 * Workflows v1 — draft lifecycle and list operations (DRF-*, EDT-*, LST-*)
 *
 * Enterprise-only. Two surfaces that shipped without coverage:
 *
 *  - The DRAFT mode switch. A draft offers Save-as-Draft + Publish and skips the
 *    connectivity checks so a half-built graph can be parked; a published workflow offers
 *    Save + History instead and is validated on every save. Which controls exist IS the
 *    mode, so the tests assert on the controls rather than on a flag.
 *  - The list row: pause/resume, delete, read-only view, and the draft/trigger tags
 *    (#14260, #14315 and #14356 all landed here with no test).
 *
 * Self-cleaning: every artifact is namespaced `wf_auto_*`; cleanup.spec.js sweeps by prefix.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

const uniq = () => `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;
const URL_STUB = 'https://example.com/wf-lifecycle';

test.describe.configure({ mode: 'parallel' });

test.describe('Workflows lifecycle & list', { tag: ['@workflows', '@enterprise', '@all'] }, () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.workflowsPage.assertEnabled();
  });

  /** A complete, publishable graph: trigger -> configured destination. */
  const buildGraph = async (name) => {
    await pm.workflowsPage.goToAdd();
    await pm.workflowsPage.setName(name);
    await pm.workflowsPage.addNodeFromPalette('destination');
    await pm.workflowsPage.createDestinationInline({ name: `wf_auto_dest_${uniq()}`, url: URL_STUB });
    await pm.workflowsPage.saveNodeDrawer();
  };

  // DRF-01 — Save as Draft parks the graph and marks it a draft in both places the user
  // looks: the row in the list, and the editor header when it is reopened.
  test('DRF-01: Save as Draft tags the workflow in the list and the editor', { tag: ['@workflowsLifecycle'] }, async () => {
    const name = `wf_auto_drf_${uniq()}`;
    await buildGraph(name);
    await pm.workflowsPage.saveAsDraft();

    await pm.workflowsPage.search(name);
    await pm.workflowsPage.expectDraftTagOnRow(name);

    await pm.workflowsPage.openEdit(name);
    await pm.workflowsPage.expectDraftTagInEditor();
  });

  // DRF-02 — promoting a draft flips the editor's whole mode: the draft tag goes, and the
  // Save-as-Draft control is replaced by Save.
  test('DRF-02: publishing a draft clears draft mode', { tag: ['@workflowsLifecycle'] }, async () => {
    const name = `wf_auto_drf_${uniq()}`;
    await buildGraph(name);
    await pm.workflowsPage.saveAsDraft();

    await pm.workflowsPage.search(name);
    await pm.workflowsPage.openEdit(name);
    await pm.workflowsPage.publishAndExpectAccepted();
    await pm.workflowsPage.skipLinkAlerts();

    await pm.workflowsPage.search(name);
    await pm.workflowsPage.openEdit(name);
    await pm.workflowsPage.expectNoDraftTagInEditor();
    await pm.workflowsPage.expectPublishedEditorControls();
  });



  // EDT-02 — run history is only meaningful for something that can actually run, so the
  // History control belongs to published workflows and must be reachable there.
  test('EDT-02: a published workflow exposes run history', { tag: ['@workflowsLifecycle'] }, async () => {
    const name = `wf_auto_edt_${uniq()}`;
    await buildGraph(name);
    await pm.workflowsPage.publishAndExpectAccepted();
    await pm.workflowsPage.skipLinkAlerts();

    await pm.workflowsPage.search(name);
    await pm.workflowsPage.openEdit(name);
    await pm.workflowsPage.expectHistoryControl();
  });

  // LST-03 — pause/resume is the enable flag. The row action reports which way it will go
  // via data-row-action, so a toggle must flip that value.
  test('LST-03: pause and resume flip the row action', { tag: ['@workflowsLifecycle'] }, async () => {
    const name = `wf_auto_lst_${uniq()}`;
    await buildGraph(name);
    await pm.workflowsPage.publishAndExpectAccepted();
    await pm.workflowsPage.skipLinkAlerts();

    await pm.workflowsPage.search(name);
    const before = await pm.workflowsPage.rowActionState(name);
    expect(before).toBe('pause');

    await pm.workflowsPage.toggleEnable(name);
    await expect.poll(async () => pm.workflowsPage.rowActionState(name), { timeout: 20000 }).toBe('resume');
  });



  // LST-06 — every row advertises its trigger kind; a draft row additionally carries the
  // draft tag. Both are how the list is scanned.
  test('LST-06: rows carry a trigger tag', { tag: ['@workflowsLifecycle'] }, async () => {
    const name = `wf_auto_lst_${uniq()}`;
    await buildGraph(name);
    await pm.workflowsPage.publishAndExpectAccepted();
    await pm.workflowsPage.skipLinkAlerts();

    await pm.workflowsPage.search(name);
    await pm.workflowsPage.expectTriggerTagOnRow();
  });

  // LST-07 — refresh re-fetches rather than repainting cached rows. Hit by hand during the
  // branch work: a workflow created out-of-band is invisible until this is pressed.
  test('LST-07: refresh re-fetches the list', { tag: ['@workflowsLifecycle'] }, async () => {
    const name = `wf_auto_lst_${uniq()}`;
    await buildGraph(name);
    await pm.workflowsPage.saveAsDraft();

    await pm.workflowsPage.refreshList();
    await pm.workflowsPage.search(name);
    expect(await pm.workflowsPage.isPresent(name)).toBe(true);
  });
  // DRF-05 — a draft is a CHECKPOINT the author may take repeatedly, so saving twice must
  // succeed rather than tripping the "no changes" guard that Publish uses.
  test('DRF-05: Save as Draft can be repeated', { tag: ['@workflowsLifecycle'] }, async () => {
    const name = `wf_auto_drf_${uniq()}`;
    await buildGraph(name);
    await pm.workflowsPage.saveAsDraft();

    await pm.workflowsPage.search(name);
    await pm.workflowsPage.openEdit(name);
    await pm.workflowsPage.saveAsDraft();
    await pm.workflowsPage.search(name);
    expect(await pm.workflowsPage.isPresent(name)).toBe(true);
  });
  // LST-08 — pause and resume must round-trip: a paused workflow that is resumed is back
  // in exactly the state it started in, which is what makes the control safe to use.
  test('LST-08: pause then resume returns the row to running', { tag: ['@workflowsLifecycle'] }, async () => {
    const name = `wf_auto_lst_${uniq()}`;
    await buildGraph(name);
    await pm.workflowsPage.publishAndExpectAccepted();
    await pm.workflowsPage.skipLinkAlerts();

    await pm.workflowsPage.search(name);
    await pm.workflowsPage.toggleEnable(name);
    await expect.poll(async () => pm.workflowsPage.rowActionState(name), { timeout: 20000 }).toBe('resume');

    await pm.workflowsPage.toggleEnable(name);
    await expect.poll(async () => pm.workflowsPage.rowActionState(name), { timeout: 20000 }).toBe('pause');
  });
});
