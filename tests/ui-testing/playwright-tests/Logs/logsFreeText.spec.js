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

// Item 1: bare-word search in filter mode. Scan mode is off until spike S1, so a stream
// without full-text fields shows the configure card only.
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { trackSearches, ingestRows } = require('../utils/auto-run-helpers.js');
const { getAuthHeaders } = require('../utils/cloud-auth.js');
const PageManager = require('../../pages/page-manager.js');

const ORG = `freetext${Date.now()}`;
const FTS = 'fts_a';
const NOFTS = 'nofts_b';
const NOTEXT = 'nofts_c';

const editor = '[data-test="logs-search-bar-query-editor"] .monaco-editor';
const runBtn = '[data-test="logs-search-bar-refresh-btn"]';
const rows = '[data-test="logs-search-result-logs-table"] tbody tr';
const panel = '[data-test="logs-no-fts-panel"]';
const errorState = '[data-test="logs-search-error-state"]';

const b64 = (text) =>
  Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '.');
const unb64 = (text) =>
  Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/').replace(/\./g, '='), 'base64').toString('utf8');

const urlFor = (streams, query, extra = '') =>
  `/web/logs?org_identifier=${ORG}&stream=${streams}&stream_type=logs&period=15m&refresh=0` +
  `&sql_mode=false&quick_mode=false&show_histogram=true&query=${b64(query)}${extra}`;

/** A search request's SQL, decoded when sql_base64_enabled sends it as base64. */
function decodedSql(entry) {
  return /^[A-Za-z0-9\-_.]+$/.test(entry.sql) && !entry.sql.includes(' ') ? unb64(entry.sql) : entry.sql;
}

async function editorText(page) {
  const text = await page.locator(`${editor} .view-lines`).first().innerText();
  return text.replace(/\u00a0/g, ' ').trim();
}

async function open(page, streams, query, extra = '') {
  await navigateToBase(page);
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (/^oo_(toggle_auto_run|logs_|selected_stream_)/.test(key)) localStorage.removeItem(key);
    }
  });
  const searches = trackSearches(page);
  await page.goto(urlFor(streams, query, extra));
  await page.locator(editor).first().waitFor({ timeout: 60000 });
  // The load run may already have replaced the text with the filter it sent.
  await expect
    .poll(async () => {
      const text = await editorText(page);
      return text === query || /match_all\(|str_match_ignore_case\(/.test(text);
    }, { timeout: 30000 })
    .toBe(true);
  return searches;
}

/** Runs the current editor text and waits for the hits request it sends. */
async function run(page, searches) {
  const before = searches.hits().length;
  await page.locator(runBtn).click();
  await expect.poll(() => searches.hits().length, { timeout: 30000 }).toBeGreaterThan(before);
  return decodedSql(searches.hits().at(-1));
}

async function apiTotal(request, sql) {
  const now = Date.now() * 1000;
  const response = await request.post(`${process.env.ZO_BASE_URL}/api/${ORG}/_search?type=logs`, {
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    data: { query: { sql, start_time: now - 3600e6, end_time: now, from: 0, size: 0, track_total_hits: true } },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).total;
}

test.describe.configure({ mode: 'serial' });

test.describe('Logs bare-word search (item 1)', () => {
  test.beforeAll(async ({ request }) => {
    const now = Date.now() * 1000;
    const at = (i) => now - 5 * 60e6 + i * 1e6;
    await ingestRows(
      request,
      ORG,
      FTS,
      Array.from({ length: 40 }, (_, i) => ({
        _timestamp: at(i),
        level: i % 2 ? 'error' : 'info',
        service_name: i % 4 < 2 ? 'api' : 'web',
        enabled: i % 2 === 0,
        body:
          i % 5 === 0
            ? `upstream request timeout after 30s #${i}`
            : i % 5 === 1
              ? `connection refused by peer #${i}`
              : i % 5 === 2
                ? `request refused, timeout pending #${i}`
                : i % 5 === 3
                  ? `all good debug -500 limit 50 #${i}`
                  : `all good #${i}`,
      })),
    );
    await ingestRows(
      request,
      ORG,
      NOFTS,
      Array.from({ length: 10 }, (_, i) => ({ _timestamp: at(i), msg_text: `timeout ${i}`, detail: 'x' })),
    );
    await ingestRows(
      request,
      ORG,
      NOTEXT,
      Array.from({ length: 10 }, (_, i) => ({ _timestamp: at(i), code: i })),
    );
    // Ingested rows are searchable from the WAL; wait until the full-text stream answers.
    await expect
      .poll(() => apiTotal(request, `SELECT * FROM "${FTS}"`), { timeout: 120000 })
      .toBe(40);
  });

  test('a bare word runs as match_all, highlights and the editor then shows what ran (AC1.1-AC1.5, Reinstated)', {
    tag: ['@freeText', '@logs'],
  }, async ({ page, request }) => {
    const searches = await open(page, FTS, 'timeout');
    await new PageManager(page).logsPage.setQueryEditorContent('timeout');

    testLogger.info('Editor decoration and hover before the run');
    const term = page.locator(`${editor} .o2-free-text-term`).first();
    await expect(term).toBeVisible();
    await term.hover();
    await expect(page.locator('.monaco-hover:not(.hidden)').first()).toContainText(
      'Full-text search in: body',
      { timeout: 15000 },
    );

    const sql = await run(page, searches);

    expect(sql).toContain("match_all('timeout')");
    expect(sql).not.toContain('WHERE timeout');
    await expect(page.locator(rows).first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-test="logs-search-result-logs-table"] .log-highlighted').first()).toBeVisible();

    testLogger.info('Same hits as typing match_all by hand');
    expect(await apiTotal(request, sql)).toBe(
      await apiTotal(request, `SELECT * FROM "${FTS}" WHERE match_all('timeout')`),
    );

    await expect.poll(() => editorText(page), { timeout: 15000 }).toBe("match_all('timeout')");
    await expect
      .poll(() => unb64(new URL(page.url()).searchParams.get('query') || ''))
      .toBe("match_all('timeout')");
    await expect(page.locator(runBtn)).not.toHaveAttribute('data-run-pending', 'true');
  });

  test('edits clear mixed-filter decorations and restore pure text without a search (AC-BW.8)', {
    tag: ['@freeText', '@logs'],
  }, async ({ page }) => {
    const searches = await open(page, FTS, 'timeout');
    await new PageManager(page).logsPage.setQueryEditorContent('timeout');
    const term = page.locator(`${editor} .o2-free-text-term`);
    await expect(term.first()).toBeVisible();
    const before = searches.all().length;
    await page.locator(editor).first().click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(" AND level='x'");
    await expect(term).toHaveCount(0, { timeout: 500 });
    expect(await editorText(page)).toBe("timeout AND level='x'");
    expect(searches.all()).toHaveLength(before);
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText('timeout');
    await expect(term.first()).toBeVisible({ timeout: 500 });
    expect(await editorText(page)).toBe('timeout');
    expect(searches.all()).toHaveLength(before);
    await term.first().hover();
    await expect(page.locator('.monaco-hover:not(.hidden)').first()).toContainText('all words, any order');
    await expect(page.locator('.monaco-hover:not(.hidden)').first()).toContainText("Runs as match_all('timeout')");
  });

  test('minus words exclude while minus numbers remain text (AC-BW.9)', {
    tag: ['@freeText', '@logs'],
  }, async ({ page, request }) => {
    for (const [raw, where, total] of [
      ['-debug', "NOT match_all('debug')", 32],
      ['-500', "match_all('-500')", 8],
    ]) {
      const searches = await open(page, FTS, raw);
      const sql = await run(page, searches);
      expect(sql).toBe(`select * from "${FTS}"  WHERE ${where}`);
      await expect.poll(() => editorText(page), { timeout: 15000 }).toBe(where);
      expect(await apiTotal(request, sql)).toBe(total);
      const dataRows = page.locator('[data-test="logs-search-result-logs-table"] tbody tr[data-test^="o2-table-row-"]');
      await expect(dataRows.first()).toBeVisible({ timeout: 30000 });
      if (raw === '-debug') await expect(dataRows.first()).not.toContainText('debug');
      else await expect(dataRows.first()).toContainText('-500');
    }
  });

  test('LIMIT words run as text and field-like LIMIT filters still show the guard (AC-BW.10)', {
    tag: ['@freeText', '@logs'],
  }, async ({ page, request }) => {
    const searches = await open(page, FTS, 'limit 50');
    const sql = await run(page, searches);
    expect(sql).toBe(`select * from "${FTS}"  WHERE match_all('limit') AND match_all('50')`);
    await expect
      .poll(() => editorText(page), { timeout: 15000 })
      .toBe("match_all('limit') AND match_all('50')");
    expect(await apiTotal(request, sql)).toBe(8);
    await expect(page.locator('[data-test="logs-search-result-logs-table"] tbody tr[data-test^="o2-table-row-"]')).toHaveCount(8, { timeout: 30000 });

    const guarded = await open(page, FTS, 'enabled limit 5');
    await page.locator(runBtn).click();
    await expect(page.getByText('LIMIT is not supported without SQL mode.').first()).toBeVisible();
    expect(guarded.all()).toHaveLength(0);
    expect(await editorText(page)).toBe('enabled limit 5');
  });

  test('a stream with no full-text field sends nothing and shows the panel (AC3.1, AC3.4, AC6.1)', {
    tag: ['@freeText', '@logs'],
  }, async ({ page }) => {
    const searches = await open(page, NOFTS, 'timeout');
    await page.locator(runBtn).click();

    await expect(page.locator(panel)).toContainText(`Word search is not configured for ${NOFTS}`, { timeout: 30000 });
    expect(searches.hits()).toHaveLength(0);
    await page.locator('[data-test="logs-search-bar-more-options-btn"]').click();
    const alertItem = page.locator('[data-test="logs-create-alert-btn"]');
    await expect(alertItem).toBeDisabled();
    await page.keyboard.press('Escape');

    await page.locator('[data-test="logs-no-fts-configure-btn"]').click();
    await expect.poll(() => new URL(page.url()).pathname).toContain('/streams');
    expect(new URL(page.url()).searchParams.get('dialog')).toBe(NOFTS);
  });

  test('a stream with no string field says there is nothing to search (AC3.5, AC3.7)', {
    tag: ['@freeText', '@logs'],
  }, async ({ page }) => {
    const searches = await open(page, NOTEXT, 'timeout');
    await page.locator(runBtn).click();
    await expect(page.locator(panel)).toContainText('This stream has no text fields to search.', {
      timeout: 30000,
    });
    expect(searches.hits()).toHaveLength(0);
  });

  test('mixed streams send only the full-text arm and name the other (AC4.1, AC4.3)', {
    tag: ['@freeText', '@logs'],
  }, async ({ page }) => {
    const searches = await open(page, `${FTS},${NOFTS}`, 'timeout');
    const sql = await run(page, searches);

    expect(sql).toContain(`"${FTS}"`);
    expect(sql).toContain("match_all('timeout')");
    expect(sql).not.toContain(`"${NOFTS}"`);
    const banner = page.locator('[data-test="logs-missing-stream-banner"]');
    await expect(banner).toContainText(NOFTS, { timeout: 30000 });
    await expect(banner).toContainText('was skipped because word search is not configured');
    await expect(page.locator('[data-test="logs-search-filter-error-message"]')).toHaveCount(0);
  });

  test('a mix with no connective is sent unchanged and Run as recovers it; an AND mix is rewritten (AC5.6, AC2.2)', {
    tag: ['@freeText', '@logs'],
  }, async ({ page, request }) => {
    const searches = await open(page, FTS, "service_name='api' timeout");
    const first = await run(page, searches);
    expect(first).toContain("WHERE service_name = 'api' timeout");

    const card = page.locator('[data-test="query-error-run-suggestion-card"]');
    await expect(card).toContainText("service_name='api' AND match_all('timeout')", { timeout: 30000 });
    await expect(page.locator('[data-test="query-error-search-text-card"]')).toHaveCount(0);

    const before = searches.hits().length;
    await card.click();
    await expect.poll(() => searches.hits().length, { timeout: 30000 }).toBeGreaterThan(before);
    await expect.poll(() => editorText(page)).toBe("service_name='api' AND match_all('timeout')");
    expect(decodedSql(searches.hits().at(-1))).toContain("WHERE service_name = 'api' AND match_all('timeout')");
    await expect(page.locator(rows).first()).toBeVisible({ timeout: 30000 });

    testLogger.info('A quoted phrase joined to a field by AND is rewritten on the first run (1-Q7 replaced)');
    const searches2 = await open(page, FTS, `"connection refused" AND service_name='api'`);
    const phraseSql = await run(page, searches2);
    expect(phraseSql).toContain("WHERE match_all('connection refused') AND service_name = 'api'");
    await expect(page.locator(rows).first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-test="query-error-run-suggestion-card"]')).toHaveCount(0);
    const narrowed = await apiTotal(
      request,
      `SELECT * FROM "${FTS}" WHERE match_all('connection refused') AND service_name='api'`,
    );
    const phraseOnly = await apiTotal(request, `SELECT * FROM "${FTS}" WHERE match_all('connection refused')`);
    expect(narrowed).toBeGreaterThan(0);
    expect(narrowed).toBeLessThan(phraseOnly);
  });

  test('unclassified input offers Search text, which writes durable match_all (AC5.1, AC5.2)', {
    tag: ['@freeText', '@logs'],
  }, async ({ page }) => {
    const searches = await open(page, FTS, 'status =');
    expect(await run(page, searches)).toContain('WHERE status =');

    const card = page.locator('[data-test="query-error-search-text-card"]');
    await expect(card).toContainText('Search text for "status ="', { timeout: 30000 });
    const before = searches.hits().length;
    await card.click();
    await expect.poll(() => searches.hits().length, { timeout: 30000 }).toBeGreaterThan(before);
    expect(decodedSql(searches.hits().at(-1))).toContain("match_all('status =')");
    await expect.poll(() => editorText(page)).toBe("match_all('status =')");
    await expect(page.locator(errorState)).toHaveCount(0);
  });

  test('the SQL toggle renders the word, and is refused on a no-FTS stream (AC6.3)', {
    tag: ['@freeText', '@logs'],
  }, async ({ page }) => {
    // The toolbar toggle is gone; SQL mode is switched the way saved views and quick mode do.
    const logsPage = new PageManager(page).logsPage;
    await open(page, FTS, 'timeout');
    await logsPage._setSqlModeViaVue(true);
    await expect
      .poll(() => editorText(page), { timeout: 15000 })
      .toBe(`SELECT * FROM "${FTS}" WHERE match_all('timeout')`);

    await open(page, NOFTS, 'timeout');
    await logsPage._setSqlModeViaVue(true);
    await expect(page.locator(panel)).toBeVisible({ timeout: 15000 });
    await expect.poll(() => logsPage._isSqlModeEnabledViaVue()).toBe(false);
    expect(await editorText(page)).toBe('timeout');
  });

  test('field values use the rendered text and keep the results (AC6.4)', {
    tag: ['@freeText', '@logs'],
  }, async ({ page }) => {
    const searches = await open(page, FTS, 'timeout');
    await run(page, searches);
    await expect(page.locator(rows).first()).toBeVisible({ timeout: 30000 });

    const valuesRequest = page.waitForRequest((r) => /_values/.test(r.url()) && r.method() === 'POST');
    await page.locator('[data-test="log-search-expand-level-field-btn"]').click();
    const body = JSON.parse((await valuesRequest).postData() || '{}');
    expect(unb64(body.sql)).toContain("match_all('timeout')");
    await expect(page.locator('[data-test="logs-search-subfield-add-level-error"]')).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator('[data-test="logs-search-filter-error-message"]')).toHaveCount(0);
    await expect(page.locator(rows).first()).toBeVisible();
  });

  test('a facet include materialises the text and wraps every branch (AC6.9)', {
    tag: ['@freeText', '@logs'],
  }, async ({ page }) => {
    const searches = await open(page, FTS, 'timeout OR refused');
    await run(page, searches);
    await page.locator('[data-test="log-search-expand-level-field-btn"]').click();
    const value = page.locator('[data-test="logs-search-subfield-add-level-error"]');
    await value.waitFor({ timeout: 30000 });
    await value.locator('[role="checkbox"], button, input').first().click();

    await expect
      .poll(async () => (await editorText(page)).replace(/\s+/g, ' '), { timeout: 15000 })
      .toBe("( match_all('timeout') OR match_all('refused') ) AND level = 'error'");
  });

  test('text that only contains select and from stays a filter (spec 6.4)', {
    tag: ['@freeText', '@logs'],
  }, async ({ page }) => {
    const logsPage = new PageManager(page).logsPage;
    await open(page, FTS, '');
    await logsPage.setQueryEditorContent('selected from cache');
    await expect
      .poll(() => logsPage._mutateSearchObj((searchObj) => searchObj.data.query))
      .toBe('selected from cache');
    expect(await logsPage._isSqlModeEnabledViaVue()).toBe(false);

    await logsPage.setQueryEditorContent(`SELECT * FROM "${FTS}"`);
    await expect.poll(() => logsPage._isSqlModeEnabledViaVue(), { timeout: 15000 }).toBe(true);
  });

  test('a CTE whose outer projection is not a stream field flips to SQL and is sent as written (spec 6.4)', {
    tag: ['@freeText', '@logs'],
  }, async ({ page }) => {
    const logsPage = new PageManager(page).logsPage;
    const searches = await open(page, FTS, '');
    const cte = `WITH q AS (SELECT body AS message FROM "${FTS}") SELECT message FROM q`;
    await logsPage.setQueryEditorContent(cte);
    await expect.poll(() => logsPage._isSqlModeEnabledViaVue(), { timeout: 15000 }).toBe(true);
    await expect(page.locator(runBtn)).toBeEnabled({ timeout: 30000 });
    expect(await run(page, searches)).toBe(cte);
    await expect(page.locator(rows).first()).toBeVisible({ timeout: 30000 });
  });

  test('Build disables Run while it cannot hold the text search, and sends no chart query (AC6.6)', {
    tag: ['@freeText', '@logs'],
  }, async ({ page }) => {
    const searches = await open(page, FTS, 'NOT timeout');
    // The load run shows its rendered SQL, which Build can hold; retype the text to test the gate.
    await new PageManager(page).logsPage.setQueryEditorContent('NOT timeout');
    const gridSql = `select * from "${FTS}"  WHERE NOT match_all('timeout')`;
    await page.locator('[data-test="logs-build-toggle"]').click();
    await expect(page.locator('[data-test="logs-build-free-text-notice"]')).toBeVisible({ timeout: 30000 });
    const before = searches.all().length;

    const buildRun = page.locator('[data-test="logs-search-bar-visualize-refresh-btn"]');
    await expect(buildRun).toBeDisabled();
    await buildRun.click({ force: true });
    await page.locator('[data-test="logs-search-bar-refresh-cache-dropdown-trigger"]').click();
    const refreshItem = page.locator('[data-test="logs-search-bar-refresh-btn"]').last();
    await expect(refreshItem).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');

    // A later grid run orders the request log: a chart query from the clicks above would precede it.
    await page.locator('[data-test="logs-logs-toggle"]').click();
    await expect(page.locator(runBtn)).toBeEnabled({ timeout: 30000 });
    expect(await run(page, searches)).toBe(gridSql);
    const sinceBuild = searches.all().slice(before);
    expect(sinceBuild.filter((r) => r.type === 'hits').map((r) => decodedSql(r))).toEqual([gridSql]);
  });

  test('L-24 schema variants answer a bare word with no 4xx: FTS, no FTS, no text, mixed', {
    tag: ['@freeText', '@logs'],
  }, async ({ page }) => {
    const failures = [];
    page.on('response', (response) => {
      if (response.url().includes('/api/') && response.status() >= 400) {
        failures.push(`${response.status()} ${response.url()}`);
      }
    });
    const cases = [
      { streams: FTS, shows: rows },
      { streams: NOFTS, shows: panel },
      { streams: NOTEXT, shows: panel },
      { streams: `${FTS},${NOFTS}`, shows: rows },
    ];
    for (const { streams, shows } of cases) {
      testLogger.info(`variant ${streams}`);
      const searches = await open(page, streams, 'timeout');
      await page.locator(runBtn).click();
      await expect(page.locator(shows).first()).toBeVisible({ timeout: 30000 });
      if (shows === panel) expect(searches.hits()).toHaveLength(0);
    }
    expect(failures).toEqual([]);
  });

  test('a link with a field filter from before the change sends the same SQL (L-29, AC2.3)', {
    tag: ['@freeText', '@logs'],
  }, async ({ page }) => {
    const searches = await open(page, FTS, "level='error'");
    expect(await run(page, searches)).toBe(`select * from "${FTS}"  WHERE level = 'error'`);
    await expect(page.locator(rows).first()).toBeVisible({ timeout: 30000 });
  });
});
