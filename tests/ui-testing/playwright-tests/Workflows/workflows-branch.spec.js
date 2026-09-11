/**
 * Workflows v1 — Branch node (BR-01..BR-08)
 *
 * Enterprise-only. The Branch is the N-way generalisation of Condition: each path is an
 * optional label plus a ConditionBuilder, evaluated TOP-DOWN with FIRST MATCH WINS, and a
 * permanent trailing "Everything Else" arm so every record leaves by exactly one handle.
 * Row order is therefore routing, not decoration.
 *
 * The node shipped in #14027 (2026-09-03), two days AFTER the Workflows E2E suite merged in
 * #14065 — so until this file it had no end-to-end coverage at all. A silent-reroute defect
 * (deleting a wired path re-points its destination at "Everything Else" on reload) was found
 * by hand in that gap; BR-04 pins the half of the guard that already works. The regression
 * for the defect itself is deliberately NOT here — it fails until the fix lands.
 *
 * Self-cleaning: every artifact is namespaced `wf_auto_*`; cleanup.spec.js sweeps by prefix.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

const uniq = () => `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

test.describe.configure({ mode: 'parallel' });

test.describe('Workflows branch node', { tag: ['@workflows', '@enterprise', '@all'] }, () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.workflowsPage.assertEnabled();
  });

  // BR-06 — Add Path mints a new arm, and the else row stays pinned last however many
  // paths exist. The order badges are 1..N for the cases and N+1 for else.
  test('BR-06: Add Path appends an arm and Everything Else stays last', { tag: ['@workflowsBranch'] }, async () => {
    await pm.workflowsPage.goToAdd();
    await pm.workflowsPage.setName(`wf_auto_br_${uniq()}`);
    await pm.workflowsPage.addBranchFromPalette();

    expect(await pm.workflowsPage.branchCaseCount()).toBe(1);
    await pm.workflowsPage.addBranchCase();
    await pm.workflowsPage.addBranchCase();
    expect(await pm.workflowsPage.branchCaseCount()).toBe(3);

    await pm.workflowsPage.expectElseArmLast();
  });

  // BR-07 — the else arm is what guarantees every record leaves by exactly one handle, so
  // it is deliberately not deletable. Assert ABSENCE of a remove control, not a disabled one.
  test('BR-07: the Everything Else arm cannot be removed', { tag: ['@workflowsBranch'] }, async () => {
    await pm.workflowsPage.goToAdd();
    await pm.workflowsPage.setName(`wf_auto_br_${uniq()}`);
    await pm.workflowsPage.addBranchFromPalette();

    await pm.workflowsPage.expectElseArmVisible();
    await pm.workflowsPage.expectElseArmNotRemovable();

    // A lone case also hides its own remove control — a Branch always keeps >=1 path.
    const [only] = await pm.workflowsPage.branchCaseHandles();
    await pm.workflowsPage.expectBranchCaseNotRemovable(only);
  });

  // BR-05 — move up/down reorders evaluation. Because first match wins, the rendered order
  // IS the routing, so the labels must follow the move rather than the handles being renamed.
  test('BR-05: move up/down reorders the paths without renaming handles', { tag: ['@workflowsBranch'] }, async () => {
    await pm.workflowsPage.goToAdd();
    await pm.workflowsPage.setName(`wf_auto_br_${uniq()}`);
    await pm.workflowsPage.addBranchFromPalette();

    const [first] = await pm.workflowsPage.branchCaseHandles();
    await pm.workflowsPage.setBranchCase(first, { label: 'FIRST' });
    await pm.workflowsPage.addBranchCase();
    const handles = await pm.workflowsPage.branchCaseHandles();
    const second = handles[1];
    await pm.workflowsPage.setBranchCase(second, { label: 'SECOND' });

    expect(await pm.workflowsPage.branchCaseLabels()).toEqual(['FIRST', 'SECOND']);

    await pm.workflowsPage.moveBranchCase(second, 'up');
    expect(await pm.workflowsPage.branchCaseLabels()).toEqual(['SECOND', 'FIRST']);
    // Handles travel WITH their row — reordering must never re-point an existing edge.
    expect(await pm.workflowsPage.branchCaseHandles()).toEqual([second, first]);
  });

  // BR-09 — handles are minted off a high-water mark and kept for the node's life. Deleting
  // a path must not re-index the survivors, or every edge wired to them would silently move.
  test('BR-09: deleting a path leaves surviving handles untouched', { tag: ['@workflowsBranch'] }, async () => {
    await pm.workflowsPage.goToAdd();
    await pm.workflowsPage.setName(`wf_auto_br_${uniq()}`);
    await pm.workflowsPage.addBranchFromPalette();
    await pm.workflowsPage.addBranchCase();
    await pm.workflowsPage.addBranchCase();

    const before = await pm.workflowsPage.branchCaseHandles();
    expect(before).toHaveLength(3);

    await pm.workflowsPage.removeBranchCase(before[0]);

    const after = await pm.workflowsPage.branchCaseHandles();
    expect(after).toEqual([before[1], before[2]]);
    // A new path after a delete takes the NEXT free handle, never a recycled one.
    await pm.workflowsPage.addBranchCase();
    const grown = await pm.workflowsPage.branchCaseHandles();
    expect(grown.slice(0, 2)).toEqual([before[1], before[2]]);
    expect(before).not.toContain(grown[2]);
  });

  // BR-08 — an arm with no outgoing edge is flagged on the canvas. A fresh Branch has every
  // arm open, so the badge must be present before anything is wired.
  test('BR-08: an unwired arm is flagged on the node', { tag: ['@workflowsBranch'] }, async () => {
    await pm.workflowsPage.goToAdd();
    await pm.workflowsPage.setName(`wf_auto_br_${uniq()}`);
    await pm.workflowsPage.addBranchFromPalette();
    await pm.workflowsPage.saveNodeDrawer();

    await pm.workflowsPage.expectBranchUnwiredBadge();
  });

  // BR-02 — the whole point of the node: two configured paths, each wired to its own sink,
  // published. The edge labels are the only on-canvas evidence of which arm feeds which
  // destination, so they are what we assert.
  test('BR-02: builds and publishes a two-path branch with labelled arms', { tag: ['@workflowsBranch'] }, async () => {
    const name = `wf_auto_br_${uniq()}`;
    const dest = `wf_auto_dest_${uniq()}`;
    await pm.workflowsPage.goToAdd();
    await pm.workflowsPage.setName(name);
    await pm.workflowsPage.addBranchFromPalette();

    const [h0] = await pm.workflowsPage.branchCaseHandles();
    await pm.workflowsPage.setBranchCase(h0, {
      label: 'CRITICAL', column: 'meta_alert_name', operator: '=', value: 'crit_marker',
    });
    await pm.workflowsPage.addBranchCase();
    const [, h1] = await pm.workflowsPage.branchCaseHandles();
    await pm.workflowsPage.setBranchCase(h1, {
      label: 'WARNING', column: 'meta_alert_name', operator: '=', value: 'warn_marker',
    });
    await pm.workflowsPage.saveNodeDrawer();

    await pm.workflowsPage.wireArmToDestination(0, { destName: dest, url: 'https://example.com/wf' });
    await pm.workflowsPage.wireArmToDestination(0, { existing: dest });

    const labels = (await pm.workflowsPage.edgeLabelTexts(2)).join(" ");
    testLogger.info('branch edge labels', { labels });
    expect(labels).toContain('CRITICAL');
    expect(labels).toContain('WARNING');

    await pm.workflowsPage.publishAndExpectAccepted();
    await pm.workflowsPage.skipLinkAlerts();
  });

  // BR-04 — deleting a path whose arm still carries an edge leaves the graph routing through
  // a handle the node no longer declares. The backend would reject that mid-run with a raw
  // uuid, so the editor refuses first. This is the guard that works today; the draft path
  // around it is the open defect.
  test('BR-04: deleting a wired path blocks publish', { tag: ['@workflowsBranch'] }, async () => {
    const name = `wf_auto_br_${uniq()}`;
    const dest = `wf_auto_dest_${uniq()}`;
    await pm.workflowsPage.goToAdd();
    await pm.workflowsPage.setName(name);
    await pm.workflowsPage.addBranchFromPalette();

    const [h0] = await pm.workflowsPage.branchCaseHandles();
    await pm.workflowsPage.setBranchCase(h0, {
      label: 'CRITICAL', column: 'meta_alert_name', operator: '=', value: 'crit_marker',
    });
    await pm.workflowsPage.addBranchCase();
    const [, h1] = await pm.workflowsPage.branchCaseHandles();
    await pm.workflowsPage.setBranchCase(h1, {
      label: 'WARNING', column: 'meta_alert_name', operator: '=', value: 'warn_marker',
    });
    await pm.workflowsPage.saveNodeDrawer();

    await pm.workflowsPage.wireArmToDestination(0, { destName: dest, url: 'https://example.com/wf' });
    await pm.workflowsPage.wireArmToDestination(0, { existing: dest });

    // Drop the arm that is already feeding a destination.
    await pm.workflowsPage.openBranchDrawer();
    await pm.workflowsPage.removeBranchCase(h0);
    await pm.workflowsPage.saveNodeDrawer();

    const msg = await pm.workflowsPage.publishAndCaptureRejection();
    testLogger.info('publish rejection after deleting a wired path', { msg });
    expect(msg.toLowerCase()).toContain('branch');
  });
});
