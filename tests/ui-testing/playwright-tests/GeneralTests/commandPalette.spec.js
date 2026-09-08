const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

const ORG = process.env['ORGNAME'] || 'default';
const ROOT_EMAIL = process.env['ZO_ROOT_USER_EMAIL'];

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

  test('narrows to dashboards with a scope chip and opens one', {
    tag: ['@commandPalette', '@general', '@P1', '@all'],
  }, async () => {
    await pm.commandPalettePage.openWithKeyboard();
    await pm.commandPalettePage.selectScope('dashboard');
    await pm.commandPalettePage.expectFirstRow('action:newDashboard');
    await pm.commandPalettePage.expectRowsOfType('dashboard');
    await pm.commandPalettePage.selectScope('alert');
    await pm.commandPalettePage.expectRowsOfType('alert');
    await pm.commandPalettePage.expectRowsOfType('dashboard');
    await pm.commandPalettePage.deselectScope('alert');
    const id = await pm.commandPalettePage.clickFirstRowOfType('dashboard');
    await pm.commandPalettePage.expectClosed();
    await pm.commandPalettePage.expectUrl(/\/web\/dashboards\/view\?/, ORG);
    await pm.commandPalettePage.expectQueryParam('dashboard', id.split('/').pop());
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

  test('finds an admin user and opens their IAM entry from the Help menu entry', {
    tag: ['@commandPalette', '@general', '@P2', '@all'],
  }, async () => {
    test.skip(!ROOT_EMAIL, 'ZO_ROOT_USER_EMAIL is not set');
    await pm.commandPalettePage.openFromHelpMenu();
    await pm.commandPalettePage.type(ROOT_EMAIL);
    await pm.commandPalettePage.expectRowsOfType('user');
    await pm.commandPalettePage.clickFirstRowOfType('user');
    await pm.commandPalettePage.expectClosed();
    await pm.commandPalettePage.expectUrl(/\/web\/iam\/users/, ORG);
    await pm.commandPalettePage.expectQueryParam('action', 'update');
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
