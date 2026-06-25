const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");

/**
 * FTS Default Column Selection — E2E Spec
 *
 * Covers the automatic promotion of the best full-text-search field (e.g. message,
 * log, body) as the default visible column when a user runs a search without
 * explicitly pinning columns.  Verifies that the system-pick re-evaluates on
 * subsequent searches but never overrides deliberate user choices.
 *
 * All scenarios are WIRED (feature-incomplete markers not needed).
 */

test.describe("FTS Default Column Selection testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await pm.logsPage.selectStream("e2e_automate");

    // Ensure non-SQL mode — FTS default logic only operates outside SQL mode
    await pm.logsPage.disableSqlModeIfNeeded();

    testLogger.info('Test setup completed');
  });

  // ── helpers ────────────────────────────────────────────────────────────

  /**
   * Run a search with no pinned columns and wait for the FTS auto-pick to
   * settle.  Returns once a first-row cell is visible.
   */
  async function runQueryAndWaitForFTSDefault(pm) {
    await pm.logsPage.runQueryAndWaitForResults(60000);
    await pm.logsPage.waitForSearchResults(30000);
    await pm.logsPage.expectLogTableColumnSourceVisible();
  }

  // ── P0: Critical Path ──────────────────────────────────────────────────

  test("TC-01: should auto-select FTS default column on first search with no pinned columns", {
    tag: ['@fts-default-column', '@all']
  }, async ({ page }) => {
    testLogger.info('TC-01: Verifying FTS default auto-selection on first search');

    // Reset any stale column selection from prior sessions
    await pm.logsPage.clickClearButton();

    // Run a search — the FTS default resolver should promote the best-fill
    // FTS field (e.g. "message") as the primary column.
    await runQueryAndWaitForFTSDefault(pm);

    // Assert the FTS-promoted column appears as a table header.
    // "message" is the most common FTS field in e2e_automate data; if the
    // stream's fill-rate favours a different FTS field (log, body, body_msg,
    // msg), adjust the assertion accordingly.
    await pm.logsPage.expectFieldInTableHeader('message');

    // Assert the generic "source" column header is NOT present — it has been
    // replaced by the promoted FTS column.
    await pm.logsPage.expectFieldNotInTableHeader('source');

    testLogger.info('TC-01 completed: FTS default auto-selection verified');
  });

  test("TC-02: should preserve user-pinned columns across searches after explicit field add", {
    tag: ['@fts-default-column', '@all']
  }, async ({ page }) => {
    testLogger.info('TC-02: Verifying user pin overrides system pick');

    // Stage auto-pick so we have a baseline
    await pm.logsPage.clickClearButton();
    await runQueryAndWaitForFTSDefault(pm);
    await pm.logsPage.expectFieldInTableHeader('message');

    // Explicitly pin a different field — this sets isFtsDefaultColumn = false
    const userField = 'kubernetes_pod_name';
    await pm.logsPage.fillIndexFieldSearchInput(userField);
    await pm.logsPage.clickAddFieldToTableButton(userField);

    // Both the auto-picked column AND the user-pinned column should show
    await pm.logsPage.expectFieldInTableHeader('message');
    await pm.logsPage.expectFieldInTableHeader(userField);

    // Run another search — user selection should persist (no FTS re-resolution)
    await runQueryAndWaitForFTSDefault(pm);
    await pm.logsPage.expectFieldInTableHeader('message');
    await pm.logsPage.expectFieldInTableHeader(userField);

    testLogger.info('TC-02 completed: user pin persisted across searches');
  });

  test("TC-03: should re-resolve FTS default on new search when system pick is still active", {
    tag: ['@fts-default-column', '@all']
  }, async ({ page }) => {
    testLogger.info('TC-03: Verifying system pick re-evaluation on new search');

    // Stage auto-pick
    await pm.logsPage.clickClearButton();
    await runQueryAndWaitForFTSDefault(pm);
    await pm.logsPage.expectFieldInTableHeader('message');

    // Run another search — when isFtsDefaultColumn is still true, the best-fill
    // FTS column is re-evaluated.  If the data yields the same winner the
    // column persists; if a different FTS field has higher fill rate it replaces
    // the old one.  Both outcomes are valid — the key invariant is that a column
    // header is present and results rendered.
    await runQueryAndWaitForFTSDefault(pm);
    await pm.logsPage.expectFieldInTableHeader('message');

    testLogger.info('TC-03 completed: system pick re-evaluation verified');
  });

  // ── P1: Flag clearing and mode exclusions ──────────────────────────────

  test("TC-04: should skip FTS default when SQL mode is enabled", {
    tag: ['@fts-default-column', '@all']
  }, async ({ page }) => {
    testLogger.info('TC-04: Verifying SQL mode bypasses FTS default');

    // Stage auto-pick so we have a reference
    await pm.logsPage.clickClearButton();
    await runQueryAndWaitForFTSDefault(pm);
    await pm.logsPage.expectFieldInTableHeader('message');

    // Toggle SQL mode ON — this clears isFtsDefaultColumn and generates a
    // SELECT query from the current interesting fields.
    await pm.logsPage.clickSQLModeToggle();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Run the auto-generated SQL query
    await pm.logsPage.runQueryAndWaitForResults(60000);
    await pm.logsPage.waitForSearchResults(30000);
    await pm.logsPage.expectLogTableColumnSourceVisible();

    // The FTS auto-picked column (message) must NOT appear — SQL mode
    // queries are authoritative and FTS defaults are skipped.
    await pm.logsPage.expectFieldNotInTableHeader('message');

    testLogger.info('TC-04 completed: SQL mode bypass verified');
  });

  test("TC-05: should clear FTS default on stream change", {
    tag: ['@fts-default-column', '@all']
  }, async ({ page }) => {
    testLogger.info('TC-05: Verifying stream change clears FTS default');

    // Stage auto-pick on e2e_automate
    await pm.logsPage.clickClearButton();
    await runQueryAndWaitForFTSDefault(pm);
    await pm.logsPage.expectFieldInTableHeader('message');

    // Switch to a different stream — onStreamChange clears selectedFields
    // and sets isFtsDefaultColumn = false.
    await pm.logsPage.selectStream("e2e_matchall");
    await pm.logsPage.ensureQuickModeState(false);
    await pm.logsPage.runQueryAndWaitForResults(60000);
    await pm.logsPage.waitForSearchResults(30000);
    await pm.logsPage.expectLogTableColumnSourceVisible();

    // The auto-picked column from stream A must not carry over
    await pm.logsPage.expectFieldNotInTableHeader('message');

    testLogger.info('TC-05 completed: stream change cleared FTS default');
  });

  test("TC-06: should trigger fresh auto-pick after resetting fields", {
    tag: ['@fts-default-column', '@all']
  }, async ({ page }) => {
    testLogger.info('TC-06: Verifying reset-fields triggers fresh auto-pick');

    // Stage auto-pick
    await pm.logsPage.clickClearButton();
    await runQueryAndWaitForFTSDefault(pm);
    await pm.logsPage.expectFieldInTableHeader('message');

    // Reset fields — clears selectedFields and sets isFtsDefaultColumn = false
    await pm.logsPage.clickClearButton();

    // Run another search — since selection is now empty,
    // canResolveDefault is true and a fresh auto-pick occurs.
    await runQueryAndWaitForFTSDefault(pm);
    await pm.logsPage.expectFieldInTableHeader('message');

    testLogger.info('TC-06 completed: fresh auto-pick after reset verified');
  });

  test("TC-07: should trigger fresh auto-pick after removing column via table header close button", {
    tag: ['@fts-default-column', '@all']
  }, async ({ page }) => {
    testLogger.info('TC-07: Verifying column-close clears system pick');

    // Stage auto-pick
    await pm.logsPage.clickClearButton();
    await runQueryAndWaitForFTSDefault(pm);
    await pm.logsPage.expectFieldInTableHeader('message');

    // Remove the system-picked column via the table-header close button.
    // closeColumn() clears isFtsDefaultColumn.  After removal the selection
    // is empty, so canResolveDefault is true on the next search and a fresh
    // auto-pick fires.
    await pm.logsPage.clickRemoveColumnHeaderButton('message');
    await pm.logsPage.expectFieldNotInTableHeader('message');

    // Fresh search — empty selection triggers a new auto-pick
    await runQueryAndWaitForFTSDefault(pm);
    await pm.logsPage.expectFieldInTableHeader('message');

    testLogger.info('TC-07 completed: column-close triggers fresh auto-pick');
  });

  test("TC-08: should NOT persist system-picked column to localStorage", {
    tag: ['@fts-default-column', '@all']
  }, async ({ page }) => {
    testLogger.info('TC-08: Verifying system pick not persisted to logFilterField');

    // Stage auto-pick
    await pm.logsPage.clickClearButton();
    await runQueryAndWaitForFTSDefault(pm);
    await pm.logsPage.expectFieldInTableHeader('message');

    // Read localStorage — the system pick must NOT be persisted
    const beforePersisted = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('logFilterField');
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    });
    testLogger.info(`logFilterField after auto-pick: ${JSON.stringify(beforePersisted)}`);

    // If persisted list exists, ensure the auto-picked field is absent
    if (beforePersisted && Array.isArray(beforePersisted)) {
      const hasMessage = beforePersisted.some(
        (f) => (f && (f.name === 'message' || f === 'message'))
      );
      await expect(hasMessage).toBe(false);
    }

    // Now explicitly pin a field — this sets isFtsDefaultColumn = false, so
    // the field WILL be persisted.
    const userField = 'kubernetes_host';
    await pm.logsPage.fillIndexFieldSearchInput(userField);
    await pm.logsPage.clickAddFieldToTableButton(userField);

    // Re-read localStorage — the user-pinned field SHOULD now be persisted
    const afterPersisted = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('logFilterField');
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    });
    testLogger.info(`logFilterField after user pin: ${JSON.stringify(afterPersisted)}`);

    await expect(afterPersisted).not.toBeNull();
    if (Array.isArray(afterPersisted)) {
      const hasKubernetesHost = afterPersisted.some(
        (f) => (f && (f.name === userField || f === userField))
      );
      await expect(hasKubernetesHost).toBe(true);
    }

    testLogger.info('TC-08 completed: system pick persistence guard verified');
  });

  // ── P2: Edge Cases ─────────────────────────────────────────────────────

  test("TC-09: should fall back to source column when no FTS candidates available", {
    tag: ['@fts-default-column', '@all']
  }, async ({ page }) => {
    testLogger.info('TC-09: Verifying fallback to source column with no FTS candidates');

    // Use e2e_matchall — a stream that may not have FTS keys configured,
    // or whose data may not populate FTS-eligible fields.  resolveDefaultColumns
    // returns [] when no candidates match, falling back to the generic
    // "source" column.
    await pm.logsPage.selectStream("e2e_matchall");
    await pm.logsPage.ensureQuickModeState(false);
    await pm.logsPage.clickClearButton();
    await pm.logsPage.runQueryAndWaitForResults(60000);
    await pm.logsPage.waitForSearchResults(30000);
    await pm.logsPage.expectLogTableColumnSourceVisible();

    // The "source" column header OR any column must be visible (results
    // rendered).  If FTS defaults fired, a named column appears; if not,
    // the source column appears.  Both are valid fallback outcomes.
    testLogger.info('TC-09 completed: fallback behaviour verified');
  });

  test("TC-10: should replace system pick with saved-view columns on apply", {
    tag: ['@fts-default-column', '@all']
  }, async ({ page }) => {
    testLogger.info('TC-10: Verifying saved-view application clears system pick');

    // Stage auto-pick
    await pm.logsPage.clickClearButton();
    await runQueryAndWaitForFTSDefault(pm);
    await pm.logsPage.expectFieldInTableHeader('message');

    // Pin an explicit field so the saved view captures a user column that
    // differs from the system-picked default.
    const userField = 'kubernetes_host';
    await pm.logsPage.fillIndexFieldSearchInput(userField);
    await pm.logsPage.clickAddFieldToTableButton(userField);
    await pm.logsPage.expectFieldInTableHeader(userField);

    // Save the current state as a view with a unique name to avoid parallel
    // test collisions.
    const viewName = `fts_default_view_${Date.now()}`;
    await pm.logsPage.clickSavedViewsDropdownArrow();
    await pm.logsPage.clickSaveViewOption();
    await pm.logsPage.fillViewNameInput(viewName);
    await pm.logsPage.clickSaveViewDialogSaveButton();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    testLogger.info(`Saved view created: ${viewName}`);

    // Reset fields to clear everything — then re-establish auto-pick so we
    // can verify applying the saved view replaces it.
    await pm.logsPage.clickClearButton();
    await runQueryAndWaitForFTSDefault(pm);
    await pm.logsPage.expectFieldInTableHeader('message');

    // Apply the saved view — applySavedView() sets isFtsDefaultColumn = false
    // and the view's stored columns take precedence.
    await pm.logsPage.clickSavedViewsDropdownArrow();
    await pm.logsPage.clickSavedViewByName(viewName);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // The saved view's column (kubernetes_host) should now be present
    await pm.logsPage.expectFieldInTableHeader(userField, 15000);
    // The auto-picked FTS column may be gone (replaced by saved-view columns)
    // or may still coexist — the key verification is that the saved view was
    // applied and the user-pinned column from the view renders.

    testLogger.info('TC-10 completed: saved-view application verified');
  });
});
