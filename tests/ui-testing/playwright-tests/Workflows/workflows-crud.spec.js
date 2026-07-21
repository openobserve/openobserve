/**
 * Workflows v1 — CRUD & builder journeys (CT-01, CT-02, CT-03, CT-07)
 *
 * Enterprise-only feature: event(alert_fired) -> action(remote/pipeline destination).
 * Plan: tests/ui-testing/MD_Files/features/workflows/ (06-consolidated-suite.md).
 *
 * Self-cleaning: every artifact is namespaced `wf_auto_*`; cleanup.spec.js sweeps these by prefix
 * (workflows are delete-protected while linked to an alert — cascade deletes alerts first).
 *
 * Known quirks handled by the page object: K9 (Save tooltip intercept -> JS click), K10 (~18s list load).
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

const uniq = () => `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

test.describe.configure({ mode: 'parallel' });

test.describe('Workflows CRUD & builder', { tag: ['@workflows', '@enterprise', '@all'] }, () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    // Enterprise-only feature: these specs run ONLY in the ENT playwright matrix (never wired into
    // OSS), where Workflows is enabled by default. No runtime availability skip — if the feature is
    // missing where this runs, the test must fail loudly rather than silently pass as skipped.
  });

  // CT-01 / WF-NEG-02 — a workflow requires at least one step after the trigger.
  // (Verified live 2026-07-20: trigger-only save shows "Add At Least One Step After The Trigger".)
  test('rejects saving a trigger-only workflow', { tag: ['@workflowsCrud'] }, async () => {
    await pm.workflowsPage.goToAdd();
    await pm.workflowsPage.setName(`wf_auto_${uniq()}`);
    const msg = await pm.workflowsPage.saveAndCaptureResult();
    testLogger.info('trigger-only save result', { msg });
    expect(msg.toLowerCase()).toContain('at least one step');
  });

  // CT-01 — name/description fields accept input; empty name is rejected.
  test('validates workflow name', { tag: ['@workflowsCrud'] }, async () => {
    await pm.workflowsPage.goToAdd();
    // empty name + no step -> save blocked (either name or step validation fires)
    const emptyMsg = await pm.workflowsPage.saveAndCaptureResult();
    expect(emptyMsg.length).toBeGreaterThan(0);
    // fill name + description, confirm they persist in the fields
    const name = `wf_auto_${uniq()}`;
    await pm.workflowsPage.setName(name);
    await pm.workflowsPage.setDescription('automation description');
    await pm.workflowsPage.expectNameValue(name);
  });

  // CT-07 — list renders (tolerating the slow load) and search filters.
  test('list loads and search works', { tag: ['@workflowsCrud'] }, async () => {
    await pm.workflowsPage.goToList();
    await pm.workflowsPage.expectListVisible();
    await pm.workflowsPage.search('zzz_no_such_workflow_zzz');
    // no matching rows for a nonsense query
    const count = await pm.workflowsPage.rowByName('zzz_no_such_workflow_zzz').count();
    expect(count).toBe(0);
  });

  // CT-01 (happy build+save) — full path: Trigger -> Destination (created inline via the
  // Choose Type -> Connection wizard), save, skip the link-alerts prompt, verify it lands in
  // the list. A destination node is a valid leaf (F-09), so this is the minimal saveable graph.
  test('builds Trigger->Destination workflow and saves', { tag: ['@workflowsCrud'] }, async () => {
    const id = uniq();
    const name = `wf_auto_${id}`;
    await pm.workflowsPage.buildTriggerToDestinationAndSave({
      name,
      destName: `wf_auto_dest_${id}`,
      url: `http://localhost:5080/api/${process.env.ORGNAME || 'default'}/wf_auto_sink/_json`,
    });
    await pm.workflowsPage.goToList();
    expect(await pm.workflowsPage.isPresent(name)).toBeTruthy();
  });

  // CT-12 — delete protection (linked workflow) is covered in workflows-delete.spec.js.
});
