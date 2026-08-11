// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');

// ─────────────────────────────────────────────────────────────────────────────
// SLO PromQL Time-Slice Support and Validation — E2E Tests
// Covers:
//   • TC-P0-1  PromQL Time-Slice form interaction and field visibility
//   • TC-P0-2  Save PromQL Time-Slice SLO — payload correctness
//   • TC-P1-1  Flip language between SQL and PromQL on Time-Slice branch
//   • TC-P1-2  PromQL Count SLO — field swap and range hint
//   • TC-P1-3  Edit stored SLO — no spurious regeneration warning
//   • TC-P1-4  Language toggle NOT visible for non-metrics streams
//   • TC-P2-1  Empty aggregate expression — preview shows empty state
//   • TC-P2-2  Combined workflow — preserves independent state across branches
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Self-seeded prerequisites
//
// PromQL time-slice and count tests require a metrics-type stream. We seed
// `e2e_slo_metrics` via the pipelinesPage helper in beforeAll, poll for
// registration, and clean up after. An edit-mode test (TC-P1-3) needs a stored
// SLO — created via direct API call in beforeAll with a worker-scoped identifier
// to stay parallel-safe.
//
// Worker-scoped naming ensures parallel workers never collide. All SLO names
// created by tests themselves also carry per-test suffixes.
// ─────────────────────────────────────────────────────────────────────────────

const RUN_ID = Date.now().toString(36).slice(-4) + Math.random().toString(36).substring(2, 5);
const AUTH_STATE = 'playwright-tests/utils/auth/user.json';
const METRICS_STREAM = 'e2e_slo_metrics';
const LOGS_STREAM = 'e2e_automate';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Direct API call through the browser context (uses auth state from global-setup).
 */
async function apiCall(page, method, path, body = null) {
  const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
  const headers = getAuthHeaders();
  return page.evaluate(async ({ url, method, headers, body }) => {
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(url, opts);
    const data = await resp.json().catch(() => ({}));
    return { status: resp.status, data };
  }, { url: `${baseUrl}${path}`, method, headers, body });
}

// ─────────────────────────────────────────────────────────────────────────────
// Describe block
// ─────────────────────────────────────────────────────────────────────────────

test.describe('SLO PromQL Time-Slice Support and Validation testcases', () => {
  test.describe.configure({ mode: 'parallel' });

  /** @type {PageManager} */
  let pm;
  /** @type {import('../../pages/slosPages/slosPage.js').SlosPage} */
  let slosPage;

  // ── Worker-scoped state (set in beforeAll, cleared in afterAll) ──
  let editSloId = null;
  let editSloName = null;

  // ───────────────────────────────────────────────────────────────────────────
  // beforeAll — seed metrics stream + create edit SLO (per-worker)
  // ───────────────────────────────────────────────────────────────────────────

  test.beforeAll(async ({ browser }, testInfo) => {
    editSloName = `e2e_slots_${RUN_ID}_w${testInfo.workerIndex}_edit`;

    const context = await browser.newContext({ storageState: AUTH_STATE });
    const page = await context.newPage();
    try {
      const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
      const org = getOrgIdentifier();
      await page.goto(`${baseUrl}?org_identifier=${org}`);
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});

      const workerPm = new PageManager(page);

      // 1. Seed the metrics stream
      testLogger.info('Seeding metrics stream for SLO tests', { stream: METRICS_STREAM });
      await workerPm.pipelinesPage.ingestMetricsData(METRICS_STREAM, 20);
      // Wait for ingestion to flush to storage
      await page.waitForTimeout(3000);

      // Poll for stream registration
      const headers = getAuthHeaders();
      let registered = false;
      for (let i = 0; i < 30 && !registered; i++) {
        const listResp = await page.request.get(
          `${baseUrl}/api/${org}/streams?type=metrics`,
          { headers }
        );
        if (listResp.ok()) {
          const body = await listResp.json().catch(() => null);
          registered = (body?.list || []).some(s => s.name === METRICS_STREAM);
        }
        if (!registered) await page.waitForTimeout(1000);
      }
      testLogger.info('Metrics stream registration', { stream: METRICS_STREAM, registered });

      // 2. Create a PromQL time-slice SLO for the edit test (TC-P1-3)
      const sloPayload = {
        name: editSloName,
        folder_id: 'default',
        sli_type: 'time_slice',
        target: 99.9,
        window_secs: 2592000,
        slice_interval_secs: 300,
        enabled: true,
        config: {
          stream: METRICS_STREAM,
          stream_type: 'metrics',
          query: 'up',
          comparator: '<',
          threshold: 1,
          query_language: 'prom_ql',
        },
      };
      const createResp = await apiCall(page, 'POST', `/api/${org}/slos`, sloPayload);
      testLogger.info('Edit SLO creation response', { status: createResp.status });
      if (createResp.status >= 200 && createResp.status < 300 && createResp.data?.slo_id) {
        editSloId = createResp.data.slo_id;
      } else {
        testLogger.warn('Could not create edit SLO — edit test may be skipped',
          { status: createResp.status, name: editSloName });
      }
    } finally {
      await page.close();
      await context.close();
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // afterAll — cleanup
  // ───────────────────────────────────────────────────────────────────────────

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH_STATE });
    const page = await context.newPage();
    try {
      const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
      const org = getOrgIdentifier();
      await page.goto(`${baseUrl}?org_identifier=${org}`);
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});

      // Delete the edit SLO if it was created
      if (editSloId) {
        await apiCall(page, 'DELETE', `/api/${org}/slos/${editSloId}`).catch(() => {});
        testLogger.info('Cleaned up edit SLO', { sloId: editSloId });
      }
    } finally {
      await page.close();
      await context.close();
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // beforeEach
  // ───────────────────────────────────────────────────────────────────────────

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    slosPage = pm.slosPage;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TC-P0-1: Create a PromQL Time-Slice SLO — form interaction and field visibility
  // ═══════════════════════════════════════════════════════════════════════════

  test('should render PromQL time-slice form with correct field visibility', {
    tag: ['@sloPromqlTimeSlice', '@all'],
  }, async ({ page }) => {
    const suffix = pm.alertsPage.generateRandomString();
    testLogger.info('Starting TC-P0-1', { suffix });

    // Navigate to SLO list and open new SLO form
    await slosPage.navigateToSloList();
    await slosPage.clickNewSlo();

    // Verify title
    await expect(slosPage.getTitleLocator()).toBeVisible();
    testLogger.info('New SLO form opened');

    // Set name
    await slosPage.setName(`e2e-promql-timeslice-${suffix}`);

    // Select SLI type "Time Slice"
    await slosPage.selectSliType('time_slice');

    // Verify SLI type description is visible
    await expect(slosPage.getSliTypeDescLocator()).toBeVisible();

    // Select stream type "Metrics"
    await slosPage.selectStreamType('timeslice', 'metrics');

    // Verify language toggle appears
    await expect(slosPage.getLanguageToggleLocator('timeslice')).toBeVisible();

    // Verify PromQL is pre-selected (metrics default) — the PromQL toggle item has aria-checked
    const promqlItem = slosPage.getLanguageToggleItemLocator('timeslice', 'prom_ql');
    await expect(promqlItem).toBeVisible();
    await expect(promqlItem).toHaveAttribute('aria-checked', 'true');

    // Select the metrics stream
    await slosPage.selectStream('timeslice', METRICS_STREAM);

    // Wait for stream fields to load
    await page.waitForTimeout(1500);

    // Verify scope field is NOT visible (hidden in PromQL mode)
    await expect(slosPage.getScopeLocator()).not.toBeVisible();

    // Verify absent warning note is visible
    await expect(slosPage.getAbsentNoteLocator()).toBeVisible();

    // Verify aggregate field is visible (label reflects PromQL context)
    await expect(slosPage.getAggregateLocator()).toBeVisible();

    // Type a PromQL aggregate expression
    await slosPage.fillAggregate('up');

    // Set target, window, slice
    await slosPage.setTarget(99.9);
    await slosPage.selectWindow(2592000);
    await slosPage.selectSlice(300);

    // Verify time-slice preview section appears after filling aggregate + stream
    await expect(slosPage.getTimeSlicePreviewSectionLocator()).toBeVisible({ timeout: 10000 });

    // Verify no error banner
    await expect(slosPage.getErrorBannerLocator()).not.toBeVisible();

    testLogger.info('TC-P0-1 completed');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TC-P0-2: Save a PromQL Time-Slice SLO — payload correctness
  // ═══════════════════════════════════════════════════════════════════════════

  test('should save a PromQL Time-Slice SLO with correct payload shape', {
    tag: ['@sloPromqlTimeSlice', '@all'],
  }, async ({ page }) => {
    const suffix = pm.alertsPage.generateRandomString();
    const sloName = `e2e-save-promql-${suffix}`;
    testLogger.info('Starting TC-P0-2', { sloName });

    // Navigate and set up the form (same as P0-1)
    await slosPage.navigateToSloList();
    await slosPage.clickNewSlo();
    await slosPage.setName(sloName);
    await slosPage.selectSliType('time_slice');
    await slosPage.selectStreamType('timeslice', 'metrics');
    await slosPage.selectStream('timeslice', METRICS_STREAM);
    await page.waitForTimeout(1500);
    await slosPage.fillAggregate('up');
    await slosPage.setTarget(99.9);
    await slosPage.selectWindow(2592000);
    await slosPage.selectSlice(300);

    // Set up the request watcher before clicking save
    const saveRequestPromise = page.waitForRequest(
      (req) => req.url().includes('/api/') && req.url().includes('/slos') && req.method() === 'POST',
      { timeout: 30000 }
    );

    await slosPage.clickSave();

    // Wait for the request and capture its body
    const saveRequest = await saveRequestPromise;
    const payload = saveRequest.postDataJSON();
    testLogger.info('Save payload captured', { payload });

    // Verify no error banner
    await expect(slosPage.getErrorBannerLocator()).not.toBeVisible({ timeout: 10000 });

    // Assert payload shape
    expect(payload.sli_type).toBe('time_slice');
    expect(payload.config.query_language).toBe('prom_ql');
    expect(payload.config.stream_type).toBe('metrics');
    expect(payload.config.comparator).toBe('<');
    expect(payload.config.query).toBe('up');
    expect(payload.config.stream).toBe(METRICS_STREAM);

    // scope must be ABSENT from config (not present in JSON)
    expect(payload.config).not.toHaveProperty('scope');

    // threshold must be present
    expect(payload.config.threshold).toBeDefined();

    // No stray count-source keys
    expect(payload.config).not.toHaveProperty('source');
    expect(payload.config).not.toHaveProperty('good_expr');

    testLogger.info('TC-P0-2 completed');

    // Cleanup: delete the SLO we just created
    const org = getOrgIdentifier();
    if (saveRequest.response) {
      const response = await saveRequest.response();
      try {
        const respBody = await response.json();
        if (respBody?.slo_id) {
          await apiCall(page, 'DELETE', `/api/${org}/slos/${respBody.slo_id}`).catch(() => {});
          testLogger.info('Cleaned up TC-P0-2 SLO', { sloId: respBody.slo_id });
        }
      } catch {
        // best-effort cleanup
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TC-P1-1: Flip language between SQL and PromQL on Time-Slice branch
  // ═══════════════════════════════════════════════════════════════════════════

  test('should flip language between SQL and PromQL, clearing expression and toggling scope', {
    tag: ['@sloLanguageFlip', '@all'],
  }, async ({ page }) => {
    testLogger.info('Starting TC-P1-1');

    await slosPage.navigateToSloList();
    await slosPage.clickNewSlo();
    await slosPage.selectSliType('time_slice');
    await slosPage.selectStreamType('timeslice', 'metrics');

    // PromQL is pre-selected — verify scope is hidden
    await expect(slosPage.getScopeLocator()).not.toBeVisible();

    // Type a PromQL expression
    await slosPage.fillAggregate('up');

    // Verify aggregate is filled
    const aggInput = slosPage.getAggregateInputValueLocator();
    await expect(aggInput).toHaveValue('up');

    // Flip to SQL
    await slosPage.selectLanguage('timeslice', 'sql');

    // Verify aggregate expression is CLEARED
    await expect(aggInput).toHaveValue('');

    // Verify scope field APPEARS
    await expect(slosPage.getScopeLocator()).toBeVisible();

    // Type a SQL expression and scope
    await slosPage.fillAggregate('avg(value)');
    await slosPage.fillScope("job = 'api'");

    // Verify SQL expression is filled
    await expect(aggInput).toHaveValue('avg(value)');

    // Flip back to PromQL
    await slosPage.selectLanguage('timeslice', 'prom_ql');

    // Verify aggregate expression is CLEARED again
    await expect(aggInput).toHaveValue('');

    // Verify scope field is HIDDEN again
    await expect(slosPage.getScopeLocator()).not.toBeVisible();

    // Verify language toggle shows PromQL selected
    const promqlItem = slosPage.getLanguageToggleItemLocator('timeslice', 'prom_ql');
    await expect(promqlItem).toHaveAttribute('aria-checked', 'true');

    testLogger.info('TC-P1-1 completed');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TC-P1-2: Create a PromQL Count SLO — field swap and range hint
  // ═══════════════════════════════════════════════════════════════════════════

  test('should swap count fields from SQL to PromQL and show range hint', {
    tag: ['@sloPromqlCount', '@all'],
  }, async ({ page }) => {
    testLogger.info('Starting TC-P1-2');

    await slosPage.navigateToSloList();
    await slosPage.clickNewSlo();

    // Select Count SLI type
    await slosPage.selectSliType('count');

    // Verify default SQL fields: scope + good_expr are visible
    await expect(slosPage.getCountScopeLocator()).toBeVisible();
    await expect(slosPage.getGoodExprLocator()).toBeVisible();

    // Select stream type "Metrics"
    await slosPage.selectStreamType('count', 'metrics');

    // Verify language toggle appears
    await expect(slosPage.getLanguageToggleLocator('count')).toBeVisible();

    // Verify PromQL is pre-selected for metrics
    const promqlItem = slosPage.getLanguageToggleItemLocator('count', 'prom_ql');
    await expect(promqlItem).toHaveAttribute('aria-checked', 'true');

    // Verify SQL fields are REPLACED by PromQL good + total fields
    await expect(slosPage.getPromqlGoodLocator()).toBeVisible();
    await expect(slosPage.getPromqlTotalLocator()).toBeVisible();
    await expect(slosPage.getCountScopeLocator()).not.toBeVisible();
    await expect(slosPage.getGoodExprLocator()).not.toBeVisible();

    // Verify range hint is visible
    await expect(slosPage.getRangeHintLocator()).toBeVisible();

    // Type PromQL expressions
    await slosPage.fillPromqlGood('rate(e2e_slo_metrics[5m])');
    await slosPage.fillPromqlTotal('rate(e2e_slo_metrics[5m])');

    // Verify count preview section appears
    await expect(slosPage.getPreviewSectionLocator()).toBeVisible({ timeout: 10000 });

    testLogger.info('TC-P1-2 completed');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TC-P1-3: Edit stored SLO — no spurious regeneration warning
  // ═══════════════════════════════════════════════════════════════════════════

  test('should load stored SLO without regeneration warning and preserve comparator', {
    tag: ['@sloEdit', '@all'],
  }, async ({ page }) => {
    testLogger.info('Starting TC-P1-3');

    if (!editSloId) {
      testLogger.warn('No edit SLO was created in beforeAll — skipping edit test');
      test.skip();
      return;
    }

    // Navigate directly to edit URL
    await slosPage.navigateToEditSlo(editSloId);

    // Verify title is "Edit SLO"
    await expect(slosPage.getTitleLocator()).toBeVisible();
    const titleText = await slosPage.getTitleLocator().textContent();
    expect(titleText).toContain('Edit');
    testLogger.info('Edit SLO form loaded', { title: titleText });

    // Verify NO regeneration warning on initial load
    await expect(slosPage.getRegenWarningLocator()).not.toBeVisible({ timeout: 3000 });

    // Verify form fields are populated — name input must have the stored value
    await expect(slosPage.getNameInputLocator()).toHaveValue(editSloName);

    // Change only the name (not a definition field)
    const suffix = pm.alertsPage.generateRandomString();
    const updatedName = `e2e_slots_edited_${suffix}`;
    await slosPage.setName(updatedName);

    // Wait for any watchers to settle
    await page.waitForTimeout(500);

    // Verify regeneration warning STILL absent (name is not a definition field)
    await expect(slosPage.getRegenWarningLocator()).not.toBeVisible({ timeout: 3000 });

    // Verify language toggle shows PromQL
    const promqlItem = slosPage.getLanguageToggleItemLocator('timeslice', 'prom_ql');
    await expect(promqlItem).toBeVisible();
    await expect(promqlItem).toHaveAttribute('aria-checked', 'true');

    testLogger.info('TC-P1-3 completed');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TC-P1-4: Language toggle NOT visible for non-metrics streams
  // ═══════════════════════════════════════════════════════════════════════════

  test('should hide language toggle when stream type is not metrics', {
    tag: ['@sloLanguageVisibility', '@all'],
  }, async ({ page }) => {
    testLogger.info('Starting TC-P1-4');

    await slosPage.navigateToSloList();
    await slosPage.clickNewSlo();

    // ── Time-slice branch ──
    await slosPage.selectSliType('time_slice');

    // Select stream type "Logs"
    await slosPage.selectStreamType('timeslice', 'logs');

    // Verify language toggle is NOT visible
    await expect(slosPage.getLanguageToggleLocator('timeslice')).not.toBeVisible({ timeout: 3000 });

    // Verify scope field IS visible (SQL mode is the only option)
    await expect(slosPage.getScopeLocator()).toBeVisible();

    // ── Switch to Count branch ──
    await slosPage.selectSliType('count');

    // Select stream type "Logs" again (may already be selected from time-slice)
    await slosPage.selectStreamType('count', 'logs');

    // Verify language toggle is NOT visible on count branch
    await expect(slosPage.getLanguageToggleLocator('count')).not.toBeVisible({ timeout: 3000 });

    testLogger.info('TC-P1-4 completed');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TC-P2-1: Empty aggregate expression — preview shows empty state
  // ═══════════════════════════════════════════════════════════════════════════

  test('should show empty preview state when no aggregate expression is entered', {
    tag: ['@sloPreview', '@all'],
  }, async ({ page }) => {
    testLogger.info('Starting TC-P2-1');

    await slosPage.navigateToSloList();
    await slosPage.clickNewSlo();
    await slosPage.selectSliType('time_slice');
    await slosPage.selectStreamType('timeslice', 'metrics');
    await slosPage.selectStream('timeslice', METRICS_STREAM);

    // Wait for stream fields to populate
    await page.waitForTimeout(1500);

    // Leave aggregate expression empty
    // Verify preview section shows empty state
    // The empty state may appear either as the specific empty div or the root container without loading/chart
    const previewRoot = slosPage.getTimeSlicePreviewRootLocator();
    await expect(previewRoot).toBeVisible({ timeout: 10000 });

    const previewEmpty = slosPage.getTimeSlicePreviewEmptyLocator();
    await expect(previewEmpty).toBeVisible({ timeout: 5000 });

    testLogger.info('TC-P2-1 completed');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TC-P2-2: Combined workflow — preserves independent state across branches
  // ═══════════════════════════════════════════════════════════════════════════

  test('should preserve branch state when switching between SLI types and languages', {
    tag: ['@sloStateIsolation', '@all'],
  }, async ({ page }) => {
    const suffix = pm.alertsPage.generateRandomString();
    const sloName = `e2e-combined-${suffix}`;
    testLogger.info('Starting TC-P2-2', { sloName });

    await slosPage.navigateToSloList();
    await slosPage.clickNewSlo();

    // Set up PromQL time-slice config
    await slosPage.selectSliType('time_slice');
    await slosPage.selectStreamType('timeslice', 'metrics');
    await slosPage.selectStream('timeslice', METRICS_STREAM);
    await page.waitForTimeout(1500);
    await slosPage.fillAggregate('up');

    // Switch to Count SLI type
    await slosPage.selectSliType('count');
    // Select logs stream type and SQL
    await slosPage.selectStreamType('count', 'logs');
    await page.waitForTimeout(500);

    // Verify count branch shows SQL scope
    await expect(slosPage.getCountScopeLocator()).toBeVisible();

    // Switch back to Time-Slice SLI type
    await slosPage.selectSliType('time_slice');
    await page.waitForTimeout(500);

    // Verify metrics stream type and PromQL settings are restored
    const promqlItem = slosPage.getLanguageToggleItemLocator('timeslice', 'prom_ql');
    await expect(promqlItem).toBeVisible();
    // Language toggle should be visible (metrics was selected before)
    await expect(slosPage.getLanguageToggleLocator('timeslice')).toBeVisible();

    // Verify scope is still hidden (PromQL mode)
    await expect(slosPage.getScopeLocator()).not.toBeVisible();

    // Set remaining fields and save
    await slosPage.setName(sloName);
    await slosPage.setTarget(99.9);
    await slosPage.selectWindow(2592000);
    await slosPage.selectSlice(300);

    // Set up request watcher
    const saveRequestPromise = page.waitForRequest(
      (req) => req.url().includes('/api/') && req.url().includes('/slos') && req.method() === 'POST',
      { timeout: 30000 }
    );

    await slosPage.clickSave();

    // Verify save
    const saveRequest = await saveRequestPromise;
    await expect(slosPage.getErrorBannerLocator()).not.toBeVisible({ timeout: 10000 });

    const payload = saveRequest.postDataJSON();
    // Verify payload is clean for time-slice type — no count-source keys
    expect(payload.sli_type).toBe('time_slice');
    expect(payload.config).not.toHaveProperty('source');
    expect(payload.config).not.toHaveProperty('good_expr');
    expect(payload.config).not.toHaveProperty('scope');

    testLogger.info('TC-P2-2 completed');

    // Cleanup
    const org = getOrgIdentifier();
    if (saveRequest.response) {
      const response = await saveRequest.response();
      try {
        const respBody = await response.json();
        if (respBody?.slo_id) {
          await apiCall(page, 'DELETE', `/api/${org}/slos/${respBody.slo_id}`).catch(() => {});
          testLogger.info('Cleaned up TC-P2-2 SLO', { sloId: respBody.slo_id });
        }
      } catch {
        // best-effort cleanup
      }
    }
  });
});
