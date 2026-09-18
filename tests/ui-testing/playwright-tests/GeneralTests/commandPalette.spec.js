const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const APICleanup = require('../../pages/apiCleanup.js');

const ORG = process.env['ORGNAME'] || 'default';

test.describe('Command palette', () => {
  let pm;
  let cleanup;
  let createdDashboards;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    cleanup = new APICleanup(page);
    createdDashboards = [];
  });

  test.afterEach(async ({}, testInfo) => {
    for (const d of createdDashboards) {
      await cleanup.deleteDashboard(d.dashboardId, d.folderId).catch(() => {});
    }
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('opens with the keyboard shortcut and jumps to a page with org_identifier', {
    tag: ['@commandPalette', '@general', '@smoke', '@P0', '@all'],
  }, async () => {
    await pm.commandPalettePage.openWithKeyboard();
    await pm.commandPalettePage.type('logs');
    await pm.commandPalettePage.expectFirstRow('page:logs');
    await pm.commandPalettePage.pressEnter();
    await pm.commandPalettePage.expectClosed();
    await pm.commandPalettePage.expectUrl(/\/web\/logs/, ORG);
  });

  test('opens from the header trigger while a query editor has focus, and Escape closes it', {
    tag: ['@commandPalette', '@general', '@P1', '@all'],
  }, async () => {
    await pm.commandPalettePage.gotoLogs(ORG);
    await pm.commandPalettePage.openFromHeader();
    await pm.commandPalettePage.close();
    await pm.commandPalettePage.focusLogsQueryEditor();
    await pm.commandPalettePage.openWithKeyboard();
    await pm.commandPalettePage.close();
  });

  test('remembers the last opened page in the recent group', {
    tag: ['@commandPalette', '@general', '@P1', '@all'],
  }, async () => {
    await pm.commandPalettePage.openWithKeyboard();
    await pm.commandPalettePage.type('dashboards');
    await pm.commandPalettePage.expectFirstRow('page:dashboards');
    await pm.commandPalettePage.pressEnter();
    await pm.commandPalettePage.expectUrl(/\/web\/dashboards/, ORG);
    await pm.commandPalettePage.openWithKeyboard();
    await pm.commandPalettePage.expectInRecent('page:dashboards');
    await pm.commandPalettePage.close();
  });

  test('narrows to the Dashboards rail category and opens one', {
    tag: ['@commandPalette', '@general', '@P1', '@all'],
  }, async () => {
    const title = `E2E Palette Dashboard ${Date.now()}`;
    await cleanup.createMinimalDashboard(title);
    await pm.commandPalettePage.openWithKeyboard();
    await pm.commandPalettePage.selectScope('dashboards');
    await pm.commandPalettePage.expectFirstRow('action:newDashboard');
    await pm.commandPalettePage.type(title);
    await pm.commandPalettePage.expectRowsOfType('dashboard');
    // The row id is `dashboard:<folder>/<id>`; take the real id from it rather than the create response.
    const itemId = await pm.commandPalettePage.clickFirstRowOfType('dashboard');
    const dashboardId = itemId.split('/').pop();
    createdDashboards.push({ dashboardId, folderId: 'default' });
    await pm.commandPalettePage.expectClosed();
    await pm.commandPalettePage.expectUrl(/\/web\/dashboards\/view\?/, ORG);
    await pm.commandPalettePage.expectQueryParam('dashboard', dashboardId);
  });

  test('finds a stream by name and opens it in the logs explorer', {
    tag: ['@commandPalette', '@general', '@P1', '@all'],
  }, async () => {
    await pm.commandPalettePage.openWithKeyboard();
    await pm.commandPalettePage.type('e2e_automate');
    await pm.commandPalettePage.expectRowsOfType('stream');
    await pm.commandPalettePage.clickRow('stream:logs/e2e_automate');
    await pm.commandPalettePage.expectClosed();
    await pm.commandPalettePage.expectUrl(/\/web\/logs/, ORG);
    await pm.commandPalettePage.expectQueryParam('stream', 'e2e_automate');
  });

  test('opens from the Help menu entry and jumps to a page', {
    tag: ['@commandPalette', '@general', '@P2', '@all'],
  }, async () => {
    await pm.commandPalettePage.openFromHelpMenu();
    await pm.commandPalettePage.type('logs');
    await pm.commandPalettePage.expectFirstRow('page:logs');
    await pm.commandPalettePage.pressEnter();
    await pm.commandPalettePage.expectClosed();
    await pm.commandPalettePage.expectUrl(/\/web\/logs/, ORG);
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
