// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const { trackSearches, ingestRows } = require('../utils/auto-run-helpers.js');
const { getAuthHeaders } = require('../utils/cloud-auth.js');

const ORG = `noftsrecovery${Date.now()}`;
const NOFTS = 'nofts_recovery';
const FTS = 'fts_recovery';
const panel = '[data-test="logs-no-fts-panel"]';
const run = '[data-test="logs-search-bar-refresh-btn"]';
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '.');
const sqlOf = (entry) => /^[A-Za-z0-9_.-]+$/.test(entry.sql) ? Buffer.from(entry.sql.replace(/-/g, '+').replace(/_/g, '/').replace(/\./g, '='), 'base64').toString('utf8') : entry.sql;
const url = (streams) => `/web/logs?org_identifier=${ORG}&stream=${streams}&stream_type=logs&period=15m&refresh=0&sql_mode=false&quick_mode=false&show_histogram=false&query=${b64('timeout')}`;

async function select(page, name, value) {
  await page.locator(`[data-test="logs-no-fts-${name}-trigger"]`).click();
  await page.getByRole('option', { name: value, exact: true }).click();
}
async function open(page, streams = NOFTS) {
  await navigateToBase(page);
  const requests = trackSearches(page);
  await page.goto(url(streams));
  await page.locator('[data-test="logs-search-bar-query-editor"]').waitFor();
  await page.locator(run).click();
  return requests;
}
async function total(request, stream) {
  const now = Date.now() * 1000;
  const response = await request.post(`${process.env.ZO_BASE_URL}/api/${ORG}/_search?type=logs`, {
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    data: { query: { sql: `SELECT * FROM "${stream}"`, start_time: now - 3600e6, end_time: now, from: 0, size: 0, track_total_hits: true } },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).total;
}

test.describe.configure({ mode: 'serial' });
test.describe('No-FTS recovery C1', () => {
  test.beforeAll(async ({ request }) => {
    const at = (Date.now() - 120000) * 1000;
    await ingestRows(request, ORG, NOFTS, [
      { _timestamp: at, msg_text: "TIMEOUT O'REILLY", code: 42, enabled: true },
      { _timestamp: at + 1, msg_text: 'healthy', code: 7, enabled: false },
    ]);
    await ingestRows(request, ORG, FTS, [{ _timestamp: at, body: 'timeout' }]);
    await expect.poll(() => total(request, NOFTS), { timeout: 120000 }).toBe(2);
    await expect.poll(() => total(request, FTS), { timeout: 120000 }).toBe(1);
  });

  test('open, edit and cancel send zero searches; submit runs exactly the preview with quotes (AC-C1.1, C1.2)', async ({ page }) => {
    const requests = await open(page);
    await expect(page.locator(panel)).toContainText(`Full-text search fields are not configured for ${NOFTS}`);
    await expect(page.locator('[data-test="logs-no-fts-configure-btn"]')).toContainText('Configure full-text search fields');
    await expect(page.locator('[data-test="logs-no-fts-clear-run-btn"]')).toBeVisible();
    await page.locator('[data-test="logs-no-fts-search-fields-btn"]').click();
    await select(page, 'field', 'msg_text');
    await page.locator('[data-test="logs-no-fts-value-field"]').fill("O'Reilly");
    const preview = page.locator('[data-test="logs-no-fts-preview"]');
    await expect(preview).toHaveText("(msg_text IS NOT NULL AND str_match_ignore_case(msg_text, 'o''reilly'))");
    expect(requests.all()).toHaveLength(0);
    await page.getByRole('button', { name: 'Close field search', exact: true }).click();
    await expect(page.locator('[data-test="logs-no-fts-field-form"]')).toHaveCount(0);
    expect(requests.all()).toHaveLength(0);
    await expect(page.locator('[data-test="logs-no-fts-search-fields-btn"]')).toBeFocused();
    await page.locator('[data-test="logs-no-fts-search-fields-btn"]').click();
    await select(page, 'field', 'msg_text');
    await page.locator('[data-test="logs-no-fts-value-field"]').fill("O'Reilly");
    const expected = await preview.textContent();
    await page.locator('[data-test="logs-no-fts-run-field-btn"]').click();
    await expect(page.locator('[data-test="logs-search-result-logs-table"] tbody tr[data-test^="o2-table-row-"]')).toHaveCount(1);
    expect(requests.hits()).toHaveLength(1);
    expect(sqlOf(requests.hits()[0]).replace(/"msg_text"/g, 'msg_text')).toContain(expected);
    expect(sqlOf(requests.hits()[0])).not.toContain('match_all');
  });

  test('Contains preserves case-insensitive bare-word semantics for uppercase results (F1)', async ({ page }) => {
    const requests = await open(page);
    await expect(page.locator(panel)).toBeVisible();
    await page.locator('[data-test="logs-no-fts-search-fields-btn"]').click();
    await select(page, 'field', 'msg_text');
    await expect(page.locator('[data-test="logs-no-fts-preview"]')).toHaveText("(msg_text IS NOT NULL AND str_match_ignore_case(msg_text, 'timeout'))");
    await page.locator('[data-test="logs-no-fts-run-field-btn"]').click();
    const rows = page.locator('[data-test="logs-search-result-logs-table"] tbody tr[data-test^="o2-table-row-"]');
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("TIMEOUT O'REILLY");
    expect(requests.hits()).toHaveLength(1);
    expect(sqlOf(requests.hits()[0])).toContain('str_match_ignore_case');
  });

  for (const [field, value, predicate] of [['code', '42', 'code = 42'], ['enabled', 'true', 'enabled = true']]) {
    test(`Equals on ${field} sends a typed literal (AC-C1.2)`, async ({ page }) => {
      const requests = await open(page);
      await expect(page.locator(panel)).toBeVisible();
      await page.locator('[data-test="logs-no-fts-search-fields-btn"]').click();
      await select(page, 'field', field);
      await page.locator('[data-test="logs-no-fts-value-field"]').fill(value);
      await expect(page.locator('[data-test="logs-no-fts-preview"]')).toHaveText(predicate);
      await page.locator('[data-test="logs-no-fts-run-field-btn"]').click();
      await expect(page.locator('[data-test="logs-search-result-logs-table"] tbody tr[data-test^="o2-table-row-"]')).toHaveCount(1);
      expect(requests.hits()).toHaveLength(1);
      expect(sqlOf(requests.hits()[0]).replace(new RegExp(`"${field}"`, 'g'), field)).toContain(predicate);
    });
  }

  test('clear-and-run preserves time and streams and recovers both rows (AC-C1.3)', async ({ page }) => {
    const requests = await open(page);
    await expect(page.locator(panel)).toBeVisible();
    const before = new URL(page.url());
    await page.locator('[data-test="logs-no-fts-clear-run-btn"]').click();
    await expect(page.locator('[data-test="logs-search-result-logs-table"] tbody tr[data-test^="o2-table-row-"]')).toHaveCount(2);
    expect(requests.hits()).toHaveLength(1);
    const after = new URL(page.url());
    expect(after.searchParams.get('stream')).toBe(before.searchParams.get('stream'));
    expect(after.searchParams.get('period')).toBe(before.searchParams.get('period'));
    expect(sqlOf(requests.hits()[0])).not.toContain('timeout');
  });

  test('mixed-banner cancel preserves chips and results; submit searches only the skipped stream (AC-C1.4)', async ({ page }) => {
    const requests = await open(page, `${FTS},${NOFTS}`);
    const banner = page.locator('[data-test="logs-missing-stream-banner"]');
    await expect(banner).toContainText(NOFTS);
    await expect(page.locator('[data-test="logs-search-result-logs-table"] tbody tr[data-test^="o2-table-row-"]')).toHaveCount(1);
    const before = requests.all().length;
    await banner.locator('[data-test="logs-no-fts-search-fields-btn"]').click();
    await expect(banner).toContainText(`Search ${NOFTS} only; ${FTS} will be deselected.`);
    await banner.getByRole('button', { name: 'Close field search', exact: true }).click();
    expect(requests.all()).toHaveLength(before);
    expect(new URL(page.url()).searchParams.get('stream')).toBe(`${FTS},${NOFTS}`);
    await banner.locator('[data-test="logs-no-fts-search-fields-btn"]').click();
    await select(page, 'field', 'msg_text');
    const predicate = "(msg_text IS NOT NULL AND str_match_ignore_case(msg_text, 'timeout'))";
    await expect(banner.locator('[data-test="logs-no-fts-preview"]')).toHaveText(predicate);
    const hitsBefore = requests.hits().length;
    await banner.locator('[data-test="logs-no-fts-run-field-btn"]').click();
    await expect.poll(() => requests.hits().length).toBe(hitsBefore + 1);
    await expect(page.locator('[data-test="logs-search-result-logs-table"] tbody tr[data-test^="o2-table-row-"]')).toHaveCount(1);
    await expect.poll(() => new URL(page.url()).searchParams.get('stream')).toBe(NOFTS);
    const fieldSearches = requests.hits().slice(hitsBefore);
    expect(fieldSearches).toHaveLength(1);
    const sql = sqlOf(fieldSearches[0]);
    expect(sql.replace(/"msg_text"/g, 'msg_text')).toContain(predicate);
    expect(sql).toContain(`"${NOFTS}"`);
    expect(sql).not.toContain(`"${FTS}"`);
  });
});
