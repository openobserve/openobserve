// Copyright 2026 OpenObserve Inc.
//
// Online Evals — LLM Provider Types & API Key Handling (enterprise/cloud-only)
// Covers:
//   - New provider types (vLLM, OpenAI-compatible) selectable in the create form
//   - API-key "required" marker toggles with the provider type (create mode only)
//   - Create a keyless vLLM provider (default endpoint, no API key)
//   - Create an OpenAI-compatible provider with a custom endpoint + key
//   - OpenAI-compatible without an endpoint → "endpoint is required" error
//   - Editing a provider with a blank key preserves the stored key
//   - No API-key "required" marker in edit mode
//   - Cancel returns to the provider list without persisting
//
// Enterprise gating: the `llm_providers` route only exists on enterprise/cloud
// builds (useManagementRoutes.ts pushes it when isEnterprise || isCloud). Each test
// probes navigateToLlmProviders() and skips cleanly on the OSS binary.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

// Per-test unique provider names (tests run --workers in parallel; a fixed name
// would collide across runs). Timestamp + short random suffix is collision-safe.
function uniqueName(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

test.describe("Online Evals LLM Provider Types & API Key Handling", () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        pm.createdProviderNames = [];
        // Enterprise/cloud-only surface — probe positively and skip on OSS.
        const available = await pm.llmProvidersPage.navigateToLlmProviders();
        if (!available) {
            test.skip(true, 'LLM Providers is an enterprise/cloud-only feature — absent in the OSS build');
            return;
        }
        testLogger.info('Navigated to Settings > LLM Providers');
    });

    test.afterEach(async () => {
        // Best-effort cleanup of providers created by this test. Not an assertion —
        // a failed delete is logged, never thrown.
        if (!pm || !pm.createdProviderNames || pm.createdProviderNames.length === 0) return;
        for (const name of pm.createdProviderNames) {
            try {
                await pm.llmProvidersPage.deleteProvider(name);
            } catch (e) {
                testLogger.warn(`Cleanup failed for provider ${name}: ${e.message}`);
            }
        }
    });

    test("should expose vLLM and OpenAI-compatible in the provider type dropdown", {
        tag: ['@llm-provider-types', '@all', '@P0']
    }, async () => {
        testLogger.info('Verifying the new provider types are present in the type dropdown');

        await pm.llmProvidersPage.clickAddProvider();
        await pm.llmProvidersPage.openProviderTypeSelect();

        await expect(pm.llmProvidersPage.getProviderTypeOptionLocator('vllm')).toBeVisible();
        await expect(pm.llmProvidersPage.getProviderTypeOptionLocator('openai_compatible')).toBeVisible();

        testLogger.info('vLLM and OpenAI-compatible options are present');
    });

    test("should toggle the API key required marker with the provider type", {
        tag: ['@llm-provider-types', '@all', '@P0']
    }, async () => {
        testLogger.info('Verifying the API-key required marker tracks the provider type');

        await pm.llmProvidersPage.clickAddProvider();

        // Default type is openai → the "*" marker is visible.
        await expect(pm.llmProvidersPage.getApiKeyRequiredMarkerLocator()).toBeVisible();

        // Self-hosted / keyless types hide the marker.
        await pm.llmProvidersPage.selectProviderType('vllm');
        await expect(pm.llmProvidersPage.getProviderTypeTriggerLocator())
            .toHaveAttribute('data-test-selected-value', 'vllm');
        await expect(pm.llmProvidersPage.getApiKeyRequiredMarkerLocator()).not.toBeVisible();

        await pm.llmProvidersPage.selectProviderType('openai_compatible');
        await expect(pm.llmProvidersPage.getProviderTypeTriggerLocator())
            .toHaveAttribute('data-test-selected-value', 'openai_compatible');
        await expect(pm.llmProvidersPage.getApiKeyRequiredMarkerLocator()).not.toBeVisible();

        // A cloud provider that requires a key shows the marker again.
        await pm.llmProvidersPage.selectProviderType('deepseek');
        await expect(pm.llmProvidersPage.getProviderTypeTriggerLocator())
            .toHaveAttribute('data-test-selected-value', 'deepseek');
        await expect(pm.llmProvidersPage.getApiKeyRequiredMarkerLocator()).toBeVisible();

        testLogger.info('API-key required marker toggles correctly per provider type');
    });

    test("should create a keyless vLLM provider", {
        tag: ['@llm-provider-types', '@all', '@P0']
    }, async () => {
        testLogger.info('Creating a vLLM provider with no API key');
        const name = uniqueName('e2e-vllm');
        pm.createdProviderNames.push(name);

        await pm.llmProvidersPage.clickAddProvider();
        await pm.llmProvidersPage.fillName(name);
        await pm.llmProvidersPage.selectProviderType('vllm');
        await expect(pm.llmProvidersPage.getProviderTypeTriggerLocator())
            .toHaveAttribute('data-test-selected-value', 'vllm');
        await pm.llmProvidersPage.fillDefaultModel('llama3.2');
        // Endpoint and API key intentionally left blank (vLLM supplies the default
        // endpoint and runs keyless).
        await pm.llmProvidersPage.clickSave();

        await expect(pm.llmProvidersPage.getToastSuccessLocator().first()).toBeVisible({ timeout: 10000 });
        await expect(pm.llmProvidersPage.getToastErrorLocator()).toHaveCount(0);
        await expect(pm.llmProvidersPage.getProviderRowNameLocator(name)).toBeVisible();

        testLogger.info('Keyless vLLM provider created successfully');
    });

    test("should create an OpenAI-compatible provider with a custom endpoint and API key", {
        tag: ['@llm-provider-types', '@all', '@P1']
    }, async () => {
        testLogger.info('Creating an OpenAI-compatible provider with endpoint and key');
        const name = uniqueName('e2e-oai');
        pm.createdProviderNames.push(name);

        await pm.llmProvidersPage.clickAddProvider();
        await pm.llmProvidersPage.fillName(name);
        await pm.llmProvidersPage.selectProviderType('openai_compatible');
        await expect(pm.llmProvidersPage.getProviderTypeTriggerLocator())
            .toHaveAttribute('data-test-selected-value', 'openai_compatible');
        await pm.llmProvidersPage.fillEndpoint('https://api.minimax.io/v1/chat/completions');
        await pm.llmProvidersPage.fillDefaultModel('MiniMax-M3');
        await pm.llmProvidersPage.fillApiKey('sk-test');
        await pm.llmProvidersPage.clickSave();

        await expect(pm.llmProvidersPage.getToastSuccessLocator().first()).toBeVisible({ timeout: 10000 });
        await expect(pm.llmProvidersPage.getToastErrorLocator()).toHaveCount(0);
        await expect(pm.llmProvidersPage.getProviderRowNameLocator(name)).toBeVisible();

        testLogger.info('OpenAI-compatible provider created successfully');
    });

    test("should show an endpoint required error for OpenAI-compatible without an endpoint", {
        tag: ['@llm-provider-types', '@all', '@P1']
    }, async () => {
        testLogger.info('Verifying endpoint-required error for openai_compatible');
        const name = uniqueName('e2e-oai-noep');
        // No provider is created (save fails) — no cleanup name to track.

        await pm.llmProvidersPage.clickAddProvider();
        await pm.llmProvidersPage.fillName(name);
        await pm.llmProvidersPage.selectProviderType('openai_compatible');
        await expect(pm.llmProvidersPage.getProviderTypeTriggerLocator())
            .toHaveAttribute('data-test-selected-value', 'openai_compatible');
        await pm.llmProvidersPage.fillDefaultModel('MiniMax-M3');
        await pm.llmProvidersPage.fillApiKey('sk-test');
        // Endpoint intentionally left blank — openai_compatible has no default endpoint.
        await pm.llmProvidersPage.clickSave();

        await expect(pm.llmProvidersPage.getToastErrorLocator().first())
            .toContainText('endpoint is required', { timeout: 10000 });
        await expect(pm.llmProvidersPage.getToastSuccessLocator()).toHaveCount(0);
        // The form stays open on validation failure.
        await expect(pm.llmProvidersPage.getFormTitleLocator()).toBeVisible();

        testLogger.info('Endpoint-required error shown correctly');
    });

    test("should preserve the stored API key when editing with a blank key", {
        tag: ['@llm-provider-types', '@all', '@P1']
    }, async () => {
        testLogger.info('Verifying blank-key edit preserves the stored key');
        const name = uniqueName('e2e-openai');
        pm.createdProviderNames.push(name);

        // Create an OpenAI provider (openai requires an API key).
        await pm.llmProvidersPage.clickAddProvider();
        await pm.llmProvidersPage.fillName(name);
        await pm.llmProvidersPage.fillDefaultModel('gpt-4o');
        await pm.llmProvidersPage.fillApiKey('sk-test');
        await pm.llmProvidersPage.clickSave();
        await expect(pm.llmProvidersPage.getToastSuccessLocator().first()).toBeVisible({ timeout: 10000 });

        // Edit it: the write-only key seeds blank; leave it blank and change the model.
        await pm.llmProvidersPage.clickEditProvider(name);
        await expect(pm.llmProvidersPage.getApiKeyFieldLocator()).toHaveValue('');
        await pm.llmProvidersPage.fillDefaultModel('gpt-4o-mini');
        await pm.llmProvidersPage.clickSave();

        // Observable proxy: save succeeds with no "No API key" / "Failed to save" error.
        await expect(pm.llmProvidersPage.getToastSuccessLocator().first()).toBeVisible({ timeout: 10000 });
        await expect(pm.llmProvidersPage.getToastErrorLocator()).toHaveCount(0);

        testLogger.info('Blank-key edit preserved the stored API key');
    });

    test("should not show the API key required marker in edit mode", {
        tag: ['@llm-provider-types', '@all', '@P2']
    }, async () => {
        testLogger.info('Verifying the required marker is hidden in edit mode');
        const name = uniqueName('e2e-openai-edit');
        pm.createdProviderNames.push(name);

        await pm.llmProvidersPage.clickAddProvider();
        await pm.llmProvidersPage.fillName(name);
        await pm.llmProvidersPage.fillDefaultModel('gpt-4o');
        await pm.llmProvidersPage.fillApiKey('sk-test');
        await pm.llmProvidersPage.clickSave();
        await expect(pm.llmProvidersPage.getToastSuccessLocator().first()).toBeVisible({ timeout: 10000 });

        await pm.llmProvidersPage.clickEditProvider(name);
        // In edit mode the marker is hidden even for openai (the authEditNote callout
        // explains leave-blank-to-keep instead).
        await expect(pm.llmProvidersPage.getApiKeyRequiredMarkerLocator()).not.toBeVisible();

        testLogger.info('API-key required marker correctly hidden in edit mode');
    });

    test("should close the form without persisting when cancel is clicked", {
        tag: ['@llm-provider-types', '@all', '@P2']
    }, async () => {
        testLogger.info('Verifying cancel returns to the provider list');

        await pm.llmProvidersPage.clickAddProvider();
        await expect(pm.llmProvidersPage.getFormTitleLocator()).toBeVisible();

        await pm.llmProvidersPage.clickCancel();

        await expect(pm.llmProvidersPage.getFormTitleLocator()).not.toBeVisible();
        await expect(pm.llmProvidersPage.getAddProviderBtnLocator()).toBeVisible();
        await expect(pm.llmProvidersPage.getToastErrorLocator()).toHaveCount(0);

        testLogger.info('Cancel returned to the provider list without persisting');
    });
});
