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
    await expect(pm.commandPalettePage.recentGroup).toBeVisible();
    await pm.commandPalettePage.expectFirstRow('page:dashboards');
    await pm.commandPalettePage.close();
  });

  test('shows the empty state for a query with no matches', {
    tag: ['@commandPalette', '@general', '@P2', '@all'],
  }, async () => {
    await pm.commandPalettePage.openWithKeyboard();
    await pm.commandPalettePage.type('zzqxv');
    await expect(pm.commandPalettePage.emptyState).toBeVisible();
    await expect(pm.commandPalettePage.rows).toHaveCount(0);
    await pm.commandPalettePage.close();
  });
});
