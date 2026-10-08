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

// Item 2 cost guard (§9 @guard). Needs auto_query_max_scan_mb = 1, ingest allowed 25 h back,
// and short stats intervals so the fixture's stats exist within a minute.
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

const ORG = `autorunguard${Date.now()}`;
const STREAM = 'guarded_24h';
const HOUR_US = 60 * MINUTE_US;

const guard = '[data-test="logs-auto-run-guard"]';
const banner = '[data-test="logs-auto-run-guard-banner"]';
const runAnyway = '[data-test="logs-auto-run-guard-run-btn"]';
const narrow = '[data-test="logs-auto-run-guard-narrow-btn"]';
const rows = '[data-test="logs-search-result-logs-table"] tbody tr';

const urlFor = (period) =>
  `/web/logs?org_identifier=${ORG}&stream=${STREAM}&stream_type=logs&period=${period}` +
  '&refresh=0&sql_mode=false&quick_mode=false&show_histogram=true';

async function pickRelative(page, value, unit) {
  await page.locator('[data-test="date-time-btn"]').click({ force: true });
  await page.locator(`[data-test="date-time-relative-${value}-${unit}-btn"]`).click();
  await page.keyboard.press('Escape');
}

async function setInterval5s(page) {
  await page.locator('[data-test="logs-search-bar-refresh-interval-btn"]').click();
  await page.locator('[data-test="logs-search-bar-refresh-time-5"]').click();
  await page.keyboard.press('Escape');
}

async function open(page, period) {
  await navigateToBase(page);
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (/^oo_(toggle_auto_run|logs_|selected_stream_)/.test(key)) localStorage.removeItem(key);
    }
  });
  const searches = trackSearches(page);
  await page.goto(urlFor(period));
  return searches;
}

test.describe.configure({ mode: 'serial' });

test.describe('Logs Auto Run cost guard', () => {
  test.beforeAll(async ({ request }) => {
    const now = Date.now() * 1000;
    const filler = 'x'.repeat(1800);
    // About 14 MB spread evenly over the last 24 h, so 15 min stays under 1 MB and 24 h does not.
    const rows = Array.from({ length: 7200 }, (_, i) => ({
      _timestamp: now - 24 * HOUR_US + i * 12_000_000 + 1_000_000,
      level: i % 7 === 0 ? 'error' : 'info',
      message: `guard row ${i} ${filler}`,
    }));
    await ingestRows(request, ORG, STREAM, rows);
    const entry = await waitForStats(request, ORG, STREAM);
    const config = await readConfig(request, ORG);
    expect(config.auto_query_enabled).toBe(true);
    expect(Number(config.auto_query_max_scan_mb)).toBe(1);
    expect(estimateMb(entry, 15 * MINUTE_US)).toBeLessThanOrEqual(1);
    expect(estimateMb(entry, 24 * HOUR_US)).toBeGreaterThan(1);
  });

  test('a 24 h link is guarded: nothing is sent and the guard shows', {
    tag: ['@guard', '@logs'],
  }, async ({ page }) => {
    const searches = await open(page, '24h');
    await expect(page.locator(guard)).toBeVisible({ timeout: 60000 });
    await expect(page.locator('[data-test="logs-auto-run-guard-estimate"]')).toContainText(STREAM);
    await page.waitForTimeout(2000);
    expect(searches.all()).toHaveLength(0);

    testLogger.info('Run anyway sends exactly one hits request');
    await page.locator(runAnyway).click();
    await expect(page.locator(rows).first()).toBeVisible({ timeout: 60000 });
    expect(searches.hits()).toHaveLength(1);
  });

  test('Narrow to changes the picker and runs once; widening back shows the banner over the rows', {
    tag: ['@guard', '@logs'],
  }, async ({ page }) => {
    const searches = await open(page, '24h');
    await expect(page.locator(narrow)).toBeVisible({ timeout: 60000 });
    await page.locator(narrow).click();
    await expect(page.locator(rows).first()).toBeVisible({ timeout: 60000 });
    expect(searches.hits()).toHaveLength(1);
    await expect(page.locator('[data-test="date-time-btn"]')).not.toContainText('24');

    await pickRelative(page, 1, 'd');
    await expect(page.locator(banner)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-test="logs-search-results-stale"]')).toBeVisible();
    await expect(page.locator('[data-test="logs-search-result-pagination"]')).toHaveAttribute(
      'data-locked',
      'true',
    );
    expect(searches.hits()).toHaveLength(1);
  });

  test('a consented 24 h wallboard keeps refreshing; a facet runs, a wider window re-blocks', {
    tag: ['@guard', '@logs'],
  }, async ({ page }) => {
    const searches = await open(page, '24h');
    await page.locator(runAnyway).click();
    await expect(page.locator(rows).first()).toBeVisible({ timeout: 60000 });

    await setInterval5s(page);
    const before = searches.hits().length;
    await page.waitForTimeout(17000);
    expect(searches.hits().length - before).toBeGreaterThanOrEqual(3);
    await expect(page.locator(banner)).toHaveCount(0);
    await page.locator('[data-test="logs-search-bar-refresh-interval-btn"]').click();
    await page.locator('[data-test="logs-search-off-refresh-interval"]').first().click();
    await page.keyboard.press('Escape');

    testLogger.info('A facet narrows the consented scope: it runs with no banner');
    await page.waitForTimeout(1500);
    const beforeFacet = searches.hits().length;
    await page.locator('[data-test="log-search-expand-level-field-btn"]').click();
    const value = page.locator('[data-test="logs-search-subfield-add-level-error"]');
    await value.waitFor({ timeout: 30000 });
    await value.locator('[role="checkbox"], button, input').first().click();
    await expect.poll(() => searches.hits().length, { timeout: 15000 }).toBe(beforeFacet + 1);
    await expect(page.locator(banner)).toHaveCount(0);

    testLogger.info('Widening to 2 days is a new scope: the banner shows');
    await pickRelative(page, 2, 'd');
    await expect(page.locator(banner)).toBeVisible({ timeout: 15000 });
    expect(searches.hits().length).toBe(beforeFacet + 1);
  });

  test('an interval on a never-run over-budget scope sends nothing', {
    tag: ['@guard', '@logs'],
  }, async ({ page }) => {
    const searches = await open(page, '24h');
    await expect(page.locator(guard)).toBeVisible({ timeout: 60000 });
    await setInterval5s(page);
    await page.waitForTimeout(7000);
    expect(searches.all()).toHaveLength(0);
    await expect(page.locator(guard)).toBeVisible();
  });

  test('Run anyway is withdrawn once the editor turns dirty', {
    tag: ['@guard', '@logs'],
  }, async ({ page }) => {
    const searches = await open(page, '24h');
    await expect(page.locator(runAnyway)).toBeVisible({ timeout: 60000 });
    const editor = page.locator('[data-test="logs-search-bar-query-editor"] .monaco-editor').first();
    await editor.click();
    await page.keyboard.type("level='error'", { delay: 20 });
    await expect(page.locator(runAnyway)).toHaveCount(0);
    await expect(page.locator('[data-test="logs-search-bar-run-pending-dot"]')).toBeVisible();
    expect(searches.all()).toHaveLength(0);
  });

  test('a widened window under auto-refresh is not refreshed until it is run', {
    tag: ['@guard', '@logs'],
  }, async ({ page }) => {
    const searches = await open(page, '15m');
    await expect(page.locator(rows).first()).toBeVisible({ timeout: 60000 });
    await setInterval5s(page);
    await page.waitForTimeout(6000);
    await pickRelative(page, 1, 'd');
    await expect(page.locator(banner)).toBeVisible({ timeout: 15000 });
    const paused = searches.hits().length;
    await page.waitForTimeout(12000);
    expect(searches.hits()).toHaveLength(paused);
  });
});
