/**
 * Workflows v1 — node card actions and canvas controls (NOD-*, NDV-*)
 *
 * Enterprise-only. The node card carries a hover-only action rail (disable, delete) plus
 * two status badges, and the drawer owns rename and comment. None of it had coverage.
 *
 * Two behaviours here are load-bearing rather than cosmetic:
 *  - `incomplete` means "not finished yet" and is what blocks Publish, so the badge is the
 *    user's only pointer to which step is holding a publish back.
 *  - `disabled` keeps a node on the canvas but out of the run set, so the badge is the
 *    difference between a step that will fire and one that will not.
 *
 * Self-cleaning: every artifact is namespaced `wf_auto_*`; cleanup.spec.js sweeps by prefix.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

const uniq = () => `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

test.describe.configure({ mode: 'parallel' });

test.describe('Workflows canvas & node actions', { tag: ['@workflows', '@enterprise', '@all'] }, () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.workflowsPage.assertEnabled();
  });

  /** Trigger + one unconfigured Condition, drawer left open. */
  const withCondition = async () => {
    await pm.workflowsPage.goToAdd();
    await pm.workflowsPage.setName(`wf_auto_nod_${uniq()}`);
    await pm.workflowsPage.addNodeFromPalette('condition');
  };

  // NOD-05 — a node added from the palette arrives in "set up later" mode. The badge is
  // what tells the author which step is not finished, so it must be there before config.
  test('NOD-05: an unconfigured node is badged incomplete', { tag: ['@workflowsCanvas'] }, async () => {
    await withCondition();
    await pm.workflowsPage.saveNodeDrawer();
    await pm.workflowsPage.expectNodeIncompleteBadge('condition');
  });

  // NOD-01 — a renamed node keeps its type but shows the custom name, which is how a
  // graph with three Conditions stays readable.
  test('NOD-01: a node can be renamed from its drawer', { tag: ['@workflowsCanvas'] }, async () => {
    const label = `renamed_${uniq()}`;
    await withCondition();
    await pm.workflowsPage.renameOpenNode(label);
    await pm.workflowsPage.saveNodeDrawer();
    await pm.workflowsPage.expectNodeShowsText('condition', label);
  });

  // NOD-02 — a comment is authoring metadata; the card advertises it with a glyph so the
  // note is discoverable without opening every node.
  test('NOD-02: commenting a node surfaces the indicator glyph', { tag: ['@workflowsCanvas'] }, async () => {
    await withCondition();
    await pm.workflowsPage.commentOpenNode(`note ${uniq()}`);
    await pm.workflowsPage.saveNodeDrawer();
    await pm.workflowsPage.expectCommentIndicator();
  });


  // NOD-04 — delete removes the node from the graph.
  test('NOD-04: a node can be deleted from its hover actions', { tag: ['@workflowsCanvas'] }, async () => {
    await withCondition();
    await pm.workflowsPage.saveNodeDrawer();
    expect(await pm.workflowsPage.nodeCount('condition')).toBe(1);

    await pm.workflowsPage.deleteNode('condition');
    await expect.poll(async () => pm.workflowsPage.nodeCount('condition'), { timeout: 15000 }).toBe(0);
  });

  // NOD-06 — undo is the safety net for the delete above; a mis-click must be recoverable
  // without rebuilding the subtree.
  test('NOD-06: canvas undo restores a deleted node', { tag: ['@workflowsCanvas'] }, async () => {
    await withCondition();
    await pm.workflowsPage.saveNodeDrawer();
    await pm.workflowsPage.deleteNode('condition');
    await expect.poll(async () => pm.workflowsPage.nodeCount('condition'), { timeout: 15000 }).toBe(0);

    await pm.workflowsPage.clickCanvasUndo();
    await expect.poll(async () => pm.workflowsPage.nodeCount('condition'), { timeout: 15000 }).toBe(1);
  });

  // NOD-07 — tidy re-lays the graph. It must not disturb the graph itself, so the node
  // count is the invariant worth pinning.
  test('NOD-07: canvas tidy preserves the graph', { tag: ['@workflowsCanvas'] }, async () => {
    await withCondition();
    await pm.workflowsPage.saveNodeDrawer();
    const before = await pm.workflowsPage.nodeCount('condition');

    await pm.workflowsPage.clickCanvasTidy();
    await expect.poll(async () => pm.workflowsPage.nodeCount('condition'), { timeout: 15000 }).toBe(before);
  });

  // NDV-08 — the detail view is also how a long graph is walked: every open node offers
  // prev/next step navigation, so the author never has to close and re-open to move on.
  test('NDV-08: the node detail view offers step navigation', { tag: ['@workflowsCanvas'] }, async () => {
    await withCondition();
    await pm.workflowsPage.expectNdvStepNavigation();
  });
  // NOD-08 — the incomplete badge is a live signal, not a one-off: configuring the node
  // must clear it, or the author can never tell what is still blocking a publish.
  test('NOD-08: configuring a node clears its incomplete badge', { tag: ['@workflowsCanvas'] }, async () => {
    await withCondition();
    await pm.workflowsPage.setCondition({ column: 'meta_alert_name', operator: '=', value: 'x' });
    await pm.workflowsPage.saveNodeDrawer();
    await pm.workflowsPage.expectNoIncompleteBadge('condition');
  });

  // NOD-03 — the disable toggle keeps a node on the canvas but out of the run set; the
  // "Disabled" badge is the author's only signal that a step will not fire. It must paint
  // on disable and clear again on re-enable, with the node never leaving the canvas.
  test('NOD-03: disabling a node badges it and re-enabling clears the badge', { tag: ['@workflowsCanvas'] }, async () => {
    await withCondition();
    await pm.workflowsPage.saveNodeDrawer();
    await pm.workflowsPage.expectNoDisabledBadge('condition');

    await pm.workflowsPage.toggleNodeDisabled('condition');
    await pm.workflowsPage.expectNodeDisabledBadge('condition');
    expect(await pm.workflowsPage.nodeCount('condition')).toBe(1);

    await pm.workflowsPage.toggleNodeDisabled('condition');
    await pm.workflowsPage.expectNoDisabledBadge('condition');
    expect(await pm.workflowsPage.nodeCount('condition')).toBe(1);
  });

});
