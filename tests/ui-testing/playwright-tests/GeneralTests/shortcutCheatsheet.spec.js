// Keyboard Shortcut Cheatsheet Edition Gating — OSS edition tests.
//
// ShortcutCheatsheet.vue lists every app shortcut grouped into module chips and page
// rows, and this change gates each group behind its feature's own route guard. On an
// OSS build (config.isEnterprise / config.isCloud === "false") every enterprise/cloud/
// flag-gated page is omitted and any module whose pages are all gated off (Settings,
// Online Evals, Actions, Running Queries) drops its chip entirely.
//
// The gating is driven solely by build-time flags — not the async /config fetch — so
// the OSS assertions are deterministic with no wait-for-config needed. Gated modules
// are ABSENT from the DOM (not disabled), so assertions use toHaveCount(0).

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe('Keyboard Shortcut Cheatsheet Edition Gating testcases', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  test('OSS - cheatsheet opens via help menu and drops gated module chips', {
    tag: ['@shortcut-cheatsheet-edition-gating', '@all', '@oss'],
  }, async ({ page }) => {
    const edition = await pm.editionFeaturesPage.detectEdition();
    test.skip(edition !== 'opensource', `Runs only on OSS build (detected: ${edition})`);

    testLogger.step('Opening the cheatsheet via the Help menu');
    await pm.shortcutCheatsheetPage.openViaHelpMenu();

    testLogger.step('Verifying all 12 core OSS module chips render');
    await pm.shortcutCheatsheetPage.expectCoreChipsPresent();

    testLogger.step('Verifying the 4 fully-gated module chips are absent from the DOM');
    await pm.shortcutCheatsheetPage.expectGatedChipsAbsent();

    testLogger.info('OSS module-chip gating validation completed');
  });

  test('OSS - enterprise/cloud-only pages are hidden within surviving modules', {
    tag: ['@shortcut-cheatsheet-edition-gating', '@all', '@oss'],
  }, async ({ page }) => {
    const edition = await pm.editionFeaturesPage.detectEdition();
    test.skip(edition !== 'opensource', `Runs only on OSS build (detected: ${edition})`);

    testLogger.step('Opening the cheatsheet via the Help menu');
    await pm.shortcutCheatsheetPage.openViaHelpMenu();

    testLogger.step('Verifying a core OSS page row still renders');
    await pm.shortcutCheatsheetPage.expectRowVisible('logsRunQuery');

    testLogger.step('Verifying enterprise/cloud/flag-gated page rows are absent');
    await pm.shortcutCheatsheetPage.expectGatedRowsAbsent();

    testLogger.info('OSS page-level gating validation completed');
  });

  test('toggles via shift+?, close button, and Escape', {
    tag: ['@shortcut-cheatsheet-edition-gating', '@all'],
  }, async ({ page }) => {
    testLogger.step('Opening via shift+?');
    await pm.shortcutCheatsheetPage.pressToggleKey();
    await pm.shortcutCheatsheetPage.expectOpen();

    testLogger.step('Toggling closed via shift+?');
    await pm.shortcutCheatsheetPage.pressToggleKey();
    await pm.shortcutCheatsheetPage.expectClosed();

    testLogger.step('Reopening and closing via the close button');
    await pm.shortcutCheatsheetPage.pressToggleKey();
    await pm.shortcutCheatsheetPage.expectOpen();
    await pm.shortcutCheatsheetPage.closeViaButton();

    testLogger.step('Reopening and closing via Escape');
    await pm.shortcutCheatsheetPage.pressToggleKey();
    await pm.shortcutCheatsheetPage.expectOpen();
    await pm.shortcutCheatsheetPage.closeViaEscape();

    testLogger.info('Toggle/close mechanisms validated');
  });

  test('filters rows via search and shows the no-results empty state', {
    tag: ['@shortcut-cheatsheet-edition-gating', '@all'],
  }, async ({ page }) => {
    testLogger.step('Opening the cheatsheet via the Help menu');
    await pm.shortcutCheatsheetPage.openViaHelpMenu();

    testLogger.step('Searching for a real action term');
    await pm.shortcutCheatsheetPage.search('run search');
    await pm.shortcutCheatsheetPage.expectRowVisible('logsRunQuery');
    await pm.shortcutCheatsheetPage.expectChipAbsent('traces');

    testLogger.step('Searching for a nonsense term and asserting the empty state');
    await pm.shortcutCheatsheetPage.search('zzzz');
    await pm.shortcutCheatsheetPage.expectNoResults();

    testLogger.info('Search filtering and empty-state validated');
  });

  test('clicking a chip scrolls to and highlights its module', {
    tag: ['@shortcut-cheatsheet-edition-gating', '@all'],
  }, async ({ page }) => {
    testLogger.step('Opening the cheatsheet via the Help menu');
    await pm.shortcutCheatsheetPage.openViaHelpMenu();

    testLogger.step('Clicking the Traces chip');
    await pm.shortcutCheatsheetPage.clickChip('traces');

    testLogger.step('Verifying the Traces module block gains the highlight class');
    await pm.shortcutCheatsheetPage.expectModuleHighlighted('Traces');

    testLogger.info('Chip scroll-and-highlight validated');
  });
});
