const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

const ORG = process.env['ORGNAME'] || 'default';

test.describe('Command palette', () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('opens with the keyboard shortcut and jumps to a page with org_identifier', {
    tag: ['@commandPalette', '@general', '@smoke', '@P0', '@all'],
  }, async ({ page }) => {
    await pm.commandPalettePage.openWithKeyboard();
    await pm.commandPalettePage.type('logs');
    await pm.commandPalettePage.expectFirstRow('page:logs');
    await pm.commandPalettePage.pressEnter();
    await pm.commandPalettePage.expectClosed();
    await pm.commandPalettePage.expectUrl(/\/web\/logs/, ORG);
  });

  test('opens from the header trigger while a query editor has focus, and Escape closes it', {
    tag: ['@commandPalette', '@general', '@P1', '@all'],
  }, async ({ page }) => {
    await page.goto(`${process.env['ZO_BASE_URL']}/web/logs?org_identifier=${ORG}`);
    await page.waitForLoadState('domcontentloaded');
    await pm.commandPalettePage.openFromHeader();
    await pm.commandPalettePage.close();
    await page.locator('[data-test="logs-search-bar-query-editor"]').click();
    await pm.commandPalettePage.openWithKeyboard();
    await pm.commandPalettePage.close();
  });

  test('remembers the last opened page in the recent group', {
    tag: ['@commandPalette', '@general', '@P1', '@all'],
  }, async ({ page }) => {
    await pm.commandPalettePage.openWithKeyboard();
    await pm.commandPalettePage.type('dashboards');
    await pm.commandPalettePage.expectFirstRow('page:dashboards');
    await pm.commandPalettePage.pressEnter();
    await pm.commandPalettePage.expectUrl(/\/web\/dashboards/, ORG);
    await pm.commandPalettePage.openWithKeyboard();
    await pm.commandPalettePage.expectInRecent('page:dashboards');
    await pm.commandPalettePage.close();
  });

  test('narrows to dashboards with a scope chip and opens one', {
    tag: ['@commandPalette', '@general', '@P1', '@all'],
  }, async ({ page }) => {
    await pm.commandPalettePage.openWithKeyboard();
    await pm.commandPalettePage.selectScope('dashboard');
    await pm.commandPalettePage.expectFirstRow('action:newDashboard');
    await pm.commandPalettePage.expectRowsOfType('dashboard');
    await pm.commandPalettePage.selectScope('alert');
    await pm.commandPalettePage.expectRowsOfType('alert');
    await pm.commandPalettePage.expectRowsOfType('dashboard');
    await pm.commandPalettePage.deselectScope('alert');
    const first = pm.commandPalettePage.list.locator('[role="option"][data-test="command-palette-row-dashboard"]').first();
    const id = await first.getAttribute('data-item-id');
    await first.click();
    await pm.commandPalettePage.expectClosed();
    await pm.commandPalettePage.expectUrl(/\/web\/dashboards\/view\?/, ORG);
    expect(page.url()).toContain(`dashboard=${id.split('/').pop()}`);
  });

  test('finds a stream by name and opens it in the logs explorer', {
    tag: ['@commandPalette', '@general', '@P1', '@all'],
  }, async ({ page }) => {
    await pm.commandPalettePage.openWithKeyboard();
    await pm.commandPalettePage.type('e2e_automate');
    await pm.commandPalettePage.expectRowsOfType('stream');
    await pm.commandPalettePage.list.locator('[role="option"][data-item-id="stream:logs/e2e_automate"]').click();
    await pm.commandPalettePage.expectClosed();
    await pm.commandPalettePage.expectUrl(/\/web\/logs/, ORG);
    expect(new URL(page.url()).searchParams.get('stream')).toBe('e2e_automate');
  });

  test('shows the empty state for a query with no matches', {
    tag: ['@commandPalette', '@general', '@P2', '@all'],
  }, async () => {
    await pm.commandPalettePage.openWithKeyboard();
    await pm.commandPalettePage.type('zzqxv');
    await pm.commandPalettePage.expectNoMatches();
    await pm.commandPalettePage.close();
  });
});
