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
const { trackSearches, ingestRows } = require('../utils/auto-run-helpers.js');
const { getAuthHeaders } = require('../utils/cloud-auth.js');

const ORG = `srchcancel${Date.now()}`;
const STREAM = 'cancel_logs';
const TOTAL = 120;
const BASE_US = (Date.now() - 10 * 60 * 1000) * 1000;

const editor = '[data-test="logs-search-bar-query-editor"] .monaco-editor';
const runBtn = '[data-test="logs-search-bar-refresh-btn"]';
const table = '[data-test="logs-search-result-logs-table"]';
const pager = '[data-test="logs-search-result-pagination"]';
const cancelledState = '[data-test="logs-search-cancelled-state"]';
const cancelledNotice = '[data-test="logs-search-cancelled-notice"]';
const noEvents = '[data-test="logs-search-no-events-found-text"]';

const b64 = (text) =>
  Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '.');

const urlFor = () =>
  `/web/logs?org_identifier=${ORG}&stream=${STREAM}&stream_type=logs&period=15m&refresh=0` +
  `&sql_mode=false&quick_mode=false&show_histogram=true&query=${b64('')}`;

async function apiTotal(request) {
  const now = Date.now() * 1000;
  const response = await request.post(`${process.env.ZO_BASE_URL}/api/${ORG}/_search?type=logs`, {
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    data: {
      query: {
        sql: `SELECT * FROM "${STREAM}"`,
        start_time: now - 3600e6,
        end_time: now,
        from: 0,
        size: 0,
        track_total_hits: true,
      },
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).total;
}

async function open(page) {
  await navigateToBase(page);
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (/^oo_(toggle_auto_run|logs_|selected_stream_)/.test(key)) localStorage.removeItem(key);
    }
  });
  const searches = trackSearches(page);
  await page.goto(urlFor());
  await page.locator(editor).first().waitFor({ timeout: 60000 });
  return searches;
}


async function holdHits(page) {
  const held = [];
  const hold = (route) => {
    if (route.request().url().includes('is_ui_histogram')) return route.continue();
    held.push(route);
    return undefined;
  };
  await page.route('**/_search_stream?*', hold);
  return async () => {
    await page.unroute('**/_search_stream?*', hold);
    await Promise.all(held.map((route) => route.abort().catch(() => undefined)));
  };
}

test.describe.configure({ mode: 'serial' });

test.describe('Logs search cancelled before its first result (item 2)', () => {
  test.beforeAll(async ({ request }) => {
    await ingestRows(
      request,
      ORG,
      STREAM,
      Array.from({ length: TOTAL }, (_, i) => ({ _timestamp: BASE_US + i * 1e6, level: 'info', message: `sc-${i}` })),
    );
    await expect.poll(() => apiTotal(request), { timeout: 120000 }).toBe(TOTAL);
  });

  test('Cancel during the first run shows Search cancelled, never No events found; Run query loads the rows', async ({ page }) => {
    const release = await holdHits(page);
    const searches = await open(page);
    await expect.poll(() => searches.hits().length, { timeout: 30000 }).toBeGreaterThan(0);
    await expect(page.locator(runBtn)).toContainText('Cancel', { timeout: 30000 });
    await page.locator(runBtn).click();

    await expect(page.locator(cancelledState)).toBeVisible({ timeout: 30000 });
    await expect(page.locator(cancelledState)).toContainText('Search cancelled');
    await expect(page.locator(cancelledState)).toContainText('No results were loaded');
    await expect(page.locator(noEvents)).toHaveCount(0);
    await release();

    await page.locator(`${cancelledState} button`).first().click();
    await expect(page.locator(`${table} [data-test="o2-table-row-0"]`)).toContainText('sc-119', { timeout: 60000 });
    await expect(page.locator(cancelledState)).toHaveCount(0);
  });

  test('Cancel on a page run keeps the earlier rows and notes the cancel', async ({ page }) => {
    const searches = await open(page);
    await expect(page.locator(`${table} [data-test="o2-table-row-0"]`)).toContainText('sc-119', { timeout: 60000 });
    await expect(page.locator(runBtn)).toContainText('Run query', { timeout: 60000 });

    const release = await holdHits(page);
    const before = searches.hits().length;
    await page.locator(`${pager} button`, { hasText: /^2$/ }).click();
    await expect.poll(() => searches.hits().length, { timeout: 30000 }).toBeGreaterThan(before);
    await expect(page.locator(runBtn)).toContainText('Cancel', { timeout: 30000 });
    await page.locator(runBtn).click();

    await expect(page.locator(cancelledNotice)).toBeVisible({ timeout: 30000 });
    await expect(page.locator(cancelledNotice)).toContainText('Search cancelled');
    await expect(page.locator(`${table} [data-test="o2-table-row-0"]`)).toContainText('sc-119');
    await expect(page.locator(cancelledState)).toHaveCount(0);
    await expect(page.locator(noEvents)).toHaveCount(0);
    await release();
  });
});
