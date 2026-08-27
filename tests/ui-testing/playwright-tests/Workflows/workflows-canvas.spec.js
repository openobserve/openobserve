/**
 * Workflows rebuild — canvas, node drawer (NDV) & Runs inspection surface.
 *
 * Covers the reworked builder: the empty-canvas start scaffold (choose a trigger),
 * the VueFlow canvas nodes (colour-coded WorkflowNode cards), the node detail view
 * (WorkflowNodeDrawer), the Save-as-Draft / Publish split, and the dedicated
 * read-only Runs master-detail view (WorkflowRuns + WorkflowRunsPanel).
 *
 * Plan: docs/test_generator/test-plans/workflows-rework-test-plan.md
 * Scenarios: P0-1, P0-2, P0-3, P1-4, P1-5.
 *
 * Self-cleaning: every artifact is namespaced `wf_auto_*`; cleanup.spec.js sweeps
 * these by prefix (workflows are delete-protected while linked to an alert).
 *
 * Workflows is gated on `workflows_enabled` (now an OSS feature); the availability
 * probe in beforeEach skips (rather than fails) when the CI server has it disabled.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

const uniq = () => `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

// Reachable destination used by publish-only flows (P0-1 / P1-4): a local sink
// URL matching the v1 happy-path convention. The dead URL (P0-2) is what actually
// exercises a per-node send failure during a Test dry-run.
const sinkUrl = () => `http://localhost:5080/api/${process.env.ORGNAME || 'default'}/wf_auto_sink/_json`;

test.describe('Workflows canvas rebuild', { tag: ['@workflows', '@all'] }, () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    // Gated on `workflows_enabled` (OSS); skip, don't fail, when the feature is off.
    if (!(await pm.workflowsPage.isAvailable())) {
      test.skip(true, 'Workflows feature unavailable (workflows_enabled=false)');
    }
  });

  // P0-1 — the rebuilt canvas (empty scaffold -> trigger picker -> action slot ->
  // destination NDV with inline destination) produces a saved, published workflow
  // that lands in the list WITHOUT a draft tag.
  test('builds and publishes a Trigger → Destination workflow', { tag: ['@workflowsCanvas'] }, async () => {
    const id = uniq();
    const name = `wf_auto_${id}`;

    await pm.workflowsPage.goToAddEmpty();
    await pm.workflowsPage.expectStartScaffoldVisible();
    await pm.workflowsPage.buildTriggerToDestination({
      destName: `wf_auto_dest_${id}`,
      url: sinkUrl(),
    });
    await pm.workflowsPage.setName(name);
    await pm.workflowsPage.publish();
    await pm.workflowsPage.skipLinkAlerts();
    await pm.workflowsPage.goToList();

    await pm.workflowsPage.expectWorkflowPresent(name);
    await pm.workflowsPage.expectNotDraftTag();
    testLogger.info('published workflow present without draft tag', { name });
  });

  // P0-2 — the dry-run path (POST /workflows/test) paints a ✓ on the reachable
  // trigger and an ✗ on a dead destination, proving per-node badge rendering.
  test('Test dry-run paints per-node ✓/✗ badges', { tag: ['@workflowsCanvas'] }, async () => {
    const id = uniq();

    await pm.workflowsPage.buildTriggerToDestination({
      destName: `wf_auto_dest_${id}`,
      url: 'http://127.0.0.1:1/dead', // closed port -> fast connection-refused
    });
    await pm.workflowsPage.testRunFromEditor();

    await pm.workflowsPage.expectNodeTestOk('workflow_trigger');
    await pm.workflowsPage.expectNodeTestError('destination');
    testLogger.info('trigger ✓ and destination ✗ badges painted');
  });

  // P0-3 — Save-as-Draft is lenient: a trigger-only (incomplete) graph persists
  // and is marked with the draft tag, without requiring a completed graph.
  test('Save-as-Draft persists a trigger-only workflow with the draft tag', { tag: ['@workflowsCanvas'] }, async () => {
    const id = uniq();
    const name = `wf_auto_${id}`;

    await pm.workflowsPage.goToAddEmpty();
    await pm.workflowsPage.chooseTrigger();
    await pm.workflowsPage.setName(name);
    await pm.workflowsPage.clickSaveDraft();
    await pm.workflowsPage.goToList();

    await pm.workflowsPage.expectWorkflowPresent(name);
    await pm.workflowsPage.expectDraftTag(name);
    testLogger.info('trigger-only workflow saved as draft with tag', { name });
  });

  // P1-4 — the dedicated read-only Runs view mounts its canvas + persistent runs
  // panel and reaches GET /workflows/{id}/history without a load error.
  test('Runs inspection surface renders with no load error', { tag: ['@workflowsCanvas'] }, async () => {
    const id = uniq();
    const name = `wf_auto_${id}`;

    // A published workflow is required (drafts have no run history).
    await pm.workflowsPage.buildTriggerToDestination({
      destName: `wf_auto_dest_${id}`,
      url: sinkUrl(),
    });
    await pm.workflowsPage.setName(name);
    await pm.workflowsPage.publish();
    await pm.workflowsPage.skipLinkAlerts();
    await pm.workflowsPage.goToList();

    await pm.workflowsPage.openRunsView(name);
    await pm.workflowsPage.expectRunsPageVisible();
    await pm.workflowsPage.expectRunsPanelVisible();
    await pm.workflowsPage.expectRunsPageShowsName(name);
    await pm.workflowsPage.expectNoRunsLoadError();
    testLogger.info('runs page + panel rendered, no load error', { name });
  });

  // P1-5 — the strict Publish path rejects a destination node saved with no
  // destination: the node keeps its incomplete badge and the editor stays mounted.
  test('Publish blocks a destination saved without a destination', { tag: ['@workflowsCanvas'] }, async () => {
    const id = uniq();
    const name = `wf_auto_${id}`;

    await pm.workflowsPage.goToAddEmpty();
    await pm.workflowsPage.chooseTrigger();
    await pm.workflowsPage.addDestinationViaActionSlot(); // leaves a dummy/incomplete node
    await pm.workflowsPage.setName(name);
    await pm.workflowsPage.publish();

    await pm.workflowsPage.expectIncompleteDestinationBadge();
    await pm.workflowsPage.expectEditorVisible();
    testLogger.info('publish blocked on incomplete destination, editor stays mounted', { name });
  });
});
