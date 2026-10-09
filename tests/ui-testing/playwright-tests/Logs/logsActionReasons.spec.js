// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const { trackSearches, ingestRows } = require('../utils/auto-run-helpers.js');
const PageManager = require('../../pages/page-manager.js');

const ORG = `actionreasons${Date.now()}`;
const STREAM = 'action_logs';
const run = '[data-test="logs-search-bar-refresh-btn"]';
const table = '[data-test="logs-search-result-logs-table"]';
const ids = {
  more: ['logs-create-alert-btn', 'search-download-submenu-trigger', 'logs-search-bar-download-custom-range-btn'],
  utilities: ['logs-search-bar-menu-create-saved-view-btn'],
  saved: ['logs-search-bar-saved-views-menu-create'],
};
const EDITED_NOTE = 'Uses your edited query (not run yet)';
const notes = {
  'logs-create-alert-btn': EDITED_NOTE,
  'search-scheduler-create-new-btn': EDITED_NOTE,
  'logs-search-bar-menu-create-saved-view-btn': EDITED_NOTE,
  'logs-search-bar-saved-views-menu-create': EDITED_NOTE,
  'search-download-submenu-trigger': 'Downloads the shown results, not your edit',
  'logs-search-bar-download-custom-range-btn': 'Uses the query that last ran, not your edit',
};
const baseAxeNodes = [
  { id: 'aria-allowed-attr', target: '[role="menu"] div[aria-haspopup="menu"]:has(> [data-cy="syntax-guide-button"])' },
  { id: 'aria-required-children', target: '[role="menu"]:has([data-test="logs-search-bar-menu-create-saved-view-btn"])' },
  { id: 'button-name', target: '[data-test="logs-search-bar-sql-mode-toggle-btn"]' },
  { id: 'button-name', target: '[data-test="logs-search-bar-show-histogram-toggle-btn-btn"]' },
  { id: 'button-name', target: '[data-test="logs-search-bar-quick-mode-switch-btn"]' },
  { id: 'button-name', target: '[data-test="logs-search-bar-show-query-toggle-btn-btn"]' },
  { id: 'color-contrast', target: '[data-test="logs-search-bar-menu-transform-editor-toggle-btn"] > .italic' },
  { id: 'color-contrast', target: '[data-test="search-history-item-btn"] kbd' },
];
async function open(page) {
  await navigateToBase(page);
  await page.goto(`/web/logs?org_identifier=${ORG}&stream=${STREAM}&stream_type=logs&period=15m&refresh=0&sql_mode=false&quick_mode=false&show_histogram=false`);
  await page.locator('[data-test="logs-search-bar-query-editor"]').waitFor();
  await page.locator(run).click();
  await expect(page.locator(`${table} tbody tr[data-test^="o2-table-row-"]`)).toHaveCount(2);
  await expect(page.locator(run)).toContainText('Run query');
}
async function settleMenu(page) {
  await page.locator('[role="menu"]').first().evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished));
  });
}

test.describe.configure({ mode: 'serial' });
test.describe('G1 visible action reasons C2', () => {
  test.beforeAll(async ({ request }) => {
    const at = (Date.now() - 120000) * 1000;
    await ingestRows(request, ORG, STREAM, [{ _timestamp: at, level: 'error', body: 'error request' }, { _timestamp: at + 1, level: 'info', body: 'healthy' }]);
  });

  for (const theme of ['light', 'dark']) {
    test(`${theme}: edited-not-run actions stay enabled with readable notes, take keyboard focus, and a run clears the notes (AC-C2.1-C2.3, Reinstated)`, async ({ page }) => {
      await page.addInitScript((theme) => { localStorage.setItem('theme', theme); localStorage.setItem('oo_toggle_auto_run', 'false'); }, theme);
      await open(page);
      const manager = new PageManager(page);
      await manager.logsPage.setQueryEditorContent("level = 'error'");
      const requests = trackSearches(page);
      const writes = [];
      page.on('request', (request) => {
        if (['POST', 'PUT', 'DELETE'].includes(request.method()) && /\/(alerts|savedviews|search_jobs)(\/|\?|$)/.test(request.url())) writes.push(request.url());
      });
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.locator('[data-test="logs-search-bar-utilities-menu-btn"]').click();
      const pin = page.locator('[data-test="logs-search-bar-menu-pin-saved-views-btn"]');
      if ((await pin.getAttribute('title')) === 'Pin to toolbar') await pin.click();
      await page.keyboard.press('Escape');
      for (const menu of ['utilities', 'saved', 'more']) {
        const trigger = page.locator(`[data-test="${menu === 'saved' ? 'logs-search-bar-saved-views-pinned-list-btn' : `logs-search-bar-${menu === 'more' ? 'more-options' : 'utilities-menu'}-btn`}"]`);
        await trigger.click();
        await settleMenu(page);
        const scheduled = page.locator('[data-test="search-scheduler-create-new-btn"]');
        const availableIds = [...ids[menu], ...(menu === 'more' && await scheduled.count() ? ['search-scheduler-create-new-btn'] : [])];
        for (const id of availableIds) {
          const item = page.locator(`[data-test="${id}"]`);
          await expect(item).not.toHaveAttribute('aria-disabled', 'true');
          await expect(page.locator(`[data-test="${id}-reason"]`)).toHaveText(notes[id]);
          const first = page.locator('[role="menu"]').last();
          await first.press('Home');
          let reached = false;
          for (let i = 0; i < 35; i++) {
            if (await item.evaluate((element) => document.activeElement === element)) { reached = true; break; }
            await page.keyboard.press('ArrowDown');
          }
          expect(reached, `${id} participates in roving focus`).toBe(true);
          await expect(page.locator('[data-test="search-download-csv-btn"]')).toHaveCount(0);
          await expect(page.locator('[data-test="search-download-json-btn"]')).toHaveCount(0);
          if (id === 'search-download-submenu-trigger') {
            await page.keyboard.press('ArrowDown');
            await expect(page.locator('[data-test="logs-search-bar-download-custom-range-btn"]')).toBeFocused();
            await expect(page.locator('[data-test="search-download-csv-btn"]')).toHaveCount(0);
            await expect(page.locator('[data-test="search-download-json-btn"]')).toHaveCount(0);
          }
        }
        await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
        const unexpected = await page.evaluate(async (base) => {
          const { violations } = await window.axe.run({ include: [['[role="menu"]']] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } });
          return violations.flatMap((violation) => violation.nodes.filter((node) => !base.some((known) => {
            if (known.id !== violation.id || node.target.length !== 1 || typeof node.target[0] !== 'string') return false;
            const candidates = document.querySelectorAll(known.target);
            return candidates.length === 1 && candidates[0] === document.querySelector(node.target[0]);
          })).map((node) => ({ id: violation.id, target: node.target })));
        }, baseAxeNodes);
        expect(unexpected).toEqual([]);
        await page.keyboard.press('Escape');
        if (menu === 'utilities') await expect(page.locator('[role="menu"]')).toBeHidden();
        else await expect(trigger).toBeFocused();
      }
      expect(writes).toHaveLength(0);
      expect(requests.hits()).toHaveLength(0);
      await page.locator(run).click();
      await expect(page.locator(`${table} tbody tr[data-test^="o2-table-row-"]`)).toHaveCount(1);
      await expect(page.locator(run)).toContainText('Run query');
      await page.locator('[data-test="logs-search-bar-more-options-btn"]').click();
      await expect(page.locator('[data-test="logs-create-alert-btn"]')).not.toHaveAttribute('aria-disabled', 'true');
      await expect(page.locator('[data-test="logs-create-alert-btn-reason"]')).toHaveCount(0);
      await expect(page.locator('[data-test="search-download-submenu-trigger-reason"]')).toHaveCount(0);
      const download = page.locator('[data-test="search-download-submenu-trigger"]');
      await download.focus();
      for (const id of [
        'logs-search-bar-download-custom-range-btn',
        'search-scheduler-create-new-btn',
        'search-scheduler-list-btn',
        'logs-create-alert-btn',
        'search-inspect-btn',
      ]) {
        const item = page.locator(`[data-test="${id}"]`);
        if (!await item.count()) continue;
        await page.keyboard.press('ArrowDown');
        await expect(item).toBeFocused();
        await expect(page.locator('[data-test="search-download-csv-btn"]')).toHaveCount(0);
        await expect(page.locator('[data-test="search-download-json-btn"]')).toHaveCount(0);
      }
      for (const [open, close] of [['ArrowRight', 'ArrowLeft'], ['Enter', 'Escape']]) {
        await download.focus();
        await page.keyboard.press(open);
        await expect(page.locator('[data-test="search-download-csv-btn"]')).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('[data-test="search-download-json-btn"]')).toBeFocused();
        await page.keyboard.press(close);
        await expect(download).toBeFocused();
        await expect(page.locator('[data-test="search-download-csv-btn"]')).toHaveCount(0);
        await expect(page.locator('[data-test="search-download-json-btn"]')).toHaveCount(0);
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('[data-test="logs-search-bar-download-custom-range-btn"]')).toBeFocused();
      }
    });
  }
});
