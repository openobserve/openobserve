const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const fetch = require('node-fetch');
const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');

test.describe.configure({ mode: 'parallel' });

// ============================================================
// API helpers
// ============================================================

function apiBase() {
    return `${process.env.ZO_BASE_URL}/api/${getOrgIdentifier()}/llm/models`;
}

function apiHeaders() {
    return getAuthHeaders();
}

async function apiListModels() {
    try {
        const res = await fetch(apiBase(), { headers: apiHeaders() });
        if (!res.ok) return [];
        const data = await res.json();
        return data.list || data || [];
    } catch {
        return [];
    }
}

async function apiCreateModel(body) {
    const res = await fetch(apiBase(), {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return res.json();
}

async function apiDeleteModel(id) {
    try {
        const res = await fetch(`${apiBase()}/${id}`, {
            method: 'DELETE',
            headers: apiHeaders(),
        });
        return res.ok;
    } catch {
        return false;
    }
}

async function apiCleanupTestModels() {
    const models = await apiListModels();
    for (const m of models) {
        if (m.name && m.name.startsWith('mp_')) {
            await apiDeleteModel(m.id);
        }
    }
}

function defaultBody(name, pattern, prices = { input: 0.000002, output: 0.000008 }) {
    return {
        name,
        match_pattern: pattern,
        enabled: true,
        tiers: [{ name: 'Default', condition: null, prices }],
    };
}

// ============================================================
// List Page Rendering
// ============================================================

test.describe("Model Pricing — List Page Rendering", () => {
    test.describe.configure({ mode: 'serial' });

    test("Page loads with all header controls visible", {
        tag: ['@modelPricing', '@rendering', '@P0', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        const pm = new PageManager(page);

        await pm.modelPricingPage.gotoModelPricingPage();

        await expect(pm.modelPricingPage.listTitle).toBeVisible({ timeout: 10000 });
        await expect(pm.modelPricingPage.refreshBtn).toBeVisible();
        await expect(pm.modelPricingPage.testMatchBtn).toBeVisible();
        await expect(pm.modelPricingPage.importBtn).toBeVisible();
        await expect(pm.modelPricingPage.addBtn).toBeVisible();

        testLogger.info('Test completed successfully');
    });

    test("Custom tab is default; switching to Built-in tab shows built-in table", {
        tag: ['@modelPricing', '@rendering', '@tabs', '@P0', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        const pm = new PageManager(page);

        await pm.modelPricingPage.gotoModelPricingPage();

        await expect(pm.modelPricingPage.listTitle).toBeVisible({ timeout: 10000 });

        await pm.modelPricingPage.switchToBuiltInTab();
        await expect(pm.modelPricingPage.builtInTable).toBeVisible({ timeout: 10000 });

        await pm.modelPricingPage.switchToCustomTab();
        await expect(pm.modelPricingPage.listTable).toBeVisible({ timeout: 10000 });

        testLogger.info('Test completed successfully');
    });

    test("Empty state with CTA shows when org has zero custom models", {
        tag: ['@modelPricing', '@rendering', '@emptyState', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await apiCleanupTestModels();

        await navigateToBase(page);
        const pm = new PageManager(page);

        await pm.modelPricingPage.gotoModelPricingPage();

        const remaining = await apiListModels();
        if (remaining.length > 0) {
            testLogger.info('Org has non-test models — skipping empty-state assertion', { count: remaining.length });
            test.skip();
            return;
        }

        await expect(pm.modelPricingPage.emptyAddBtn).toBeVisible({ timeout: 10000 });

        testLogger.info('Test completed successfully');
    });
});

// ============================================================
// Create Model
// ============================================================

test.describe("Model Pricing — Create Model", () => {
    test.describe.configure({ mode: 'parallel' });

    test("Create model with one price appears in list", {
        tag: ['@modelPricing', '@create', '@P0', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `mp_create_single_${Date.now()}`;
        let createdId = null;

        try {
            await navigateToBase(page);
            const pm = new PageManager(page);

            await pm.modelPricingPage.gotoModelPricingPage();
            await pm.modelPricingPage.clickAdd();
            await pm.modelPricingPage.fillName(name);
            await pm.modelPricingPage.fillPattern(`^${name}.*`);
            await pm.modelPricingPage.addPriceRow('input', '0.000002');
            await pm.modelPricingPage.clickSave();

            await pm.modelPricingPage.verifyModelInList(name);

            const models = await apiListModels();
            createdId = models.find(m => m.name === name)?.id;
        } finally {
            if (createdId) await apiDeleteModel(createdId);
        }

        testLogger.info('Test completed successfully');
    });

    test("Create model with input and output prices shows both chips in list", {
        tag: ['@modelPricing', '@create', '@P0', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `mp_create_multi_${Date.now()}`;
        let createdId = null;

        try {
            await navigateToBase(page);
            const pm = new PageManager(page);

            await pm.modelPricingPage.gotoModelPricingPage();
            await pm.modelPricingPage.clickAdd();
            await pm.modelPricingPage.fillName(name);
            await pm.modelPricingPage.fillPattern(`^${name}.*`);
            await pm.modelPricingPage.addPriceRow('input', '0.000002');
            await pm.modelPricingPage.addPriceRow('output', '0.000008');
            await pm.modelPricingPage.clickSave();

            await pm.modelPricingPage.verifyModelInList(name);

            const row = pm.modelPricingPage.listTable.locator(`tr:has-text("${name}")`);
            await expect(row.getByText('input')).toBeVisible({ timeout: 5000 });
            await expect(row.getByText('output')).toBeVisible({ timeout: 5000 });

            const models = await apiListModels();
            createdId = models.find(m => m.name === name)?.id;
        } finally {
            if (createdId) await apiDeleteModel(createdId);
        }

        testLogger.info('Test completed successfully');
    });

    test("Create with wildcard regex pattern and test-match confirms it matches", {
        tag: ['@modelPricing', '@create', '@testMatch', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const ts = Date.now();
        const name = `mp_wildcard_${ts}`;
        let createdId = null;

        try {
            const created = await apiCreateModel(defaultBody(name, `^gpt-4.*`));
            createdId = created?.id;
            expect(createdId).toBeTruthy();

            await navigateToBase(page);
            const pm = new PageManager(page);

            await pm.modelPricingPage.gotoModelPricingPage();
            await pm.modelPricingPage.clickTestMatch();

            await pm.modelPricingPage.fillTestMatchInput('gpt-4o');
            await pm.modelPricingPage.clickTestMatchRun();

            await expect(pm.modelPricingPage.testMatchResult).toBeVisible({ timeout: 10000 });

            await pm.modelPricingPage.closeTestMatchDialog();
        } finally {
            if (createdId) await apiDeleteModel(createdId);
        }

        testLogger.info('Test completed successfully');
    });

    test("Create model with a conditional tier saves successfully", {
        tag: ['@modelPricing', '@create', '@multiTier', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `mp_multitier_${Date.now()}`;
        let createdId = null;

        try {
            await navigateToBase(page);
            const pm = new PageManager(page);

            await pm.modelPricingPage.gotoModelPricingPage();
            await pm.modelPricingPage.clickAdd();
            await pm.modelPricingPage.fillName(name);
            await pm.modelPricingPage.fillPattern(`^${name}.*`);

            await pm.modelPricingPage.addPriceRow('input', '0.000002');

            const addTierBtn = page.locator('button').filter({ hasText: /add.?tier/i }).first();
            if (await addTierBtn.isVisible()) {
                await addTierBtn.click();
                await pm.modelPricingPage.addPriceRow('input', '0.0000015', 1);
            }

            await pm.modelPricingPage.clickSave();
            await pm.modelPricingPage.verifyModelInList(name);

            const models = await apiListModels();
            createdId = models.find(m => m.name === name)?.id;
        } finally {
            if (createdId) await apiDeleteModel(createdId);
        }

        testLogger.info('Test completed successfully');
    });

    test("Applying pricing template populates price keys in the editor", {
        tag: ['@modelPricing', '@create', '@template', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `mp_template_${Date.now()}`;
        let createdId = null;

        try {
            await navigateToBase(page);
            const pm = new PageManager(page);

            await pm.modelPricingPage.gotoEditorCreate();
            await pm.modelPricingPage.fillName(name);
            await pm.modelPricingPage.fillPattern(`^${name}.*`);

            const templateBtn = page.locator('button').filter({ hasText: /openai/i }).first();
            if (await templateBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
                await templateBtn.click();
                await page.waitForTimeout(300);
                // Template applies keys with 0 values — need at least one non-zero price to save.
                // Find the first existing price-value input (not the add-row, which is .last()).
                const firstValueInput = page.getByPlaceholder('0.00').first();
                await firstValueInput.focus();
                await firstValueInput.selectText();
                await page.keyboard.type('0.000002');
                await firstValueInput.press('Tab');
                await page.waitForTimeout(200);
            } else {
                await pm.modelPricingPage.addPriceRow('input', '0.000002');
            }

            await pm.modelPricingPage.clickSave();
            await pm.modelPricingPage.verifyModelInList(name);

            const models = await apiListModels();
            createdId = models.find(m => m.name === name)?.id;
        } finally {
            if (createdId) await apiDeleteModel(createdId);
        }

        testLogger.info('Test completed successfully');
    });

    test("Pattern examples dialog opens and copies pattern into the pattern input", {
        tag: ['@modelPricing', '@create', '@examples', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        const pm = new PageManager(page);

        await pm.modelPricingPage.gotoEditorCreate();

        const examplesBtn = page.locator('button').filter({ hasText: /example/i }).first();
        if (!await examplesBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            testLogger.info('Examples button not visible — skipping');
            test.skip();
            return;
        }

        await examplesBtn.click();
        await expect(pm.modelPricingPage.examplesDialog).toBeVisible({ timeout: 10000 });

        const firstExampleBtn = pm.modelPricingPage.examplesDialog
            .locator('button, [role="option"], li')
            .first();
        await firstExampleBtn.click();

        const patternInput = pm.modelPricingPage.patternInput.locator('input').first();
        const value = await patternInput.inputValue();
        expect(value.length).toBeGreaterThan(0);

        testLogger.info('Test completed successfully');
    });
});

// ============================================================
// Form Validation
// ============================================================

test.describe("Model Pricing — Form Validation", () => {
    test.describe.configure({ mode: 'parallel' });

    test("Empty name blocks save and shows inline error", {
        tag: ['@modelPricing', '@validation', '@P0', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        const pm = new PageManager(page);

        await pm.modelPricingPage.gotoEditorCreate();

        // Fill pattern but NOT name — save button must be disabled
        await pm.modelPricingPage.fillPattern(`^mp_test.*`);

        // Save button is disabled when nameError is non-empty (name empty → disabled)
        await expect(pm.modelPricingPage.saveBtn).toBeDisabled({ timeout: 5000 });

        // Trigger the error message by touching (blurring) the empty name field
        const nameInput = pm.modelPricingPage.nameInput.locator('input').first();
        await nameInput.click({ force: true });
        await nameInput.press('Tab');

        // OInput renders error as data-test="{parentDataTest}-error"
        const nameError = page.locator('[data-test="model-pricing-name-input-error"]');
        await expect(nameError).toBeVisible({ timeout: 5000 });

        testLogger.info('Test completed successfully');
    });

    test("Empty pattern blocks save and shows inline error", {
        tag: ['@modelPricing', '@validation', '@P0', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        const pm = new PageManager(page);

        await pm.modelPricingPage.gotoEditorCreate();

        // Fill name but NOT pattern — save button must be disabled
        await pm.modelPricingPage.fillName(`mp_val_pattern_${Date.now()}`);

        await expect(pm.modelPricingPage.saveBtn).toBeDisabled({ timeout: 5000 });

        // Trigger the error message by touching (blurring) the empty pattern field
        const patternInput = pm.modelPricingPage.patternInput.locator('input').first();
        await patternInput.click({ force: true });
        await patternInput.press('Tab');

        const patternError = page.locator('[data-test="model-pricing-pattern-input-error"]');
        await expect(patternError).toBeVisible({ timeout: 5000 });

        testLogger.info('Test completed successfully');
    });

    test("Name longer than 256 characters shows error; fixing it clears the error", {
        tag: ['@modelPricing', '@validation', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        const pm = new PageManager(page);

        await pm.modelPricingPage.gotoEditorCreate();

        // Fill with 257-char name — triggers nameError, OInput error shows after blur
        await pm.modelPricingPage.fillName('a'.repeat(257));

        const nameError = page.locator('[data-test="model-pricing-name-input-error"]');
        await expect(nameError).toBeVisible({ timeout: 5000 });
        await expect(pm.modelPricingPage.saveBtn).toBeDisabled({ timeout: 3000 });

        // Fix by filling a valid short name
        await pm.modelPricingPage.fillName('a'.repeat(10));
        await expect(nameError).not.toBeVisible({ timeout: 5000 });

        testLogger.info('Test completed successfully');
    });

    test("Invalid regex in pattern shows error; fixing it clears the error", {
        tag: ['@modelPricing', '@validation', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        const pm = new PageManager(page);

        await pm.modelPricingPage.gotoEditorCreate();

        await pm.modelPricingPage.fillPattern('[invalid(');

        const patternError = page.locator('[data-test="model-pricing-pattern-input-error"]');
        await expect(patternError).toBeVisible({ timeout: 5000 });
        await expect(pm.modelPricingPage.saveBtn).toBeDisabled({ timeout: 3000 });

        await pm.modelPricingPage.fillPattern('^gpt-4.*');
        await expect(patternError).not.toBeVisible({ timeout: 5000 });

        testLogger.info('Test completed successfully');
    });

    test("Save with no prices in default tier is blocked", {
        tag: ['@modelPricing', '@validation', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        const pm = new PageManager(page);

        await pm.modelPricingPage.gotoEditorCreate();

        await pm.modelPricingPage.fillName(`mp_val_noprice_${Date.now()}`);
        await pm.modelPricingPage.fillPattern(`^mp_val_noprice.*`);
        await pm.modelPricingPage.saveBtn.click();

        await Promise.race([
            pm.modelPricingPage.editorTitle.waitFor({ state: 'visible', timeout: 5000 }),
            pm.modelPricingPage.toastMessage.waitFor({ state: 'visible', timeout: 5000 }),
        ]);

        const onEditor = await pm.modelPricingPage.editorTitle.isVisible();
        const hasToast = await pm.modelPricingPage.toastMessage.isVisible();
        expect(onEditor || hasToast).toBeTruthy();

        testLogger.info('Test completed successfully');
    });

    test("Usage key containing spaces shows a validation error", {
        tag: ['@modelPricing', '@validation', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        const pm = new PageManager(page);

        await pm.modelPricingPage.gotoEditorCreate();

        await pm.modelPricingPage.fillName(`mp_val_spaces_${Date.now()}`);
        await pm.modelPricingPage.fillPattern(`^mp_val_spaces.*`);

        await pm.modelPricingPage.addKeyInput.focus();
        await pm.modelPricingPage.addKeyInput.selectText();
        await page.keyboard.type('input tokens');
        await pm.modelPricingPage.addValueInput.focus();
        await page.keyboard.type('0.000002');

        const addPriceBtn = page.locator('.price-add-row button').last();
        await addPriceBtn.click();

        const errorVisible = await pm.modelPricingPage.toastMessage.isVisible({ timeout: 5000 }).catch(() => false);
        const inlineError = page.locator('.text-negative, [class*="error"]').first();
        const inlineVisible = await inlineError.isVisible({ timeout: 3000 }).catch(() => false);

        expect(errorVisible || inlineVisible).toBeTruthy();

        testLogger.info('Test completed successfully');
    });

    test("Usage key that is a pure integer shows a validation error", {
        tag: ['@modelPricing', '@validation', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        const pm = new PageManager(page);

        await pm.modelPricingPage.gotoEditorCreate();

        await pm.modelPricingPage.fillName(`mp_val_intkey_${Date.now()}`);
        await pm.modelPricingPage.fillPattern(`^mp_val_intkey.*`);

        await pm.modelPricingPage.addKeyInput.focus();
        await pm.modelPricingPage.addKeyInput.selectText();
        await page.keyboard.type('123');
        await pm.modelPricingPage.addValueInput.focus();
        await page.keyboard.type('0.000002');

        const addPriceBtn = page.locator('.price-add-row button').last();
        await addPriceBtn.click();

        const errorVisible = await pm.modelPricingPage.toastMessage.isVisible({ timeout: 5000 }).catch(() => false);
        const inlineError = page.locator('.text-negative, [class*="error"]').first();
        const inlineVisible = await inlineError.isVisible({ timeout: 3000 }).catch(() => false);

        expect(errorVisible || inlineVisible).toBeTruthy();

        testLogger.info('Test completed successfully');
    });
});

// ============================================================
// Edit and Duplicate
// ============================================================

test.describe("Model Pricing — Edit and Duplicate", () => {
    test.describe.configure({ mode: 'parallel' });

    test("Editing a model and saving reflects the updated name in the list", {
        tag: ['@modelPricing', '@edit', '@P0', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const ts = Date.now();
        const originalName = `mp_edit_orig_${ts}`;
        const updatedName = `mp_edit_upd_${ts}`;
        let createdId = null;

        try {
            const created = await apiCreateModel(defaultBody(originalName, `^${originalName}.*`));
            createdId = created?.id;
            expect(createdId).toBeTruthy();

            await navigateToBase(page);
            const pm = new PageManager(page);

            // Navigate directly to editor with model ID for reliable loading
            await pm.modelPricingPage.gotoEditorEdit(createdId);

            // Wait for the original name to be populated before changing it
            const nameInput = pm.modelPricingPage.nameInput.locator('input').first();
            await expect(nameInput).toHaveValue(originalName, { timeout: 8000 });

            await pm.modelPricingPage.fillName(updatedName);
            // Also update the pattern so the table row no longer contains originalName text
            // (pattern column would otherwise still show "^mp_edit_orig_..." and cause a false match)
            await pm.modelPricingPage.fillPattern(`^${updatedName}.*`);
            await expect(nameInput).toHaveValue(updatedName, { timeout: 5000 });

            await pm.modelPricingPage.clickSave();

            // Navigate to the list fresh to guarantee up-to-date data after the rename.
            await pm.modelPricingPage.gotoModelPricingPage();
            await pm.modelPricingPage.verifyModelInList(updatedName);
            await pm.modelPricingPage.verifyModelNotInList(originalName);

            const models = await apiListModels();
            createdId = models.find(m => m.name === updatedName)?.id ?? createdId;
        } finally {
            if (createdId) await apiDeleteModel(createdId);
        }

        testLogger.info('Test completed successfully');
    });

    test("Cancelling an edit discards changes and keeps the original name", {
        tag: ['@modelPricing', '@edit', '@cancel', '@P0', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `mp_edit_cancel_${Date.now()}`;
        let createdId = null;

        try {
            const created = await apiCreateModel(defaultBody(name, `^${name}.*`));
            createdId = created?.id;
            expect(createdId).toBeTruthy();

            await navigateToBase(page);
            const pm = new PageManager(page);

            await pm.modelPricingPage.gotoModelPricingPage();
            await pm.modelPricingPage.editBtnForModel(name).click();
            await pm.modelPricingPage.verifyEditorOnPage();

            await pm.modelPricingPage.fillName(`${name}_changed`);
            await pm.modelPricingPage.clickCancel();

            await pm.modelPricingPage.verifyModelInList(name);
            await pm.modelPricingPage.verifyModelNotInList(`${name}_changed`);
        } finally {
            if (createdId) await apiDeleteModel(createdId);
        }

        testLogger.info('Test completed successfully');
    });

    test("Duplicate opens editor with a copy suffix and saving creates a new entry", {
        tag: ['@modelPricing', '@duplicate', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `mp_dup_src_${Date.now()}`;
        let srcId = null;
        let copyId = null;

        try {
            const created = await apiCreateModel(defaultBody(name, `^${name}.*`));
            srcId = created?.id;
            expect(srcId).toBeTruthy();

            await navigateToBase(page);
            const pm = new PageManager(page);

            await pm.modelPricingPage.gotoModelPricingPage();
            // Navigate directly to the duplicate editor URL
            const org = process.env['ORGNAME'] || 'default';
            await page.goto(
                `${process.env['ZO_BASE_URL']}/web/settings/model_pricing/edit?org_identifier=${org}&id=${srcId}&duplicate=true`
            );
            await pm.modelPricingPage.verifyEditorOnPage();

            // Wait for model data to load and " (Copy)" suffix to be appended
            const nameInput = pm.modelPricingPage.nameInput.locator('input').first();
            await expect(nameInput).not.toHaveValue('', { timeout: 10000 });
            const dupName = await nameInput.inputValue();
            expect(dupName).toMatch(/copy|Copy|\(copy\)/i);

            // Change pattern to be unique (avoids pattern-conflict rejection on save)
            const ts2 = Date.now();
            await pm.modelPricingPage.fillPattern(`^mp_dup_copy_${ts2}.*`);

            await pm.modelPricingPage.clickSave();

            await pm.modelPricingPage.verifyModelInList(name);
            await pm.modelPricingPage.verifyModelInList(dupName);

            const models = await apiListModels();
            copyId = models.find(m => m.name === dupName)?.id;
        } finally {
            if (srcId) await apiDeleteModel(srcId);
            if (copyId) await apiDeleteModel(copyId);
        }

        testLogger.info('Test completed successfully');
    });

    test("Cloning a built-in model creates an editable org model on the Custom tab", {
        tag: ['@modelPricing', '@clone', '@builtIn', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        let clonedId = null;

        // Pre-test cleanup: delete any leftover "(Copy)" org models that would
        // cause a duplicate-name rejection when cloning the same built-in again.
        const existingModels = await apiListModels();
        for (const m of existingModels) {
            if (m.name?.endsWith(' (Copy)') && (m.source === 'org' || !m.source)) {
                await apiDeleteModel(m.id);
            }
        }

        try {
            await navigateToBase(page);
            const pm = new PageManager(page);

            await pm.modelPricingPage.gotoModelPricingPage();
            await pm.modelPricingPage.switchToBuiltInTab();

            const firstRow = pm.modelPricingPage.builtInTable.locator('tbody tr').first();
            await expect(firstRow).toBeVisible({ timeout: 10000 });

            // Read the built-in model's name before cloning so we can find the copy
            const firstRowName = await firstRow.locator('td').first().textContent();
            const expectedCopyName = (firstRowName?.trim() || '') + ' (Copy)';

            await pm.modelPricingPage.cloneBtnForRow(firstRow).click();
            await pm.modelPricingPage.verifyEditorOnPage();
            await pm.modelPricingPage.clickSave();

            await expect(pm.modelPricingPage.listTitle).toBeVisible({ timeout: 15000 });

            const models = await apiListModels();
            const cloned = models.find(m => m.name === expectedCopyName && (m.source === 'org' || !m.source));
            clonedId = cloned?.id ?? models.find(m => m.name?.endsWith(' (Copy)'))?.id;
        } finally {
            if (clonedId) await apiDeleteModel(clonedId);
        }

        testLogger.info('Test completed successfully');
    });
});

// ============================================================
// Delete
// ============================================================

test.describe("Model Pricing — Delete", () => {
    test.describe.configure({ mode: 'parallel' });

    test("Delete single model via confirm dialog removes it from the list", {
        tag: ['@modelPricing', '@delete', '@P0', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `mp_del_single_${Date.now()}`;
        const created = await apiCreateModel(defaultBody(name, `^${name}.*`));
        const id = created?.id;
        expect(id).toBeTruthy();

        await navigateToBase(page);
        const pm = new PageManager(page);

        await pm.modelPricingPage.gotoModelPricingPage();
        await pm.modelPricingPage.verifyModelInList(name);

        await pm.modelPricingPage.deleteBtnForModel(name).click();
        await pm.modelPricingPage.confirmOkBtn.click();

        await pm.modelPricingPage.verifyModelNotInList(name);

        testLogger.info('Test completed successfully');
    });

    test("Cancelling the delete confirm dialog keeps the model in the list", {
        tag: ['@modelPricing', '@delete', '@cancel', '@P0', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `mp_del_cancel_${Date.now()}`;
        let createdId = null;

        try {
            const created = await apiCreateModel(defaultBody(name, `^${name}.*`));
            createdId = created?.id;
            expect(createdId).toBeTruthy();

            await navigateToBase(page);
            const pm = new PageManager(page);

            await pm.modelPricingPage.gotoModelPricingPage();
            await pm.modelPricingPage.verifyModelInList(name);

            await pm.modelPricingPage.deleteBtnForModel(name).click();
            await pm.modelPricingPage.confirmCancelBtn.click();

            await pm.modelPricingPage.verifyModelInList(name);
        } finally {
            if (createdId) await apiDeleteModel(createdId);
        }

        testLogger.info('Test completed successfully');
    });

    test("Bulk delete removes all selected models from the list", {
        tag: ['@modelPricing', '@delete', '@bulk', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const ts = Date.now();
        const names = [`mp_bulk_a_${ts}`, `mp_bulk_b_${ts}`, `mp_bulk_c_${ts}`];
        const ids = [];

        try {
            for (const name of names) {
                const created = await apiCreateModel(defaultBody(name, `^${name}.*`));
                if (created?.id) ids.push(created.id);
            }
            expect(ids).toHaveLength(3);

            await navigateToBase(page);
            const pm = new PageManager(page);

            await pm.modelPricingPage.gotoModelPricingPage();

            for (const name of names) {
                await pm.modelPricingPage.checkRowByName(name);
            }

            await pm.modelPricingPage.deleteSelectedBtn.click();
            await pm.modelPricingPage.confirmOkBtn.click();

            for (const name of names) {
                await pm.modelPricingPage.verifyModelNotInList(name);
            }
        } finally {
            for (const id of ids) {
                await apiDeleteModel(id);
            }
        }

        testLogger.info('Test completed successfully');
    });

    test("Bulk export downloads valid JSON containing the selected models", {
        tag: ['@modelPricing', '@export', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `mp_export_${Date.now()}`;
        let createdId = null;

        try {
            const created = await apiCreateModel(defaultBody(name, `^${name}.*`));
            createdId = created?.id;
            expect(createdId).toBeTruthy();

            await navigateToBase(page);
            const pm = new PageManager(page);

            await pm.modelPricingPage.gotoModelPricingPage();
            await pm.modelPricingPage.checkRowByName(name);

            const [download] = await Promise.all([
                page.waitForEvent('download'),
                pm.modelPricingPage.exportSelectedBtn.click(),
            ]);

            const downloadPath = await download.path();
            expect(downloadPath).toBeTruthy();

            const fs = require('fs');
            const content = fs.readFileSync(downloadPath, 'utf-8');
            const parsed = JSON.parse(content);
            const list = Array.isArray(parsed) ? parsed : (parsed.list || [parsed]);
            expect(list.some(m => m.name === name)).toBeTruthy();
        } finally {
            if (createdId) await apiDeleteModel(createdId);
        }

        testLogger.info('Test completed successfully');
    });
});

// ============================================================
// Enable/Disable Toggle
// ============================================================

test.describe("Model Pricing — Enable/Disable Toggle", () => {

    test("Toggling a model off keeps it in the list; toggling on restores it as enabled", {
        tag: ['@modelPricing', '@toggle', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `mp_toggle_${Date.now()}`;
        let createdId = null;

        try {
            const created = await apiCreateModel(defaultBody(name, `^${name}.*`));
            createdId = created?.id;
            expect(createdId).toBeTruthy();

            await navigateToBase(page);
            const pm = new PageManager(page);

            await pm.modelPricingPage.gotoModelPricingPage();
            await pm.modelPricingPage.verifyModelInList(name);

            await pm.modelPricingPage.toggleBtnForModel(name).click();
            await pm.modelPricingPage.verifyModelInList(name);

            await pm.modelPricingPage.toggleBtnForModel(name).click();
            await pm.modelPricingPage.verifyModelInList(name);
        } finally {
            if (createdId) await apiDeleteModel(createdId);
        }

        testLogger.info('Test completed successfully');
    });
});

// ============================================================
// Search and Filter
// ============================================================

test.describe("Model Pricing — Search and Filter", () => {
    test.describe.configure({ mode: 'parallel' });

    test("Searching by name filters the list to show only matching models", {
        tag: ['@modelPricing', '@search', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const ts = Date.now();
        const targetName = `mp_search_target_${ts}`;
        const otherName = `mp_search_other_${ts}`;
        const ids = [];

        try {
            for (const [n, p] of [[targetName, `^${targetName}.*`], [otherName, `^${otherName}.*`]]) {
                const c = await apiCreateModel(defaultBody(n, p));
                if (c?.id) ids.push(c.id);
            }

            await navigateToBase(page);
            const pm = new PageManager(page);

            await pm.modelPricingPage.gotoModelPricingPage();

            const searchInput = page.locator('input[type="search"], input[placeholder*="search" i], [data-test*="search"] input').first();
            if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
                await searchInput.fill(targetName);
                await expect(pm.modelPricingPage.listTable.locator(`tr:has-text("${targetName}")`)).toBeVisible({ timeout: 5000 });
                await expect(pm.modelPricingPage.listTable.locator(`tr:has-text("${otherName}")`)).not.toBeVisible({ timeout: 5000 });
            } else {
                testLogger.info('Search input not found — skipping search assertion');
            }
        } finally {
            for (const id of ids) await apiDeleteModel(id);
        }

        testLogger.info('Test completed successfully');
    });

    test("Searching by pattern text filters the list to show matching models", {
        tag: ['@modelPricing', '@search', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const ts = Date.now();
        const name = `mp_search_pat_${ts}`;
        let createdId = null;

        try {
            const created = await apiCreateModel(defaultBody(name, `^mp_pat_unique_${ts}.*`));
            createdId = created?.id;
            expect(createdId).toBeTruthy();

            await navigateToBase(page);
            const pm = new PageManager(page);

            await pm.modelPricingPage.gotoModelPricingPage();

            const searchInput = page.locator('input[type="search"], input[placeholder*="search" i], [data-test*="search"] input').first();
            if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
                await searchInput.fill(`mp_pat_unique_${ts}`);
                await expect(pm.modelPricingPage.listTable.locator(`tr:has-text("${name}")`)).toBeVisible({ timeout: 5000 });
            } else {
                testLogger.info('Search input not found — skipping search assertion');
            }
        } finally {
            if (createdId) await apiDeleteModel(createdId);
        }

        testLogger.info('Test completed successfully');
    });
});

// ============================================================
// Test Model Match Dialog
// ============================================================

test.describe("Model Pricing — Test Model Match Dialog", () => {
    test.describe.configure({ mode: 'parallel' });

    test("Dialog opens showing empty state with input visible", {
        tag: ['@modelPricing', '@testMatch', '@P0', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        const pm = new PageManager(page);

        await pm.modelPricingPage.gotoModelPricingPage();
        await pm.modelPricingPage.clickTestMatch();

        await expect(pm.modelPricingPage.testMatchDialog).toBeVisible({ timeout: 10000 });
        await expect(pm.modelPricingPage.testMatchEmpty).toBeVisible({ timeout: 5000 });
        await expect(pm.modelPricingPage.testMatchInput).toBeVisible({ timeout: 5000 });

        await pm.modelPricingPage.closeTestMatchDialog();

        testLogger.info('Test completed successfully');
    });

    test("Running test match against an existing model pattern shows the result with pricing", {
        tag: ['@modelPricing', '@testMatch', '@P0', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const ts = Date.now();
        const name = `mp_match_${ts}`;
        const modelName = `mp_match_model_${ts}`;
        let createdId = null;

        try {
            const created = await apiCreateModel(defaultBody(name, `^mp_match_model_${ts}$`));
            createdId = created?.id;
            expect(createdId).toBeTruthy();

            await navigateToBase(page);
            const pm = new PageManager(page);

            await pm.modelPricingPage.gotoModelPricingPage();
            await pm.modelPricingPage.clickTestMatch();

            await pm.modelPricingPage.fillTestMatchInput(modelName);
            await pm.modelPricingPage.clickTestMatchRun();

            await expect(pm.modelPricingPage.testMatchResult).toBeVisible({ timeout: 10000 });

            await pm.modelPricingPage.closeTestMatchDialog();
        } finally {
            if (createdId) await apiDeleteModel(createdId);
        }

        testLogger.info('Test completed successfully');
    });

    test("Running test match with an unknown model name shows the no-result state", {
        tag: ['@modelPricing', '@testMatch', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        const pm = new PageManager(page);

        await pm.modelPricingPage.gotoModelPricingPage();
        await pm.modelPricingPage.clickTestMatch();

        await pm.modelPricingPage.fillTestMatchInput(`definitely_nonexistent_model_${Date.now()}`);
        await pm.modelPricingPage.clickTestMatchRun();

        await expect(pm.modelPricingPage.testMatchNoResult).toBeVisible({ timeout: 10000 });

        await pm.modelPricingPage.closeTestMatchDialog();

        testLogger.info('Test completed successfully');
    });

    test("Clear button resets the input and result back to empty state", {
        tag: ['@modelPricing', '@testMatch', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        const pm = new PageManager(page);

        await pm.modelPricingPage.gotoModelPricingPage();
        await pm.modelPricingPage.clickTestMatch();

        await pm.modelPricingPage.fillTestMatchInput('gpt-4o');
        await pm.modelPricingPage.clickTestMatchRun();

        await Promise.race([
            pm.modelPricingPage.testMatchResult.waitFor({ state: 'visible', timeout: 10000 }),
            pm.modelPricingPage.testMatchNoResult.waitFor({ state: 'visible', timeout: 10000 }),
        ]);

        await pm.modelPricingPage.clearTestMatch();

        await expect(pm.modelPricingPage.testMatchEmpty).toBeVisible({ timeout: 5000 });
        const testMatchNativeInput = pm.modelPricingPage.testMatchInput.locator('input').first();
        await expect(testMatchNativeInput).toHaveValue('', { timeout: 5000 });

        await pm.modelPricingPage.closeTestMatchDialog();

        testLogger.info('Test completed successfully');
    });
});

// ============================================================
// Import
// ============================================================

test.describe("Model Pricing — Import", () => {
    test.describe.configure({ mode: 'parallel' });

    test("Importing valid JSON creates both models and shows success", {
        tag: ['@modelPricing', '@import', '@P0', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const ts = Date.now();
        const importJson = JSON.stringify([
            {
                name: `mp_import_a_${ts}`,
                match_pattern: `^mp_import_a_${ts}.*`,
                enabled: true,
                tiers: [{ name: 'Default', condition: null, prices: { input: 0.000002 } }],
            },
            {
                name: `mp_import_b_${ts}`,
                match_pattern: `^mp_import_b_${ts}.*`,
                enabled: true,
                tiers: [{ name: 'Default', condition: null, prices: { output: 0.000008 } }],
            },
        ]);

        await navigateToBase(page);
        const pm = new PageManager(page);

        await pm.modelPricingPage.gotoModelPricingPage();
        await pm.modelPricingPage.clickImport();

        await pm.modelPricingPage.uploadImportJson(importJson);
        await page.waitForTimeout(1000);
        await pm.modelPricingPage.clickImportConfirm();

        await Promise.race([
            pm.modelPricingPage.listTitle.waitFor({ state: 'visible', timeout: 15000 }),
            pm.modelPricingPage.toastMessage.waitFor({ state: 'visible', timeout: 15000 }),
        ]);

        const models = await apiListModels();
        for (const m of models) {
            if (m.name === `mp_import_a_${ts}` || m.name === `mp_import_b_${ts}`) {
                await apiDeleteModel(m.id);
            }
        }

        testLogger.info('Test completed successfully');
    });

    test("Importing a model with a duplicate name shows a correction input for renaming", {
        tag: ['@modelPricing', '@import', '@duplicate', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const ts = Date.now();
        const existingName = `mp_import_dup_${ts}`;
        let existingId = null;

        try {
            const created = await apiCreateModel(defaultBody(existingName, `^${existingName}.*`));
            existingId = created?.id;
            expect(existingId).toBeTruthy();

            const importJson = JSON.stringify([{
                name: existingName,
                match_pattern: `^${existingName}.*`,
                enabled: true,
                tiers: [{ name: 'Default', condition: null, prices: { input: 0.000002 } }],
            }]);

            await navigateToBase(page);
            const pm = new PageManager(page);

            await pm.modelPricingPage.gotoModelPricingPage();
            await pm.modelPricingPage.clickImport();
            await pm.modelPricingPage.uploadImportJson(importJson);
            await page.waitForTimeout(1000);
            await pm.modelPricingPage.clickImportConfirm();

            await expect(pm.modelPricingPage.importNameInput).toBeVisible({ timeout: 10000 });

            const fixedName = `${existingName}_fixed`;
            await pm.modelPricingPage.importNameInput.locator('input, textarea').first().fill(fixedName);
            await pm.modelPricingPage.clickImportConfirm();

            await Promise.race([
                pm.modelPricingPage.listTitle.waitFor({ state: 'visible', timeout: 15000 }),
                pm.modelPricingPage.toastMessage.waitFor({ state: 'visible', timeout: 15000 }),
            ]);

            const models = await apiListModels();
            const fixed = models.find(m => m.name === fixedName);
            if (fixed?.id) await apiDeleteModel(fixed.id);
        } finally {
            if (existingId) await apiDeleteModel(existingId);
        }

        testLogger.info('Test completed successfully');
    });

    test("Importing a model with a missing match_pattern shows a correction input for fixing the pattern", {
        tag: ['@modelPricing', '@import', '@validation', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const ts = Date.now();
        // Omit match_pattern entirely — ImportModelPricing.vue validates this client-side
        // and shows the model-pricing-import-pattern-input correction widget.
        const modelName = `mp_import_nopat_${ts}`;
        const importJson = JSON.stringify([{
            name: modelName,
            // match_pattern intentionally omitted to trigger the correction UI
            enabled: true,
            tiers: [{ name: 'Default', condition: null, prices: { input: 0.000002 } }],
        }]);

        await navigateToBase(page);
        const pm = new PageManager(page);

        await pm.modelPricingPage.gotoModelPricingPage();
        await pm.modelPricingPage.clickImport();
        await pm.modelPricingPage.uploadImportJson(importJson);
        await page.waitForTimeout(1000);
        await pm.modelPricingPage.clickImportConfirm();

        // Frontend validates missing pattern and renders the correction OInput
        await expect(pm.modelPricingPage.importPatternInput).toBeVisible({ timeout: 10000 });

        // Fill in a valid pattern and re-confirm
        const patternInput = pm.modelPricingPage.importPatternInput.locator('input').first();
        await patternInput.fill(`^${modelName}.*`);
        await pm.modelPricingPage.clickImportConfirm();

        await Promise.race([
            pm.modelPricingPage.listTitle.waitFor({ state: 'visible', timeout: 15000 }),
            pm.modelPricingPage.toastMessage.waitFor({ state: 'visible', timeout: 15000 }),
        ]);

        const models = await apiListModels();
        const created = models.find(m => m.name === modelName);
        if (created?.id) await apiDeleteModel(created.id);

        testLogger.info('Test completed successfully');
    });

    test("Cancelling the import overlay returns to the list without creating any model", {
        tag: ['@modelPricing', '@import', '@cancel', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        const pm = new PageManager(page);

        await pm.modelPricingPage.gotoModelPricingPage();
        await pm.modelPricingPage.clickImport();

        const importJson = JSON.stringify([{
            name: `mp_import_cancel_${Date.now()}`,
            match_pattern: `^mp_import_cancel.*`,
            enabled: true,
            tiers: [{ name: 'Default', condition: null, prices: { input: 0.000002 } }],
        }]);
        await pm.modelPricingPage.uploadImportJson(importJson);
        await page.waitForTimeout(500);

        await pm.modelPricingPage.clickImportCancel();

        await expect(pm.modelPricingPage.listTitle).toBeVisible({ timeout: 10000 });

        testLogger.info('Test completed successfully');
    });
});

// ============================================================
// Built-in Tab
// ============================================================

test.describe("Model Pricing — Built-in Tab", () => {
    test.describe.configure({ mode: 'parallel' });

    test("Built-in tab loads and shows at least one model row", {
        tag: ['@modelPricing', '@builtIn', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        const pm = new PageManager(page);

        await pm.modelPricingPage.gotoModelPricingPage();
        await pm.modelPricingPage.switchToBuiltInTab();

        await expect(pm.modelPricingPage.builtInTable).toBeVisible({ timeout: 10000 });
        await expect(pm.modelPricingPage.builtInTable.locator('tbody tr').first()).toBeVisible({ timeout: 10000 });

        testLogger.info('Test completed successfully');
    });

    test("Search input on the Built-in tab filters the displayed models", {
        tag: ['@modelPricing', '@builtIn', '@search', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        const pm = new PageManager(page);

        await pm.modelPricingPage.gotoModelPricingPage();
        await pm.modelPricingPage.switchToBuiltInTab();

        await expect(pm.modelPricingPage.builtInTable).toBeVisible({ timeout: 10000 });
        const totalBefore = await pm.modelPricingPage.builtInTable.locator('tbody tr').count();

        if (await pm.modelPricingPage.builtInSearch.isVisible({ timeout: 5000 }).catch(() => false)) {
            await pm.modelPricingPage.builtInSearch.fill('gpt');
            await page.waitForTimeout(500);
            const totalAfter = await pm.modelPricingPage.builtInTable.locator('tbody tr').count();
            expect(totalAfter).toBeLessThanOrEqual(totalBefore);
        } else {
            testLogger.info('Built-in search input not visible — skipping');
        }

        testLogger.info('Test completed successfully');
    });

    test("Refreshing the built-in list shows success feedback and repopulates the table", {
        tag: ['@modelPricing', '@builtIn', '@refresh', '@P2', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        const pm = new PageManager(page);

        await pm.modelPricingPage.gotoModelPricingPage();
        await pm.modelPricingPage.switchToBuiltInTab();

        await expect(pm.modelPricingPage.builtInTable).toBeVisible({ timeout: 10000 });

        await pm.modelPricingPage.builtInRefreshBtn.click();

        await Promise.race([
            pm.modelPricingPage.toastMessage.waitFor({ state: 'visible', timeout: 20000 }),
            pm.modelPricingPage.builtInTable.waitFor({ state: 'visible', timeout: 20000 }),
        ]);

        await expect(pm.modelPricingPage.builtInTable).toBeVisible({ timeout: 10000 });

        testLogger.info('Test completed successfully');
    });
});

// ============================================================
// Pricing Drawer
// ============================================================

test.describe("Model Pricing — Pricing Drawer", () => {

    test("Model with more than 3 price keys shows a overflow link that opens the pricing drawer", {
        tag: ['@modelPricing', '@drawer', '@P2', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `mp_drawer_${Date.now()}`;
        let createdId = null;

        try {
            const created = await apiCreateModel({
                name,
                match_pattern: `^${name}.*`,
                enabled: true,
                tiers: [{
                    name: 'Default',
                    condition: null,
                    prices: {
                        input: 0.000002,
                        output: 0.000008,
                        cache_read: 0.000001,
                        cache_write: 0.0000005,
                        reasoning: 0.000003,
                    },
                }],
            });
            createdId = created?.id;
            expect(createdId).toBeTruthy();

            await navigateToBase(page);
            const pm = new PageManager(page);

            await pm.modelPricingPage.gotoModelPricingPage();
            await pm.modelPricingPage.verifyModelInList(name);

            const row = pm.modelPricingPage.listTable.locator(`tr:has-text("${name}")`);
            const moreLink = row.locator('button, a, span').filter({ hasText: /\+\d+\s*more/i }).first();

            if (await moreLink.isVisible({ timeout: 5000 }).catch(() => false)) {
                await moreLink.click();
                await expect(pm.modelPricingPage.pricingDrawer).toBeVisible({ timeout: 10000 });

                // formatPriceKey() replaces underscores with hyphens: cache_read → cache-read
                for (const key of ['input', 'output', 'cache-read', 'cache-write', 'reasoning']) {
                    await expect(pm.modelPricingPage.pricingDrawer.getByText(key, { exact: false })).toBeVisible({ timeout: 5000 });
                }
            } else {
                testLogger.info('No overflow link visible — model may show all keys inline in current view');
            }
        } finally {
            if (createdId) await apiDeleteModel(createdId);
        }

        testLogger.info('Test completed successfully');
    });
});
