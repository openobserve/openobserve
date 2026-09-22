/**
 * Keyboard Shortcut Cheatsheet — Entry Gating (AI Chat)
 *
 * ShortcutCheatsheet.vue renders the global keyboard-shortcut dialog. Because
 * one frontend bundle ships to OSS, Enterprise, and Cloud, every entry/module
 * carries a visibility gate driven by build-time flags (config.isEnterprise /
 * config.isCloud) and runtime /config flags (ai_enabled, rbac_enabled,
 * incidents_enabled, online_evals_enabled, ...).
 *
 * The gate is symmetric, so the spec carries both branches: the OSS branch
 * asserts the AI Chat entry (aiChatToggle), fully-gated module chips, and
 * flag-gated page rows are absent, while the Enterprise branch asserts the same
 * gates are present (except the meta-org-only surfaces, which stay absent in
 * the default org). Exactly one branch runs per environment — the active build
 * is detected from the live /api/{org}/config response's build_type
 * (StatusPagesPage.detectBuildType), the same split the status-pages gating
 * spec uses — so a stray build skips cleanly instead of false-failing. The
 * open/close/search mechanics are edition-agnostic and run everywhere.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

test.describe('Keyboard Shortcut Cheatsheet Entry Gating (AI Chat)', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let orgId;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    orgId = process.env['ORGNAME'] || 'default';
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test('OSS - cheatsheet opens and the AI Chat entry is gated', {
    tag: ['@shortcut-cheatsheet-gating', '@all', '@oss'],
  }, async () => {
    const buildType = await pm.statusPagesPage.detectBuildType(orgId);
    test.skip(buildType !== 'opensource', `Runs only on OSS build (detected: ${buildType})`);

    testLogger.step('Opening the cheatsheet via the Help menu');
    await pm.shortcutCheatsheetPage.openViaHelpMenu();

    testLogger.step('Asserting never-gated Global rows are present');
    await pm.shortcutCheatsheetPage.expectRowPresent('openCheatsheet');
    await pm.shortcutCheatsheetPage.expectRowPresent('closeDialog');

    testLogger.step('Asserting the AI Chat entry is gated off on OSS');
    await pm.shortcutCheatsheetPage.expectRowAbsent('aiChatToggle');

    testLogger.info('OSS cheatsheet AI Chat gating validation completed');
  });

  test('OSS - enterprise/cloud-only module chips are gated off', {
    tag: ['@shortcut-cheatsheet-gating', '@all', '@oss'],
  }, async () => {
    const buildType = await pm.statusPagesPage.detectBuildType(orgId);
    test.skip(buildType !== 'opensource', `Runs only on OSS build (detected: ${buildType})`);

    testLogger.step('Opening the cheatsheet via the Help menu');
    await pm.shortcutCheatsheetPage.openViaHelpMenu();

    testLogger.step('Asserting fully-gated module chips are absent');
    await pm.shortcutCheatsheetPage.expectChipAbsent('settings');
    await pm.shortcutCheatsheetPage.expectChipAbsent('online-evals');
    await pm.shortcutCheatsheetPage.expectChipAbsent('actions');
    await pm.shortcutCheatsheetPage.expectChipAbsent('running-queries');

    testLogger.step('Asserting the always-visible Global chip is present');
    await pm.shortcutCheatsheetPage.expectChipPresent('global');

    testLogger.info('OSS cheatsheet module chip gating validation completed');
  });

  test('OSS - gated page rows are dropped from otherwise-visible modules', {
    tag: ['@shortcut-cheatsheet-gating', '@all', '@oss'],
  }, async () => {
    const buildType = await pm.statusPagesPage.detectBuildType(orgId);
    test.skip(buildType !== 'opensource', `Runs only on OSS build (detected: ${buildType})`);

    testLogger.step('Opening the cheatsheet via the Help menu');
    await pm.shortcutCheatsheetPage.openViaHelpMenu();

    testLogger.step('Asserting flag-gated page rows are absent inside shared modules');
    await pm.shortcutCheatsheetPage.expectRowAbsent('searchSchedulersRefresh');
    await pm.shortcutCheatsheetPage.expectRowAbsent('alertSourcesRefresh');
    await pm.shortcutCheatsheetPage.expectRowAbsent('iamRolesRefresh');
    await pm.shortcutCheatsheetPage.expectRowAbsent('iamGroupsRefresh');
    await pm.shortcutCheatsheetPage.expectRowAbsent('actionsRefresh');

    testLogger.info('OSS cheatsheet page-level gating validation completed');
  });

  test('ENT - cheatsheet opens and the AI Chat entry is present', {
    tag: ['@shortcut-cheatsheet-gating', '@all', '@enterprise'],
  }, async () => {
    const buildType = await pm.statusPagesPage.detectBuildType(orgId);
    test.skip(buildType !== 'enterprise', `Runs only on Enterprise build (detected: ${buildType})`);

    testLogger.step('Opening the cheatsheet via the Help menu');
    await pm.shortcutCheatsheetPage.openViaHelpMenu();

    testLogger.step('Asserting never-gated Global rows are present');
    await pm.shortcutCheatsheetPage.expectRowPresent('openCheatsheet');
    await pm.shortcutCheatsheetPage.expectRowPresent('closeDialog');

    testLogger.step('Asserting the AI Chat entry is present on Enterprise');
    await pm.shortcutCheatsheetPage.expectRowPresent('aiChatToggle');

    testLogger.info('Enterprise cheatsheet AI Chat gating validation completed');
  });

  test('ENT - enterprise/cloud-only module chips are present', {
    tag: ['@shortcut-cheatsheet-gating', '@all', '@enterprise'],
  }, async () => {
    const buildType = await pm.statusPagesPage.detectBuildType(orgId);
    test.skip(buildType !== 'enterprise', `Runs only on Enterprise build (detected: ${buildType})`);

    testLogger.step('Opening the cheatsheet via the Help menu');
    await pm.shortcutCheatsheetPage.openViaHelpMenu();

    testLogger.step('Asserting fully-gated module chips are present');
    await pm.shortcutCheatsheetPage.expectChipPresent('settings');
    await pm.shortcutCheatsheetPage.expectChipPresent('online-evals');
    await pm.shortcutCheatsheetPage.expectChipPresent('actions');

    testLogger.step('Asserting the always-visible Global chip is present');
    await pm.shortcutCheatsheetPage.expectChipPresent('global');

    testLogger.step('Asserting the meta-org-only running-queries chip stays absent');
    await pm.shortcutCheatsheetPage.expectChipAbsent('running-queries');

    testLogger.info('Enterprise cheatsheet module chip gating validation completed');
  });

  test('ENT - gated page rows are present inside shared modules', {
    tag: ['@shortcut-cheatsheet-gating', '@all', '@enterprise'],
  }, async () => {
    const buildType = await pm.statusPagesPage.detectBuildType(orgId);
    test.skip(buildType !== 'enterprise', `Runs only on Enterprise build (detected: ${buildType})`);

    testLogger.step('Opening the cheatsheet via the Help menu');
    await pm.shortcutCheatsheetPage.openViaHelpMenu();

    testLogger.step('Asserting edition-gated page rows are present inside shared modules');
    await pm.shortcutCheatsheetPage.expectRowPresent('searchSchedulersRefresh');
    await pm.shortcutCheatsheetPage.expectRowPresent('alertSourcesRefresh');
    await pm.shortcutCheatsheetPage.expectRowPresent('actionsRefresh');

    testLogger.step('Asserting flag-gated page rows (rbac) remain absent with rbac disabled');
    await pm.shortcutCheatsheetPage.expectRowAbsent('iamRolesRefresh');
    await pm.shortcutCheatsheetPage.expectRowAbsent('iamGroupsRefresh');

    testLogger.info('Enterprise cheatsheet page-level gating validation completed');
  });

  test('Cheatsheet reopens via the shift+? toggle after being closed', {
    tag: ['@shortcut-cheatsheet-gating', '@all'],
  }, async () => {
    testLogger.step('Opening then closing the cheatsheet so no input holds focus');
    await pm.shortcutCheatsheetPage.openViaHelpMenu();
    await pm.shortcutCheatsheetPage.close();

    testLogger.step('Reopening via the global shift+? binding');
    await pm.shortcutCheatsheetPage.openViaShortcut();

    testLogger.step('Asserting the dialog content re-mounted');
    await pm.shortcutCheatsheetPage.expectRowPresent('openCheatsheet');

    testLogger.info('Cheatsheet keyboard toggle validation completed');
  });

  test('Nonsense search shows the empty state then rows reappear on clear', {
    tag: ['@shortcut-cheatsheet-gating', '@all'],
  }, async () => {
    testLogger.step('Opening the cheatsheet via the Help menu');
    await pm.shortcutCheatsheetPage.openViaHelpMenu();

    testLogger.step('Filtering with a non-matching query');
    await pm.shortcutCheatsheetPage.search('zzzz-no-match');
    await pm.shortcutCheatsheetPage.expectNoResultsVisible();

    testLogger.step('Clearing the query and asserting rows reappear');
    await pm.shortcutCheatsheetPage.clearSearch();
    await pm.shortcutCheatsheetPage.expectNoResultsHidden();
    await pm.shortcutCheatsheetPage.expectRowPresent('openCheatsheet');

    testLogger.info('Cheatsheet search empty-state validation completed');
  });

  test('Close button hides the dialog', {
    tag: ['@shortcut-cheatsheet-gating', '@all'],
  }, async () => {
    testLogger.step('Opening the cheatsheet via the Help menu');
    await pm.shortcutCheatsheetPage.openViaHelpMenu();

    testLogger.step('Closing via the close button and asserting the dialog is removed');
    await pm.shortcutCheatsheetPage.close();

    testLogger.info('Cheatsheet close-button validation completed');
  });
});
