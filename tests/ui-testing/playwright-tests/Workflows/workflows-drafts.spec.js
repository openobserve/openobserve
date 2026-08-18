/**
 * Workflows — Draft lifecycle (workflow-drafts feature)
 *
 * Enterprise-only. A draft is an incomplete graph (trigger-only, orphan, or a
 * placeholder node) persisted leniently to the drafts table; Publish validates and
 * promotes it into a published workflow. Drafts render a "Draft" tag, are not
 * runnable (no pause/resume), and open straight into the editor instead of the
 * read-only Runs view. Nodes can be muted (disabled) or left "set up later", and
 * leaving the editor with unsaved edits prompts a confirmation.
 *
 * Plan: docs/test_generator/test-plans/workflow-drafts-test-plan.md
 *
 * Self-cleaning: every artifact is namespaced `wf_auto_*`; cleanup.spec.js sweeps
 * these by prefix. No data ingestion — pure UI builder + list journeys.
 *
 * Known quirks handled by the page object: K9 (Save/Save-as-Draft tooltip intercept
 * -> JS click), K10 (~18s list load).
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

const uniq = () => `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

test.describe('Workflows draft lifecycle', { tag: ['@workflows', '@enterprise', '@all'] }, () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    // Enterprise-only feature: these specs run ONLY in the ENT playwright matrix (never
    // wired into OSS), where Workflows is enabled by default. No runtime availability skip —
    // if the feature is missing where this runs, the test must fail loudly.
  });

  // P0 — a trigger-only workflow (which a published save rejects) saves as a draft and
  // renders with the Draft tag + no pause/resume action.
  test(
    'saves a trigger-only workflow as a draft and shows the Draft tag in the list',
    { tag: ['@workflow-drafts', '@p0'] },
    async () => {
      const name = `wf_auto_${uniq()}`;
      await pm.workflowsPage.goToAdd();
      await pm.workflowsPage.setName(name);
      await pm.workflowsPage.clickSaveDraft();
      // Lenient save: no "add at least one step" rejection — the draft row is created.
      expect(await pm.workflowsPage.isPresent(name)).toBeTruthy();
      await pm.workflowsPage.expectDraftTag(name);
      await pm.workflowsPage.expectNoPauseResumeAction(name);
      testLogger.info('draft save verified', { name });
    }
  );

  // P0 — a saved draft can be completed and published; it loses the Draft tag and gains
  // the pause/resume action (the row moved to the workflows table).
  test(
    'promotes a saved draft into a published workflow',
    { tag: ['@workflow-drafts', '@p0'] },
    async () => {
      const id = uniq();
      const name = `wf_auto_${id}`;
      await pm.workflowsPage.buildTriggerToDestinationAndSaveDraft({
        name,
        destName: `wf_auto_dest_${id}`,
        url: `http://localhost:5080/api/${process.env.ORGNAME || 'default'}/wf_auto_sink/_json`,
      });
      await pm.workflowsPage.openDraftRow(name);
      await pm.workflowsPage.clickPublish();
      await pm.workflowsPage.skipLinkAlerts();
      await pm.workflowsPage.goToList();
      await pm.workflowsPage.expectNoDraftTag(name);
      await pm.workflowsPage.expectPauseResumeAction(name);
      testLogger.info('draft promoted to published', { name });
    }
  );

  // P1 — clicking a draft row opens the editor, not the read-only Runs view.
  test(
    'opens the editor when a draft row is clicked',
    { tag: ['@workflow-drafts', '@p1'] },
    async () => {
      const name = `wf_auto_${uniq()}`;
      await pm.workflowsPage.goToAdd();
      await pm.workflowsPage.setName(name);
      await pm.workflowsPage.clickSaveDraft();
      await pm.workflowsPage.goToList();
      await pm.workflowsPage.openDraftRow(name);
      await pm.workflowsPage.expectEditorVisible();
      await pm.workflowsPage.expectRunsPageNotVisible();
      testLogger.info('draft row routes to editor', { name });
    }
  );

  // P1 — publishing is blocked while a node is left "set up later" (placeholder/incomplete).
  test(
    'blocks publishing a draft with an incomplete node',
    { tag: ['@workflow-drafts', '@p1'] },
    async () => {
      const name = `wf_auto_${uniq()}`;
      await pm.workflowsPage.goToAdd();
      await pm.workflowsPage.setName(name);
      await pm.workflowsPage.addNodeFromPalette('destination');
      await pm.workflowsPage.markDestinationSetUpLater();
      await pm.workflowsPage.saveNodeDrawer();
      const msg = await pm.workflowsPage.saveAndCaptureResult();
      testLogger.info('incomplete-node publish result', { msg });
      // Strict publish validation surfaces "Finish configuring all steps before publishing".
      expect(msg.toLowerCase()).toContain('finish configuring');
      await pm.workflowsPage.expectEditorVisible();
    }
  );

  // P1 — the list delete action targets the drafts table for a draft row.
  test('deletes a draft', { tag: ['@workflow-drafts', '@p1'] }, async () => {
    const name = `wf_auto_${uniq()}`;
    await pm.workflowsPage.goToAdd();
    await pm.workflowsPage.setName(name);
    await pm.workflowsPage.clickSaveDraft();
    await pm.workflowsPage.goToList();
    const toastMsg = await pm.workflowsPage.deleteByName(name);
    testLogger.info('draft delete toast', { toastMsg });
    expect(await pm.workflowsPage.isPresent(name)).toBeFalsy();
  });

  // P1 — disabling (muting) a node paints the Disabled badge on the card.
  test(
    'disables a node and shows the Disabled badge',
    { tag: ['@workflow-drafts', '@p1'] },
    async () => {
      await pm.workflowsPage.goToAdd();
      await pm.workflowsPage.addNodeFromPalette('destination');
      await pm.workflowsPage.createDestinationInline({
        name: `wf_auto_dest_${uniq()}`,
        url: `http://localhost:5080/api/${process.env.ORGNAME || 'default'}/wf_auto_sink/_json`,
      });
      await pm.workflowsPage.saveNodeDrawer();
      await pm.workflowsPage.toggleNodeDisable('destination');
      await pm.workflowsPage.expectNodeDisabledBadge('destination');
    }
  );

  // P2 — leaving the editor with unsaved edits prompts the Unsaved Changes dialog.
  test(
    'prompts before leaving the editor with unsaved changes',
    { tag: ['@workflow-drafts', '@p2'] },
    async () => {
      await pm.workflowsPage.goToAdd();
      await pm.workflowsPage.setName(`wf_auto_${uniq()}`);
      await pm.workflowsPage.clickCancel();
      await pm.workflowsPage.expectUnsavedDialogVisible();
      await pm.workflowsPage.discardUnsavedChanges();
      await pm.workflowsPage.expectListVisible();
    }
  );

  // P2 — an already-published workflow keeps a single Save (no Save-as-Draft/Publish split).
  test(
    'shows a single Save action on an already-published workflow',
    { tag: ['@workflow-drafts', '@p2'] },
    async () => {
      const id = uniq();
      const name = `wf_auto_${id}`;
      await pm.workflowsPage.buildTriggerToDestinationAndSave({
        name,
        destName: `wf_auto_dest_${id}`,
        url: `http://localhost:5080/api/${process.env.ORGNAME || 'default'}/wf_auto_sink/_json`,
      });
      await pm.workflowsPage.goToList();
      await pm.workflowsPage.openEdit(name);
      await pm.workflowsPage.expectPublishedWorkflowActionBar();
    }
  );
});
