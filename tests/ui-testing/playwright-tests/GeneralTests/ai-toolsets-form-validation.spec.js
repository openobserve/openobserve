// Copyright 2026 OpenObserve Inc.
// AI Toolsets — form validation E2E tests
//
// Covers: AddAiToolset (name required, MCP URL required, CLI command required, happy path)
//         CrossLinkDialog (name required, URL required, invalid URL, happy path)
//
// Cleanup notes:
//   - AI Toolsets created in the happy-path test use the prefix ai_toolset_fv_001.
//     Delete manually via Management > AI Toolsets if cleanup.spec.js does not yet
//     support AI Toolset deletion via API.
//   - Cross-link items created in the happy-path test are deleted within the test.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
// AI Toolsets is enterprise-only — its route is absent on the OSS binary. Cache
// availability so only the first test of each describe pays the probe cost; the
// rest skip immediately on OSS while running fully on the enterprise binary.
const featureAvailable = {};

// ── AddAiToolset form validation ──────────────────────────────────────────────

test.describe('AI Toolsets form validation', { tag: '@enterprise' }, () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        if (featureAvailable['ai-toolsets'] === false) {
            test.skip(true, 'AI Toolsets is an enterprise-only feature — absent in the OSS build');
            return;
        }
        featureAvailable['ai-toolsets'] = await pm.aiToolsetsFormValidation.navigateToAiToolsets();
        if (!featureAvailable['ai-toolsets']) {
            test.skip(true, 'AI Toolsets is an enterprise-only feature — absent in the OSS build');
            return;
        }
        await pm.aiToolsetsFormValidation.clickAddToolset();
        testLogger.info('Opened AddAiToolset form');
    });

    test('should show name error when form is submitted with empty name', {
        tag: ['@ai-toolsets-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing name required validation on empty submit');

        // Default kind is MCP — fill URL to isolate name error
        await pm.aiToolsetsFormValidation.fillMcpUrl('https://api.example.com/mcp/');
        await pm.aiToolsetsFormValidation.clickSave();

        await expect(pm.aiToolsetsFormValidation.getNameErrorLocator()).toBeVisible();
        await expect(pm.aiToolsetsFormValidation.getNameErrorLocator()).toContainText('Name is required');

        testLogger.info('Name required error correctly shown');
    });

    test('should show MCP URL error when form is submitted without URL', {
        tag: ['@ai-toolsets-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing MCP URL required validation on empty submit');

        // Fill a valid name but leave MCP URL empty (default kind is MCP)
        await pm.aiToolsetsFormValidation.fillName('ai_toolset_fv_url_test');
        await pm.aiToolsetsFormValidation.clickSave();

        await expect(pm.aiToolsetsFormValidation.getMcpUrlErrorLocator()).toBeVisible();
        await expect(pm.aiToolsetsFormValidation.getMcpUrlErrorLocator()).toContainText('Endpoint URL is required');

        testLogger.info('MCP URL required error correctly shown');
    });

    test('should show both name and MCP URL errors when submitted completely empty', {
        tag: ['@ai-toolsets-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing both name and URL required errors on completely empty submit');

        await pm.aiToolsetsFormValidation.clickSave();

        await expect(pm.aiToolsetsFormValidation.getNameErrorLocator()).toBeVisible();
        await expect(pm.aiToolsetsFormValidation.getNameErrorLocator()).toContainText('Name is required');
        await expect(pm.aiToolsetsFormValidation.getMcpUrlErrorLocator()).toBeVisible();
        await expect(pm.aiToolsetsFormValidation.getMcpUrlErrorLocator()).toContainText('Endpoint URL is required');

        testLogger.info('Both name and MCP URL required errors correctly shown');
    });

    test('should clear name error when name is filled after failed submit', {
        tag: ['@ai-toolsets-form-validation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing name error clears after correction');

        await pm.aiToolsetsFormValidation.clickSave();
        await expect(pm.aiToolsetsFormValidation.getNameErrorLocator()).toBeVisible();
        await expect(pm.aiToolsetsFormValidation.getNameErrorLocator()).toContainText('Name is required');

        await pm.aiToolsetsFormValidation.fillName('ai_toolset_fv_fix');
        await expect(pm.aiToolsetsFormValidation.getNameErrorLocator()).not.toBeVisible();

        testLogger.info('Name error correctly cleared after input');
    });

    test('should show CLI command error when kind is CLI and command is empty', {
        tag: ['@ai-toolsets-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing CLI command required validation');

        // Switch kind to CLI Tool
        await pm.aiToolsetsFormValidation.selectKind('CLI Tool');
        await pm.aiToolsetsFormValidation.fillName('ai_toolset_fv_cli_test');
        // Leave command empty and submit
        await pm.aiToolsetsFormValidation.clickSave();

        await expect(pm.aiToolsetsFormValidation.getCliCommandErrorLocator()).toBeVisible();
        await expect(pm.aiToolsetsFormValidation.getCliCommandErrorLocator()).toContainText('Command is required');

        testLogger.info('CLI command required error correctly shown');
    });

    test('should show both name and CLI command errors when CLI kind is selected and form is empty', {
        tag: ['@ai-toolsets-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing both name and CLI command errors on empty CLI form submit');

        await pm.aiToolsetsFormValidation.selectKind('CLI Tool');
        await pm.aiToolsetsFormValidation.clickSave();

        await expect(pm.aiToolsetsFormValidation.getNameErrorLocator()).toBeVisible();
        await expect(pm.aiToolsetsFormValidation.getNameErrorLocator()).toContainText('Name is required');
        await expect(pm.aiToolsetsFormValidation.getCliCommandErrorLocator()).toBeVisible();
        await expect(pm.aiToolsetsFormValidation.getCliCommandErrorLocator()).toContainText('Command is required');

        testLogger.info('Both name and CLI command required errors correctly shown');
    });

    test('should create AI Toolset successfully with valid name and MCP URL', {
        tag: ['@ai-toolsets-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing successful AI Toolset creation');

        // Unique name per run — the suite has no automated cleanup, so a fixed
        // name collides with a previously-created toolset and the save silently
        // fails (duplicate), leaving the form open.
        const toolsetName = `ai_toolset_fv_${Date.now()}`;
        await pm.aiToolsetsFormValidation.fillName(toolsetName);
        await pm.aiToolsetsFormValidation.fillMcpUrl('https://api.example.com/mcp/');
        await pm.aiToolsetsFormValidation.clickSave();

        // After successful save the form is dismissed and the list is shown
        await expect(pm.aiToolsetsFormValidation.getAddToolsetBtnLocator()).toBeVisible({ timeout: 15000 });

        testLogger.info('AI Toolset created successfully');
    });
});

// ── CrossLinkDialog form validation ──────────────────────────────────────────

test.describe('CrossLink dialog form validation', () => {
    test.describe.configure({ mode: 'serial' });
    let pm;
    // Name of a stream to use for the cross-link tests. Can be any existing
    // stream in the environment; falls back to 'default' if not set.
    const testStream = process.env['TEST_STREAM_NAME'] || 'default';

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        if (featureAvailable['ai-toolsets-crosslink'] === false) {
            test.skip(true, 'AI Toolsets is an enterprise-only feature — absent in the OSS build');
            return;
        }
        featureAvailable['ai-toolsets-crosslink'] = await pm.aiToolsetsFormValidation.navigateToAiToolsets();
        if (!featureAvailable['ai-toolsets-crosslink']) {
            test.skip(true, 'AI Toolsets is an enterprise-only feature — absent in the OSS build');
            return;
        }
        // Open the stream schema cross-linking tab so the dialog can be opened
        await pm.crossLinkPage.navigateToStreamCrossLinkTab(testStream);
        testLogger.info('Navigated to cross-link tab', { stream: testStream });
    });

    test('should show name and URL errors when dialog is submitted completely empty', {
        tag: ['@ai-toolsets-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing cross-link dialog empty submit errors');

        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.waitForDialog();

        // Primary button is disabled when name or url is empty
        // (primaryButtonDisabled="!form.name || !form.url")
        await expect(
            pm.crossLinkPage.getCrossLinkSaveBtnLocator()
        ).toBeDisabled();

        testLogger.info('Primary button correctly disabled when fields are empty');
    });

    test('should show URL error when only name is filled and dialog is submitted', {
        tag: ['@ai-toolsets-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing cross-link URL required error');

        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.waitForDialog();

        await pm.crossLinkPage.fillCrossLinkName('test_cross_link_fv');

        // Primary button remains disabled until URL is also filled
        await expect(
            pm.crossLinkPage.getCrossLinkSaveBtnLocator()
        ).toBeDisabled();

        testLogger.info('Primary button correctly disabled when URL is missing');
    });

    test('should show name error when only URL is filled and dialog is submitted', {
        tag: ['@ai-toolsets-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing cross-link name required error');

        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.waitForDialog();

        await pm.crossLinkPage.fillCrossLinkUrl('https://grafana.example.com/explore?query={{field_value}}');

        // Primary button remains disabled until name is also filled
        await expect(
            pm.crossLinkPage.getCrossLinkSaveBtnLocator()
        ).toBeDisabled();

        testLogger.info('Primary button correctly disabled when name is missing');
    });

    test('should enable save button when both name and URL are filled', {
        tag: ['@ai-toolsets-form-validation', '@P1', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing cross-link save button enabled when form is valid');

        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.waitForDialog();

        await pm.crossLinkPage.fillCrossLinkName('test_cross_link_fv_enabled');
        await pm.crossLinkPage.fillCrossLinkUrl('https://grafana.example.com/explore?query={{field_value}}');

        await expect(
            pm.crossLinkPage.getCrossLinkSaveBtnLocator()
        ).toBeEnabled();

        testLogger.info('Save button correctly enabled with valid name and URL');
    });

    test('should save cross-link successfully with valid name, URL, and field name', {
        tag: ['@ai-toolsets-form-validation', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing successful cross-link creation');

        const linkName = 'fv_cross_link_001';
        const linkUrl  = 'https://grafana.example.com/explore?query={{field_value}}';
        const field    = 'log_level';

        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.waitForDialog();

        await pm.crossLinkPage.fillCrossLinkName(linkName);
        await pm.crossLinkPage.fillCrossLinkUrl(linkUrl);
        await pm.crossLinkPage.addField(field);

        await expect(
            pm.crossLinkPage.getCrossLinkSaveBtnLocator()
        ).toBeEnabled();

        await pm.crossLinkPage.clickSave();

        // Dialog should close after saving
        await expect(
            pm.crossLinkPage.getCrossLinkDialogLocator()
        ).toBeHidden({ timeout: 10000 });

        // Cleanup — delete the created cross-link
        const idx = await pm.crossLinkPage.findCrossLinkItemIndexByName(linkName);
        if (idx >= 0) {
            await pm.crossLinkPage.clickDeleteCrossLink(idx);
        }

        testLogger.info('Cross-link saved and cleaned up successfully');
    });

    test('should close dialog without saving when cancel is clicked', {
        tag: ['@ai-toolsets-form-validation', '@P2', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Testing cross-link dialog cancel');

        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.waitForDialog();

        await pm.crossLinkPage.fillCrossLinkName('fv_cancel_test');
        await pm.crossLinkPage.clickCancel();

        await expect(
            pm.crossLinkPage.getCrossLinkDialogLocator()
        ).toBeHidden({ timeout: 5000 });

        testLogger.info('Cross-link dialog cancelled correctly');
    });
});
