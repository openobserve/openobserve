/**
 * Journey Suggestions Toolbar Chip — E2E Tests
 *
 * Tests for the JourneySuggestions chip inside the BrowserJourney editor
 * toolbar. Covers: chip visibility lifecycle, popover open/close, suggestion
 * content, action button, auto-close, tooltip, and edge cases.
 *
 * All tests run in parallel — each test independently navigates to the
 * Create Browser Test wizard and establishes its own state.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Journey Suggestions Toolbar Chip testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.journeySuggestionsPage.navigateToSyntheticsAdd();
    testLogger.info('Test setup completed — journey editor loaded, no steps');
  });

  // ─────────────────────────────────────────────────────────────────────
  // P0 — Critical Path: Discover suggestion and resolve it
  // ─────────────────────────────────────────────────────────────────────

  test("should show chip after adding a step, display the suggestion in popover, and hide chip after resolving with assertion",
    { tag: ['@journey-suggestions-chip', '@all'] },
    async ({ page }) => {
      testLogger.info('TC-P0-1: Full happy-path lifecycle');

      // 1. Chip is NOT visible when no steps exist
      await pm.journeySuggestionsPage.expectChipHidden();

      // 2. Click "Add Step" — adds a non-assert step
      await pm.journeySuggestionsPage.clickAddStep();

      // 3. Chip IS now visible with count badge
      await pm.journeySuggestionsPage.expectChipVisible();
      const label = await pm.journeySuggestionsPage.getChipAriaLabel();
      expect(label).toContain('1');
      testLogger.info('Chip visible with count 1');

      // 4. Click chip to open popover
      await pm.journeySuggestionsPage.openSuggestions();

      // 5. Verify popover panel is visible
      await pm.journeySuggestionsPage.expectPanelVisible();

      // 6. Verify zero-assertion suggestion card is visible
      await pm.journeySuggestionsPage.expectZeroAssertionCardVisible();

      // 7. Verify the non-blocking footer message is visible
      await pm.journeySuggestionsPage.expectFooterVisible();

      // 8. Click "Add an assertion" action button
      await pm.journeySuggestionsPage.clickAddAssertion();

      // 9. Verify popover closes after action
      await pm.journeySuggestionsPage.expectPanelHidden();

      // 10. Verify chip is NO longer visible (zero-assertion resolved)
      await pm.journeySuggestionsPage.expectChipHidden();

      // 11. Verify a second step (the assertion) exists in the journey list
      //     — the first step was the click, now there are 2 steps.
      const deleteCount = await pm.journeySuggestionsPage.getStepDeleteCount();
      expect(deleteCount).toBeGreaterThanOrEqual(2);

      testLogger.info('TC-P0-1 completed');
    });

  // ─────────────────────────────────────────────────────────────────────
  // P1 — Important variations
  // ─────────────────────────────────────────────────────────────────────

  test("should auto-close popover and hide chip when suggestion count drops to zero",
    { tag: ['@journey-suggestions-chip', '@all'] },
    async ({ page }) => {
      testLogger.info('TC-P1-1: Auto-close when count → 0');

      // Set up: add step → chip appears
      await pm.journeySuggestionsPage.clickAddStep();
      await pm.journeySuggestionsPage.expectChipVisible();

      // Open popover
      await pm.journeySuggestionsPage.openSuggestions();
      await pm.journeySuggestionsPage.expectPanelVisible();

      // Click "Add an assertion" — resolves the zero-assertion → count → 0
      await pm.journeySuggestionsPage.clickAddAssertion();

      // Popover should auto-close (watcher sets open = false)
      await pm.journeySuggestionsPage.expectPanelHidden();

      // Chip should disappear (v-if="count > 0" → false)
      await pm.journeySuggestionsPage.expectChipHidden();

      testLogger.info('TC-P1-1 completed');
    });

  test("should show tooltip with correct count on hover when popover is closed, and suppress tooltip when popover is open",
    { tag: ['@journey-suggestions-chip', '@all'] },
    async ({ page }) => {
      testLogger.info('TC-P1-2: Tooltip behavior');

      // Set up: add step → chip appears
      await pm.journeySuggestionsPage.clickAddStep();
      await pm.journeySuggestionsPage.expectChipVisible();

      // Hover chip while popover is closed → tooltip appears with count text
      await pm.journeySuggestionsPage.expectTooltipText('1 suggestion for this journey');

      // Click chip to open popover → tooltip should be disabled
      await pm.journeySuggestionsPage.openSuggestions();
      await pm.journeySuggestionsPage.expectPanelVisible();

      // Hover chip while popover is open → tooltip should NOT appear
      // (OTooltip :disabled="open")
      await pm.journeySuggestionsPage.expectTooltipText('', { visible: false });

      testLogger.info('TC-P1-2 completed');
    });

  test("should hide chip when journey has no steps, show when step added, and hide again when resolved",
    { tag: ['@journey-suggestions-chip', '@all'] },
    async ({ page }) => {
      testLogger.info('TC-P1-3: Chip hidden/visible lifecycle');

      // 1. Empty journey → chip hidden
      await pm.journeySuggestionsPage.expectChipHidden();

      // 2. Add a step → chip appears
      await pm.journeySuggestionsPage.clickAddStep();
      await pm.journeySuggestionsPage.expectChipVisible();

      // 3. Add an assertion via the action button → chip disappears
      await pm.journeySuggestionsPage.openSuggestions();
      await pm.journeySuggestionsPage.clickAddAssertion();
      await pm.journeySuggestionsPage.expectChipHidden();

      testLogger.info('TC-P1-3 completed');
    });

  test("should re-appear when the only assertion step is deleted",
    { tag: ['@journey-suggestions-chip', '@all'] },
    async ({ page }) => {
      testLogger.info('TC-P1-4: Chip re-appears after deleting assertion step');

      // Set up: add click step + add assertion → chip disappears
      await pm.journeySuggestionsPage.clickAddStep();
      await pm.journeySuggestionsPage.openSuggestions();
      await pm.journeySuggestionsPage.clickAddAssertion();
      await pm.journeySuggestionsPage.expectChipHidden();

      // Delete the assertion step (the last step added)
      await pm.journeySuggestionsPage.deleteStep('last');

      // Chip should re-appear (only non-assert step remains)
      await pm.journeySuggestionsPage.expectChipVisible();

      testLogger.info('TC-P1-4 completed');
    });

  test("should stay hidden when all remaining steps are assertions after deleting the only non-assert step",
    { tag: ['@journey-suggestions-chip', '@all'] },
    async ({ page }) => {
      testLogger.info('TC-P1-5: Zero-assertion does NOT fire when ALL steps are assertions');

      // Set up: add click step + add assertion → chip disappears
      await pm.journeySuggestionsPage.clickAddStep();
      await pm.journeySuggestionsPage.openSuggestions();
      await pm.journeySuggestionsPage.clickAddAssertion();
      await pm.journeySuggestionsPage.expectChipHidden();

      // Delete the original click step (first step) — only the assertion remains
      await pm.journeySuggestionsPage.deleteStep('first');

      // Chip should stay hidden (only assertions → zero-assertion producer returns null)
      await pm.journeySuggestionsPage.expectChipHidden();

      testLogger.info('TC-P1-5 completed');
    });

  // ─────────────────────────────────────────────────────────────────────
  // P2 — Edge cases
  // ─────────────────────────────────────────────────────────────────────

  test("should always show non-blocking footer message inside the popover panel",
    { tag: ['@journey-suggestions-chip', '@all'] },
    async ({ page }) => {
      testLogger.info('TC-P2-1: Non-blocking footer message');

      // Set up and open popover
      await pm.journeySuggestionsPage.clickAddStep();
      await pm.journeySuggestionsPage.openSuggestions();

      // Footer message should be visible with the info icon
      await pm.journeySuggestionsPage.expectFooterVisible();

      // Close popover via action
      await pm.journeySuggestionsPage.clickAddAssertion();
      await pm.journeySuggestionsPage.expectPanelHidden();

      testLogger.info('TC-P2-1 completed');
    });

  test("should NOT re-open popover automatically after auto-close when suggestion re-appears — user must click chip",
    { tag: ['@journey-suggestions-chip', '@all'] },
    async ({ page }) => {
      testLogger.info('TC-P2-2: Popover does NOT auto-reopen after count → 0 → 1');

      // Set up: add step → chip appears → open popover
      await pm.journeySuggestionsPage.clickAddStep();
      await pm.journeySuggestionsPage.openSuggestions();

      // Click add-assertion → popover auto-closes, chip disappears
      await pm.journeySuggestionsPage.clickAddAssertion();
      await pm.journeySuggestionsPage.expectPanelHidden();
      await pm.journeySuggestionsPage.expectChipHidden();

      // Delete the assertion step → chip re-appears (count goes back to 1)
      await pm.journeySuggestionsPage.deleteStep('last');
      await pm.journeySuggestionsPage.expectChipVisible();

      // Popover should NOT be open — the watcher only sets open=false, never true
      await pm.journeySuggestionsPage.expectPanelHidden();

      // Manually click chip to open — should work
      await pm.journeySuggestionsPage.openSuggestions();
      await pm.journeySuggestionsPage.expectPanelVisible();

      testLogger.info('TC-P2-2 completed');
    });

  // ─────────────────────────────────────────────────────────────────────
  // P2 — fixme: Not reachable in headless E2E (require recorded steps)
  // ─────────────────────────────────────────────────────────────────────

  test.fixme("no-test-attribute suggestion — not wired: requires recorded steps (recording-only producer)",
    { tag: ['@journey-suggestions-chip', '@all'] },
    async ({ page }) => {
      testLogger.info('TC-P2-3: No-test-attribute suggestion card [fixme — requires recording]');
      // When steps are added via addStep(), they have locator: { candidates: [] }
      // which short-circuits the noTestAttribute producer (locatorSteps.length === 0 → returns null).
      // Recorded steps (via Chrome extension) populate candidates and trigger this suggestion.
      // Evidence: journeySuggestions.ts:109 — producer filters by candidates.length > 0;
      //           BrowserJourney.vue:692 — addStep() creates steps with locator: { candidates: [] }.
      await pm.journeySuggestionsPage.expectNoTestAttrCardVisible();
    });

  test.fixme("separator between multiple suggestions visible — not wired: requires no-test-attribute (recording-only)",
    { tag: ['@journey-suggestions-chip', '@all'] },
    async ({ page }) => {
      testLogger.info('TC-P2-4: Separator between multiple suggestions [fixme — requires recording]');
      // Requires both zero-assertion AND no-test-attribute to be active simultaneously.
      // Evidence: JourneySuggestions.vue:117 — v-if="index > 0" renders OSeparator;
      //           both producers must fire (no-test-attribute requires recording).
      // Placeholder: verify panel content with multiple suggestions.
      await pm.journeySuggestionsPage.expectPanelVisible();
    });
});
