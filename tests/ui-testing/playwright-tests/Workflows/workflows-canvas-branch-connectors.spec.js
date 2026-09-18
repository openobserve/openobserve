/**
 * Workflows v1 — canvas Branch-arm connector geometry & control-polish.
 *
 * Covers three committed, WIRED visual/control changes:
 *  1. Branch-arm append connectors originate from each arm's OWN source handle (WorkflowCanvas.vue
 *     appendPointsFor — `handleDx` mirrors FlowNodeCard's handleOffset), not a shared centre point.
 *  2. Node status-badge strip wraps (flex-wrap) and caps its width (max-w-[calc(100%-2.25rem)]) so
 *     multiple glyphs stay inside the card (WorkflowNode.vue).
 *  3. Resume control on a paused workflow is ghost-success (green/positive); pause stays
 *     ghost-destructive (WorkflowsList.vue `:variant`).
 *
 * Enterprise-only feature: these specs run ONLY in the ENT playwright matrix (never wired into OSS),
 * where Workflows is enabled by default (O2_WORKFLOWS_ENABLED=true). No runtime availability skip —
 * assertEnabled() fails loudly if the feature is missing.
 *
 * Self-cleaning: every artifact is namespaced `wf_auto_*`; cleanup.spec.js sweeps these by prefix.
 * No data ingestion — these are pure UI canvas + list rendering assertions.
 *
 * Known quirks handled by the page object: K9 (Save tooltip intercept -> JS click), K10 (~18s list load).
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

const uniq = () => `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

test.describe.configure({ mode: 'parallel' });

test.describe(
  'Workflows canvas branch connectors & control polish',
  { tag: ['@workflow-canvas-branch-connectors', '@workflows', '@enterprise', '@all'] },
  () => {
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      await navigateToBase(page);
      pm = new PageManager(page);
      // Enterprise-only feature: fail loudly if the build under test lacks Workflows — never skip.
      await pm.workflowsPage.assertEnabled();
    });

    // P0 + P2 — the pause/resume control carries the right variant in BOTH states: an enabled
    // workflow shows a destructive pause action, and once paused the same control becomes the
    // positive green resume action (the headline control-polish change, WorkflowsList.vue:153).
    test(
      'should style the pause/resume control with the correct variant in both states',
      { tag: ['@workflowCanvasBranchConnectors'] },
      async () => {
        const id = uniq();
        const name = `wf_auto_${id}`;
        await pm.workflowsPage.buildTriggerToDestinationAndSave({
          name,
          destName: `wf_auto_dest_${id}`,
          url: `http://localhost:5080/api/${process.env.ORGNAME || 'default'}/wf_auto_sink/_json`,
        });
        await pm.workflowsPage.goToList();
        await pm.workflowsPage.search(name);

        // Enabled -> the control is a destructive pause action (P2, symmetric guard).
        expect(await pm.workflowsPage.listActionRowState(name)).toBe('pause');
        expect(await pm.workflowsPage.listActionClasses(name)).toContain(
          'text-button-ghost-destructive-text'
        );

        // Pause the workflow, then assert the state flip actually landed before checking the variant.
        await pm.workflowsPage.toggleEnable(name);
        await expect
          .poll(() => pm.workflowsPage.listActionRowState(name), { timeout: 30000 })
          .toBe('resume');

        // Paused -> the control is the positive green resume action (P0, the headline change).
        expect(await pm.workflowsPage.listActionClasses(name)).toContain(
          'text-button-ghost-success-text'
        );
        testLogger.info('pause/resume variant verified in both states');
      }
    );

    // P1 — a multi-arm Branch's append connectors no longer converge on one point: each arm's `+`
    // starts at that arm's own handle offset, so the two connector start-x values are distinct and
    // sit close to their handles (|x| < ARM_GAP/2 == 44) instead of the old shared |x| == 44.
    test(
      'should place each branch arm connector at its own source handle',
      { tag: ['@workflowCanvasBranchConnectors'] },
      async () => {
        await pm.workflowsPage.goToAdd();
        await pm.workflowsPage.addNodeFromPalette('branch');
        // addNodeFromPalette opens the branch config drawer; close it so the canvas is hoverable.
        await pm.workflowsPage.bindNodeDrawerIfOpen();

        const xs = await pm.workflowsPage.branchAppendConnectorPaths();
        testLogger.info('branch arm connector start-x values', { xs });

        // A fresh Branch is born with two arms (case-0 + else) -> two append points.
        expect(xs).toHaveLength(2);
        // Every connector parsed a real `M <x> 0` start coordinate.
        expect(xs.every((x) => Number.isFinite(x))).toBe(true);
        // Each arm's connector originates at its OWN handle, so the two start-x values differ.
        expect(new Set(xs).size).toBe(2);
        // And each sits close to its own handle, well inside the inter-arm gap (ARM_GAP = 88).
        for (const x of xs) {
          expect(Math.abs(x)).toBeLessThan(44);
        }
        testLogger.info('Test completed');
      }
    );

    // P1 — the status-badge strip wraps and caps its width so a Disabled badge stays inside the
    // card; the badge appears when a non-trigger node is disabled via its hover toggle.
    test(
      'should render the disabled badge inside a wrapping status strip',
      { tag: ['@workflowCanvasBranchConnectors'] },
      async () => {
        await pm.workflowsPage.goToAdd();
        await pm.workflowsPage.addNodeFromPalette('destination');
        await pm.workflowsPage.bindNodeDrawerIfOpen();

        // Hover the node and click its disable toggle (the badge appearing is the effect guard).
        await pm.workflowsPage.disableNode('destination');
        await pm.workflowsPage.expectNodeDisabledBadge('destination');
        // The badge's containing strip must carry flex-wrap + a max-w cap (the structural change).
        await pm.workflowsPage.expectStatusStripWraps('destination');
        testLogger.info('Test completed');
      }
    );
  }
);
