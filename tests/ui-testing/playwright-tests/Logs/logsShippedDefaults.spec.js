// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const {
  MINUTE_US,
  trackSearches,
  ingestRows,
  waitForStats,
  estimateMb,
  readConfig,
} = require('../utils/auto-run-helpers.js');

const ORG = `autorun${Date.now()}`;
const STREAM = 'shipped_defaults';

test.describe.configure({ mode: 'serial' });

test.describe('Logs shipped defaults: auto-run with the cost guard', () => {
  let config;

  test.beforeAll(async ({ request }) => {
    config = await readConfig(request, ORG);
    test.skip(!Number.isFinite(Number(config.auto_query_max_scan_mb)), 'The backend phase adds auto_query_max_scan_mb.');
    const now = Date.now() * 1000;
    const rows = Array.from({ length: 200 }, (_, i) => ({
      _timestamp: now - (200 - i) * 2_000_000,
      level: i % 5 === 0 ? 'error' : 'info',
      message: `shipped defaults row ${i}`,
    }));
    await ingestRows(request, ORG, STREAM, rows);
    const entry = await waitForStats(request, ORG, STREAM);
    expect(config.auto_query_enabled).toBe(true);
    expect(config.query_on_stream_selection).toBe(true);
    expect(Number(config.auto_query_max_scan_mb)).toBeGreaterThan(0);
    expect(estimateMb(entry, 15 * MINUTE_US)).toBeLessThan(Number(config.auto_query_max_scan_mb));
  });

  test('a fresh user lands on the newest stream with rows and no click', {
    tag: ['@smoke', '@shippedDefaults', '@logs'],
  }, async ({ page }) => {
    await navigateToBase(page);
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (/^oo_(toggle_auto_run|logs_|selected_stream_)/.test(key)) localStorage.removeItem(key);
      }
    });
    const searches = trackSearches(page);
    await page.goto(`/web/logs?org_identifier=${ORG}`);

    const rows = page.locator('[data-test="logs-search-result-logs-table"] tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 60000 });
    await expect(page.locator('[data-test="log-search-index-list-select-stream"]')).toContainText(
      STREAM,
    );
    await expect(page.locator('[data-test="logs-search-no-stream-selected-text"]')).toHaveCount(0);
    await page.waitForTimeout(3000);
    expect(searches.hits()).toHaveLength(1);

    testLogger.info('Facet include runs exactly one filtered search');
    await page.locator('[data-test="log-search-expand-level-field-btn"]').click();
    const value = page.locator('[data-test="logs-search-subfield-add-level-error"]');
    await value.waitFor({ timeout: 30000 });
    const before = searches.hits().length;
    await value.locator('[role="checkbox"], button, input').first().click();
    await expect.poll(() => searches.hits().length, { timeout: 15000 }).toBe(before + 1);
    expect(searches.hits().at(-1).sql).toContain('error');

    testLogger.info('The 1 h preset runs exactly once');
    const beforeTime = searches.hits().length;
    await page.locator('[data-test="date-time-btn"]').click({ force: true });
    await page.locator('[data-test="date-time-relative-1-h-btn"]').click();
    await expect.poll(() => searches.hits().length, { timeout: 15000 }).toBe(beforeTime + 1);

    testLogger.info('SQL typed with an existing FROM never runs (AC4.3)');
    await page.waitForTimeout(2000);
    const beforeTyping = searches.all().length;
    const editor = page.locator('[data-test="logs-search-bar-query-editor"] .monaco-editor').first();
    await editor.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(`SELECT * FROM "${STREAM}"`, { delay: 20 });
    await page.keyboard.type(' WHERE ', { delay: 20 });
    await page.waitForTimeout(3000);
    expect(searches.all().length).toBe(beforeTyping);
    await expect(page.locator('[data-test="logs-search-bar-refresh-btn"][data-run-pending="true"]')).toBeVisible();

    testLogger.info('Auto Run off and reload: stream restored, nothing runs (#14759)');
    await page.locator('[data-test="logs-search-bar-refresh-cache-dropdown-trigger"]').click();
    await page.locator('[data-test="logs-search-bar-live-mode-toggle-btn"]').click();
    const afterToggle = searches.all().length;
    await page.goto(`/web/logs?org_identifier=${ORG}`);
    await expect(page.locator('[data-test="logs-search-apply-search-text"]')).toBeVisible({
      timeout: 60000,
    });
    await expect(page.locator('[data-test="log-search-index-list-select-stream"]')).toContainText(
      STREAM,
    );
    await page.waitForTimeout(2000);
    expect(searches.all().length).toBe(afterToggle);
  });
});
