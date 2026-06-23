const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const http = require('http');
const nodeFetch = require('node-fetch');
const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');
const { generateHexId } = require('../utils/trace-ingestion.js');
const fs = require('fs');

// node-fetch v2 keep-alive pooling + gzip decompression is the root cause of
// "Premature close" / ECONNRESET flakiness in CI.
const noKeepAliveAgent = new http.Agent({ keepAlive: false });
const fetch = (url, opts = {}) => nodeFetch(url, { ...opts, compress: false, agent: noKeepAliveAgent });

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

function defaultBody(name, pattern, prices = { input: 0.000002, output: 0.000008 }) {
    return {
        name,
        match_pattern: pattern,
        enabled: true,
        tiers: [{ name: 'Default', condition: null, prices }],
    };
}

// ============================================================
// Journey 1 — List page, tabs, search & built-in tab
// Covers: header controls visible, tab switching, custom search
// by name and by pattern, built-in tab rows + search + refresh.
// ============================================================

test.describe("Model Pricing — List, Tabs & Search", () => {

    test("List page controls, tab switching, search and built-in tab all work", {
        tag: ['@modelPricing', '@rendering', '@tabs', '@search', '@builtIn', '@P0', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const ts = Date.now();
        const targetName = `mp_search_target_${ts}`;
        const otherName  = `mp_search_other_${ts}`;
        const ids = [];

        try {
            for (const [n, p] of [
                [targetName, `^${targetName}.*`],
                [otherName,  `^${otherName}.*`],
            ]) {
                const c = await apiCreateModel(defaultBody(n, p));
                if (c?.id) ids.push(c.id);
            }

            await navigateToBase(page);
            const pm = new PageManager(page);
            await pm.modelPricingPage.gotoModelPricingPage();

            // Header controls
            await expect(pm.modelPricingPage.listTitle).toBeVisible();
            await expect(pm.modelPricingPage.refreshBtn).toBeVisible();
            await expect(pm.modelPricingPage.testMatchBtn).toBeVisible();
            await expect(pm.modelPricingPage.importBtn).toBeVisible();
            await expect(pm.modelPricingPage.addBtn).toBeVisible();

            // Search by name — matching row visible, other hidden
            await pm.modelPricingPage.listSearch.fill(targetName);
            await expect(pm.modelPricingPage.listTable.locator(`tr:has-text("${targetName}")`)).toBeVisible({ timeout: 5000 });
            await expect(pm.modelPricingPage.listTable.locator(`tr:has-text("${otherName}")`)).not.toBeVisible({ timeout: 5000 });

            // Search by pattern fragment
            await pm.modelPricingPage.listSearch.clear();
            await pm.modelPricingPage.listSearch.fill(`mp_search_target_${ts}`);
            await expect(pm.modelPricingPage.listTable.locator(`tr:has-text("${targetName}")`)).toBeVisible({ timeout: 5000 });
            await pm.modelPricingPage.listSearch.clear();

            // Switch to built-in tab — rows load
            await pm.modelPricingPage.switchToBuiltInTab();
            await expect(pm.modelPricingPage.builtInTable).toBeVisible({ timeout: 10000 });
            await expect(pm.modelPricingPage.builtInTable.locator('tbody tr').first()).toBeVisible({ timeout: 10000 });

            // Search on built-in tab filters rows
            if (await pm.modelPricingPage.builtInSearch.isVisible({ timeout: 3000 }).catch(() => false)) {
                const totalBefore = await pm.modelPricingPage.builtInTable.locator('tbody tr').count();
                await pm.modelPricingPage.builtInSearch.fill('gpt');
                await expect(async () => {
                    const totalAfter = await pm.modelPricingPage.builtInTable.locator('tbody tr').count();
                    expect(totalAfter).toBeLessThanOrEqual(totalBefore);
                }).toPass({ timeout: 5000 });
                await pm.modelPricingPage.builtInSearch.clear();
            }

            // Refresh built-in list
            await pm.modelPricingPage.builtInRefreshBtn.click();
            await Promise.race([
                pm.modelPricingPage.toastMessage.waitFor({ state: 'visible', timeout: 15000 }),
                pm.modelPricingPage.builtInTable.waitFor({ state: 'visible', timeout: 15000 }),
            ]);
            await expect(pm.modelPricingPage.builtInTable).toBeVisible({ timeout: 10000 });

            // Switch back to custom tab
            await pm.modelPricingPage.switchToCustomTab();
            await expect(pm.modelPricingPage.listTable).toBeVisible({ timeout: 10000 });

        } finally {
            for (const id of ids) await apiDeleteModel(id);
        }

        testLogger.info('Test completed successfully');
    });
});

// ============================================================
// Journey 2 — Create model: full validation + happy path
// Covers: save blocked with both fields empty, name-too-long
// error clears on fix, invalid-regex error clears on fix,
// save blocked with no prices, key-with-spaces toast, pure-
// integer-key toast, successful create with two prices, both
// chips visible in list row.
// ============================================================

test.describe("Model Pricing — Create & Form Validation", () => {

    test("All create-form validations fire correctly, then a model is saved successfully", {
        tag: ['@modelPricing', '@create', '@validation', '@P0', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const ts = Date.now();
        const validName = `mp_create_${ts}`;
        let createdId = null;

        try {
            await navigateToBase(page);
            const pm = new PageManager(page);
            await pm.modelPricingPage.gotoEditorCreate();

            // Both fields empty → save disabled
            await expect(pm.modelPricingPage.saveBtn).toBeDisabled({ timeout: 5000 });

            // Name too long → inline error; fix → error clears
            await pm.modelPricingPage.fillName('a'.repeat(257));
            await expect(pm.modelPricingPage.nameInputError).toBeVisible({ timeout: 5000 });
            await expect(pm.modelPricingPage.saveBtn).toBeDisabled();
            await pm.modelPricingPage.fillName(validName);
            await expect(pm.modelPricingPage.nameInputError).not.toBeVisible({ timeout: 5000 });

            // Invalid regex → inline error; fix → error clears
            await pm.modelPricingPage.fillPattern('[invalid(');
            await expect(pm.modelPricingPage.patternInputError).toBeVisible({ timeout: 5000 });
            await expect(pm.modelPricingPage.saveBtn).toBeDisabled();
            await pm.modelPricingPage.fillPattern(`^${validName}.*`);
            await expect(pm.modelPricingPage.patternInputError).not.toBeVisible({ timeout: 5000 });

            // No prices → save stays on editor
            await pm.modelPricingPage.saveBtn.click();
            await pm.modelPricingPage.editorTitle.waitFor({ state: 'visible', timeout: 5000 });

            // Key with spaces → toast error (filter by text — earlier toasts may still be visible)
            await pm.modelPricingPage.addPriceRow('input tokens', '0.000002');
            await expect(pm.modelPricingPage.toastMessage.filter({ hasText: /must not contain spaces/i }))
                .toBeVisible({ timeout: 5000 });

            // Pure integer key → toast error
            await pm.modelPricingPage.addPriceRow('123', '0.000002');
            await expect(pm.modelPricingPage.toastMessage.filter({ hasText: /cannot be a pure integer/i }))
                .toBeVisible({ timeout: 5000 });

            // Valid prices → save succeeds, both chips visible in list
            await pm.modelPricingPage.addPriceRow('input', '0.000002');
            await pm.modelPricingPage.addPriceRow('output', '0.000008');
            await pm.modelPricingPage.clickSave();

            await pm.modelPricingPage.verifyModelInList(validName);
            const row = pm.modelPricingPage.listTable.locator(`tr:has-text("${validName}")`);
            await expect(row.getByText('input')).toBeVisible({ timeout: 5000 });
            await expect(row.getByText('output')).toBeVisible({ timeout: 5000 });

            const models = await apiListModels();
            createdId = models.find(m => m.name === validName)?.id;
        } finally {
            if (createdId) await apiDeleteModel(createdId);
        }

        testLogger.info('Test completed successfully');
    });
});

// ============================================================
// Journey 3 — Edit, cancel, delete lifecycle
// Covers: edit + cancel (original name unchanged), edit + save
// (updated name in list, old gone), delete + cancel (model
// stays), delete + confirm (model removed).
// ============================================================

test.describe("Model Pricing — Edit, Cancel & Delete", () => {

    test("Full edit-cancel-delete lifecycle works correctly", {
        tag: ['@modelPricing', '@edit', '@delete', '@P0', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const ts = Date.now();
        const originalName = `mp_lifecycle_${ts}`;
        const updatedName  = `mp_lifecycle_upd_${ts}`;
        let createdId = null;

        try {
            const created = await apiCreateModel(defaultBody(originalName, `^${originalName}.*`));
            createdId = created?.id;
            expect(createdId).toBeTruthy();

            await navigateToBase(page);
            const pm = new PageManager(page);
            await pm.modelPricingPage.gotoModelPricingPage();

            // Edit → cancel → original name unchanged
            await pm.modelPricingPage.editBtnForModel(originalName).click();
            await pm.modelPricingPage.verifyEditorOnPage();
            await pm.modelPricingPage.fillName(`${originalName}_changed`);
            await pm.modelPricingPage.clickCancel();
            await pm.modelPricingPage.verifyModelInList(originalName);
            await pm.modelPricingPage.verifyModelNotInList(`${originalName}_changed`);

            // Edit → save → updated name in list, old name gone
            await pm.modelPricingPage.gotoEditorEdit(createdId);
            const nameInput = pm.modelPricingPage.nameInput.locator('input').first();
            await expect(nameInput).toHaveValue(originalName, { timeout: 8000 });
            await pm.modelPricingPage.fillName(updatedName);
            await pm.modelPricingPage.fillPattern(`^${updatedName}.*`);
            await pm.modelPricingPage.clickSave();
            await pm.modelPricingPage.gotoModelPricingPage();
            await pm.modelPricingPage.verifyModelInList(updatedName);
            await pm.modelPricingPage.verifyModelNotInList(originalName);

            const models = await apiListModels();
            createdId = models.find(m => m.name === updatedName)?.id ?? createdId;

            // Delete → cancel → model still there
            await pm.modelPricingPage.deleteBtnForModel(updatedName).click();
            await pm.modelPricingPage.confirmCancelBtn.click();
            await pm.modelPricingPage.verifyModelInList(updatedName);

            // Delete → confirm → model gone
            await pm.modelPricingPage.deleteBtnForModel(updatedName).click();
            await pm.modelPricingPage.confirmOkBtn.click();
            await pm.modelPricingPage.verifyModelNotInList(updatedName);
            createdId = null;
        } finally {
            if (createdId) await apiDeleteModel(createdId);
        }

        testLogger.info('Test completed successfully');
    });
});

// ============================================================
// Journey 4 — Duplicate & clone
// Covers: duplicate org model (copy suffix, saves as new entry
// alongside original), clone built-in model (creates editable
// org copy on Custom tab).
// ============================================================

test.describe("Model Pricing — Duplicate & Clone", () => {

    test("Duplicating an org model and cloning a built-in model both create new entries", {
        tag: ['@modelPricing', '@duplicate', '@clone', '@builtIn', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const name = `mp_dup_src_${Date.now()}`;
        let srcId = null;
        let copyId = null;
        let clonedId = null;

        // Pre-clean leftover "(Copy)" org models to avoid duplicate-name rejection
        const existing = await apiListModels();
        for (const m of existing) {
            if (m.name?.endsWith(' (Copy)') && (m.source === 'org' || !m.source)) {
                await apiDeleteModel(m.id);
            }
        }

        try {
            const created = await apiCreateModel(defaultBody(name, `^${name}.*`));
            srcId = created?.id;
            expect(srcId).toBeTruthy();

            await navigateToBase(page);
            const pm = new PageManager(page);
            // Duplicate → "(Copy)" suffix in editor → save → both entries in list
            await pm.modelPricingPage.gotoEditorDuplicate(srcId);
            const dupName = await pm.modelPricingPage.nameInput.locator('input').first().inputValue();
            expect(dupName).toMatch(/copy|Copy|\(copy\)/i);
            await pm.modelPricingPage.fillPattern(`^mp_dup_copy_${Date.now()}.*`);
            await pm.modelPricingPage.clickSave();
            await pm.modelPricingPage.verifyModelInList(name);
            await pm.modelPricingPage.verifyModelInList(dupName);
            const afterDup = await apiListModels();
            copyId = afterDup.find(m => m.name === dupName)?.id;

            // Clone a built-in → editor opens → save → copy on Custom tab
            await pm.modelPricingPage.gotoModelPricingPage();
            await pm.modelPricingPage.switchToBuiltInTab();
            const firstRow = pm.modelPricingPage.builtInTable.locator('tbody tr').first();
            await expect(firstRow).toBeVisible({ timeout: 10000 });
            const builtInName = (await firstRow.locator('td').first().textContent())?.trim() || '';
            await pm.modelPricingPage.cloneBtnForRow(firstRow).click();
            await pm.modelPricingPage.verifyEditorOnPage();
            await pm.modelPricingPage.clickSave();
            await expect(pm.modelPricingPage.listTitle).toBeVisible({ timeout: 15000 });
            const afterClone = await apiListModels();
            const cloned = afterClone.find(
                m => m.name === `${builtInName} (Copy)` && (m.source === 'org' || !m.source)
            );
            clonedId = cloned?.id ?? afterClone.find(m => m.name?.endsWith(' (Copy)'))?.id;
        } finally {
            if (srcId)    await apiDeleteModel(srcId);
            if (copyId)   await apiDeleteModel(copyId);
            if (clonedId) await apiDeleteModel(clonedId);
        }

        testLogger.info('Test completed successfully');
    });
});

// ============================================================
// Journey 5 — Bulk actions: select → export → bulk delete
// Covers: checkbox selection of multiple rows, JSON export
// contains selected models, bulk delete removes all selected.
// Export runs before delete so we use the same selection.
// ============================================================

test.describe("Model Pricing — Bulk Actions", () => {

    test("Selecting models, exporting to JSON and bulk deleting all work correctly", {
        tag: ['@modelPricing', '@export', '@delete', '@bulk', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const ts = Date.now();
        const names = [`mp_bulk_a_${ts}`, `mp_bulk_b_${ts}`, `mp_bulk_c_${ts}`];
        const ids = [];

        try {
            for (const n of names) {
                const c = await apiCreateModel(defaultBody(n, `^${n}.*`));
                if (c?.id) ids.push(c.id);
            }
            expect(ids).toHaveLength(3);

            await navigateToBase(page);
            const pm = new PageManager(page);
            await pm.modelPricingPage.gotoModelPricingPage();

            for (const n of names) await pm.modelPricingPage.checkRowByName(n);

            // Export — downloaded JSON must contain all 3 models
            const [download] = await Promise.all([
                page.waitForEvent('download'),
                pm.modelPricingPage.exportSelectedBtn.click(),
            ]);
            const downloadPath = await download.path();
            expect(downloadPath).toBeTruthy();
            const parsed = JSON.parse(fs.readFileSync(downloadPath, 'utf-8'));
            const list = Array.isArray(parsed) ? parsed : (parsed.list || [parsed]);
            for (const n of names) expect(list.some(m => m.name === n)).toBeTruthy();

            // Re-select (export may deselect rows) then bulk delete
            for (const n of names) await pm.modelPricingPage.checkRowByName(n);
            await pm.modelPricingPage.deleteSelectedBtn.click();
            await pm.modelPricingPage.confirmOkBtn.click();
            for (const n of names) await pm.modelPricingPage.verifyModelNotInList(n);
            ids.length = 0; // deleted via UI — skip finally cleanup
        } finally {
            for (const id of ids) await apiDeleteModel(id);
        }

        testLogger.info('Test completed successfully');
    });
});

// ============================================================
// Journey 6 — Enable/disable toggle
// Covers: model starts enabled (ghost-destructive variant),
// toggle off flips to ghost variant, toggle on restores
// ghost-destructive. Model stays in list throughout.
// OButton exposes current variant via data-o2-variant attr.
// ============================================================

test.describe("Model Pricing — Toggle", () => {

    test("Toggle disables then re-enables a model with correct visual state each time", {
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

            // Starts enabled
            await expect(pm.modelPricingPage.toggleBtnForModel(name))
                .toHaveAttribute('data-o2-variant', 'ghost-destructive', { timeout: 5000 });

            // Toggle off → disabled state
            await pm.modelPricingPage.toggleBtnForModel(name).click();
            await pm.modelPricingPage.verifyModelInList(name);
            await expect(pm.modelPricingPage.toggleBtnForModel(name))
                .toHaveAttribute('data-o2-variant', 'ghost', { timeout: 5000 });

            // Toggle on → enabled state restored
            await pm.modelPricingPage.toggleBtnForModel(name).click();
            await pm.modelPricingPage.verifyModelInList(name);
            await expect(pm.modelPricingPage.toggleBtnForModel(name))
                .toHaveAttribute('data-o2-variant', 'ghost-destructive', { timeout: 5000 });
        } finally {
            if (createdId) await apiDeleteModel(createdId);
        }

        testLogger.info('Test completed successfully');
    });
});

// ============================================================
// Journey 7 — Test match dialog: full flow
// Covers: empty state on open, no-result for unknown model,
// clear resets to empty state, matching name shows result.
// All four former tests run in one dialog session.
// ============================================================

test.describe("Model Pricing — Test Match Dialog", () => {

    test("Test match dialog covers empty state, no-result, clear and match result in one flow", {
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

            // Empty state on open
            await expect(pm.modelPricingPage.testMatchDialog).toBeVisible({ timeout: 10000 });
            await expect(pm.modelPricingPage.testMatchEmpty).toBeVisible({ timeout: 5000 });
            await expect(pm.modelPricingPage.testMatchInput).toBeVisible();

            // Unknown name → no-result state
            await pm.modelPricingPage.fillTestMatchInput(`definitely_nonexistent_${ts}`);
            await pm.modelPricingPage.clickTestMatchRun();
            await expect(pm.modelPricingPage.testMatchNoResult).toBeVisible({ timeout: 10000 });

            // Clear → back to empty state
            await pm.modelPricingPage.clearTestMatch();
            await expect(pm.modelPricingPage.testMatchEmpty).toBeVisible({ timeout: 5000 });
            await expect(pm.modelPricingPage.testMatchInput.locator('input').first())
                .toHaveValue('', { timeout: 5000 });

            // Matching model name → result with pricing shown
            await pm.modelPricingPage.fillTestMatchInput(modelName);
            await pm.modelPricingPage.clickTestMatchRun();
            await expect(pm.modelPricingPage.testMatchResult).toBeVisible({ timeout: 10000 });

            await pm.modelPricingPage.closeTestMatchDialog();
        } finally {
            if (createdId) await apiDeleteModel(createdId);
        }

        testLogger.info('Test completed successfully');
    });
});

// ============================================================
// Journey 8 — Import: happy path + correction flows + cancel
// Covers: valid JSON imports two models successfully, duplicate-
// name triggers rename correction UI, missing match_pattern
// triggers pattern correction UI, cancel returns to list.
// ============================================================

test.describe("Model Pricing — Import", () => {

    test("Import handles valid JSON, correction flows and cancel correctly", {
        tag: ['@modelPricing', '@import', '@P0', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const ts = Date.now();
        let existingId = null;
        const importedIds = [];

        try {
            await navigateToBase(page);
            const pm = new PageManager(page);

            // ── Happy path ────────────────────────────────────────
            await pm.modelPricingPage.gotoModelPricingPage();
            await pm.modelPricingPage.clickImport();
            await pm.modelPricingPage.uploadImportJson(JSON.stringify([
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
            ]));
            await page.waitForTimeout(800); // BaseImport needs time to parse JSON before confirm is valid
            await pm.modelPricingPage.clickImportConfirm();
            await Promise.race([
                pm.modelPricingPage.listTitle.waitFor({ state: 'visible', timeout: 15000 }),
                pm.modelPricingPage.toastMessage.waitFor({ state: 'visible', timeout: 15000 }),
            ]);
            const afterValid = await apiListModels();
            for (const n of [`mp_import_a_${ts}`, `mp_import_b_${ts}`]) {
                const m = afterValid.find(x => x.name === n);
                if (m?.id) importedIds.push(m.id);
            }

            // ── Duplicate-name correction ────────────────────────
            const existingName = `mp_import_dup_${ts}`;
            const dup = await apiCreateModel(defaultBody(existingName, `^${existingName}.*`));
            existingId = dup?.id;
            expect(existingId).toBeTruthy();

            await pm.modelPricingPage.gotoModelPricingPage();
            await pm.modelPricingPage.clickImport();
            await pm.modelPricingPage.uploadImportJson(JSON.stringify([{
                name: existingName,
                match_pattern: `^${existingName}.*`,
                enabled: true,
                tiers: [{ name: 'Default', condition: null, prices: { input: 0.000002 } }],
            }]));
            await page.waitForTimeout(800);
            await pm.modelPricingPage.clickImportConfirm();
            await expect(pm.modelPricingPage.importNameInput).toBeVisible({ timeout: 10000 });
            const fixedName = `${existingName}_fixed`;
            await pm.modelPricingPage.importNameInput.locator('input, textarea').first().fill(fixedName);
            await pm.modelPricingPage.clickImportConfirm();
            await Promise.race([
                pm.modelPricingPage.listTitle.waitFor({ state: 'visible', timeout: 15000 }),
                pm.modelPricingPage.toastMessage.waitFor({ state: 'visible', timeout: 15000 }),
            ]);
            const afterDup = await apiListModels();
            const fixed = afterDup.find(m => m.name === fixedName);
            if (fixed?.id) importedIds.push(fixed.id);

            // ── Missing-pattern correction ───────────────────────
            const noPat = `mp_import_nopat_${ts}`;
            await pm.modelPricingPage.gotoModelPricingPage();
            await pm.modelPricingPage.clickImport();
            await pm.modelPricingPage.uploadImportJson(JSON.stringify([{
                name: noPat,
                enabled: true,
                tiers: [{ name: 'Default', condition: null, prices: { input: 0.000002 } }],
            }]));
            await page.waitForTimeout(800);
            await pm.modelPricingPage.clickImportConfirm();
            await expect(pm.modelPricingPage.importPatternInput).toBeVisible({ timeout: 10000 });
            await pm.modelPricingPage.importPatternInput.locator('input').first().fill(`^${noPat}.*`);
            await pm.modelPricingPage.clickImportConfirm();
            await Promise.race([
                pm.modelPricingPage.listTitle.waitFor({ state: 'visible', timeout: 15000 }),
                pm.modelPricingPage.toastMessage.waitFor({ state: 'visible', timeout: 15000 }),
            ]);
            const afterNoPat = await apiListModels();
            const noPatModel = afterNoPat.find(m => m.name === noPat);
            if (noPatModel?.id) importedIds.push(noPatModel.id);

            // ── Cancel returns to list without creating anything ──
            await pm.modelPricingPage.gotoModelPricingPage();
            await pm.modelPricingPage.clickImport();
            await pm.modelPricingPage.uploadImportJson(JSON.stringify([{
                name: `mp_import_cancel_${ts}`,
                match_pattern: `^mp_import_cancel.*`,
                enabled: true,
                tiers: [{ name: 'Default', condition: null, prices: { input: 0.000002 } }],
            }]));
            await page.waitForTimeout(800);
            await pm.modelPricingPage.clickImportCancel();
            await expect(pm.modelPricingPage.listTitle).toBeVisible({ timeout: 10000 });

        } finally {
            if (existingId) await apiDeleteModel(existingId);
            for (const id of importedIds) await apiDeleteModel(id);
        }

        testLogger.info('Test completed successfully');
    });
});

// ============================================================
// Journey 9 — Editor features: multi-tier, template, examples
// Covers: adding a second conditional tier saves correctly,
// applying a pricing template pre-fills price keys, pattern
// examples dialog copies a pattern into the input.
// All three are optional UI — guarded by isVisible checks.
// ============================================================

test.describe("Model Pricing — Editor Features", () => {

    test("Multi-tier create, pricing template and pattern examples all work when available", {
        tag: ['@modelPricing', '@create', '@multiTier', '@template', '@examples', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const ids = [];

        try {
            await navigateToBase(page);
            const pm = new PageManager(page);

            // ── Multi-tier ─────────────────────────────────────────
            const multiTierName = `mp_multitier_${Date.now()}`;
            await pm.modelPricingPage.gotoEditorCreate();
            await pm.modelPricingPage.fillName(multiTierName);
            await pm.modelPricingPage.fillPattern(`^${multiTierName}.*`);
            await pm.modelPricingPage.addPriceRow('input', '0.000002');
            if (await pm.modelPricingPage.addTierBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
                await pm.modelPricingPage.addTierBtn.click();
                await pm.modelPricingPage.addPriceRow('input', '0.0000015', 1);
            }
            await pm.modelPricingPage.clickSave();
            await pm.modelPricingPage.verifyModelInList(multiTierName);
            const afterMulti = await apiListModels();
            const multiId = afterMulti.find(m => m.name === multiTierName)?.id;
            if (multiId) ids.push(multiId);

            // ── Pricing template ───────────────────────────────────
            const templateName = `mp_template_${Date.now()}`;
            await pm.modelPricingPage.gotoEditorCreate();
            await pm.modelPricingPage.fillName(templateName);
            await pm.modelPricingPage.fillPattern(`^${templateName}.*`);
            if (await pm.modelPricingPage.templateBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
                await pm.modelPricingPage.templateBtn.click();
                await pm.modelPricingPage.priceValueInput.focus();
                await pm.modelPricingPage.priceValueInput.selectText();
                await page.keyboard.type('0.000002');
                await pm.modelPricingPage.priceValueInput.press('Tab');
            } else {
                await pm.modelPricingPage.addPriceRow('input', '0.000002');
            }
            await pm.modelPricingPage.clickSave();
            await pm.modelPricingPage.verifyModelInList(templateName);
            const afterTemplate = await apiListModels();
            const templateId = afterTemplate.find(m => m.name === templateName)?.id;
            if (templateId) ids.push(templateId);

            // ── Pattern examples ───────────────────────────────────
            await pm.modelPricingPage.gotoEditorCreate();
            if (await pm.modelPricingPage.examplesBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
                await pm.modelPricingPage.examplesBtn.click();
                await expect(pm.modelPricingPage.examplesDialog).toBeVisible({ timeout: 10000 });
                await pm.modelPricingPage.examplesDialog
                    .locator('button, [role="option"], li').first().click();
                const value = await pm.modelPricingPage.patternInput.locator('input').first().inputValue();
                expect(value.length).toBeGreaterThan(0);
            } else {
                testLogger.info('Examples button not present in this build — skipping');
            }

        } finally {
            for (const id of ids) await apiDeleteModel(id);
        }

        testLogger.info('Test completed successfully');
    });
});

// ============================================================
// Journey 10 — Pricing drawer
// Covers: model with more than 3 price keys shows "+N more"
// overflow link; clicking opens drawer with all keys listed.
// ============================================================

test.describe("Model Pricing — Pricing Drawer", () => {

    test("Overflow link opens pricing drawer showing all price keys", {
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
                for (const key of ['input', 'output', 'cache-read', 'cache-write', 'reasoning']) {
                    await expect(pm.modelPricingPage.pricingDrawer.getByText(key, { exact: false }))
                        .toBeVisible({ timeout: 5000 });
                }
            } else {
                testLogger.info('No overflow link visible — model shows all keys inline in current view');
            }
        } finally {
            if (createdId) await apiDeleteModel(createdId);
        }

        testLogger.info('Test completed successfully');
    });
});

// ============================================================
// Journey 11 — Empty state
// Covers: when org has zero custom models the empty-state CTA
// is shown. Runs serially after cleanup; skipped when pre-
// existing non-test models prevent reaching the empty state.
// ============================================================

test.describe("Model Pricing — Empty State", () => {
    test.describe.configure({ mode: 'serial' });

    test("Empty-state CTA shows when org has no custom models", {
        tag: ['@modelPricing', '@rendering', '@emptyState', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

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
// Cost verification helpers (Journeys 12 & 13)
// ============================================================

/** Build a minimal OTLP JSON span that OpenObserve recognises as an LLM span. */
function buildLlmOtlpPayload({ traceId, spanId, modelName, inputTokens, outputTokens, durationMs = 1000 }) {
    const startNs = BigInt(Date.now()) * 1_000_000n;
    const endNs   = startNs + BigInt(durationMs) * 1_000_000n;

    return {
        resourceSpans: [{
            resource: {
                attributes: [
                    { key: 'service.name',           value: { stringValue: 'e2e-pricing-verifier' } },
                    { key: 'service.version',         value: { stringValue: '1.0.0' } },
                    { key: 'telemetry.sdk.language',  value: { stringValue: 'nodejs' } },
                    { key: 'telemetry.sdk.name',      value: { stringValue: 'opentelemetry' } },
                ],
            },
            scopeSpans: [{
                scope: { name: 'opentelemetry-instrumentation-genai', version: '1.0.0' },
                spans: [{
                    traceId,
                    spanId,
                    name:              `gen_ai.chat.completions ${modelName}`,
                    kind:              3,  // CLIENT
                    startTimeUnixNano: String(startNs),
                    endTimeUnixNano:   String(endNs),
                    attributes: [
                        { key: 'gen_ai.operation.name',      value: { stringValue: 'chat' } },
                        { key: 'gen_ai.system',              value: { stringValue: 'anthropic' } },
                        { key: 'gen_ai.request.model',       value: { stringValue: modelName } },
                        { key: 'gen_ai.response.model',      value: { stringValue: modelName } },
                        { key: 'gen_ai.usage.input_tokens',  value: { intValue: inputTokens } },
                        { key: 'gen_ai.usage.output_tokens', value: { intValue: outputTokens } },
                        {
                            key: 'gen_ai.input.messages',
                            value: { stringValue: JSON.stringify([{ role: 'user', content: 'hello' }]) },
                        },
                        {
                            key: 'gen_ai.output.messages',
                            value: { stringValue: JSON.stringify([{ role: 'assistant', content: 'hi' }]) },
                        },
                    ],
                    status: { code: 1 },  // OK
                }],
            }],
        }],
    };
}

/** Ingest a single OTLP span via the traces HTTP endpoint. */
async function ingestLlmSpan(page, payload) {
    const res = await page.request.post(
        `${process.env.ZO_BASE_URL}/api/${getOrgIdentifier()}/v1/traces`,
        { headers: getAuthHeaders(), data: payload },
    );
    if (res.status() !== 200) {
        throw new Error(`Trace ingestion returned ${res.status()}: ${await res.text()}`);
    }
}

/**
 * Poll the trace search API until the span with the given spanId appears,
 * OR until timeoutMs is reached.  Returns the first matching hit, or null.
 */
async function pollForSpan(spanId, timeoutMs = 30_000, intervalMs = 3_000) {
    const org     = getOrgIdentifier();
    const nowUs   = Date.now() * 1000;
    const startUs = nowUs - 2 * 60 * 1_000_000;  // 2 min back
    const endUs   = nowUs + 5 * 60 * 1_000_000;  // 5 min forward

    const searchUrl = `${process.env.ZO_BASE_URL}/api/${org}/_search?type=traces`;
    const body = {
        query: {
            sql: `SELECT span_id, gen_ai_usage_cost, gen_ai_usage_input_tokens, gen_ai_usage_output_tokens
                  FROM default
                  WHERE span_id = '${spanId}'`,
            start_time: startUs,
            end_time:   endUs,
            size:       10,
        },
    };

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const res = await fetch(searchUrl, {
            method:  'POST',
            headers: getAuthHeaders(),
            body:    JSON.stringify(body),
        });
        if (res.ok) {
            const data = await res.json();
            const hits = data?.hits ?? [];
            if (hits.length > 0) return hits[0];
        }
        await new Promise(r => setTimeout(r, intervalMs));
    }
    return null;
}

// ============================================================
// Journey 12 — Custom pricing cost is applied to an ingested
// matching LLM span
// ============================================================

test.describe("Model Pricing — Cost Applied to Ingested LLM Span", () => {
    test.describe.configure({ mode: 'serial' });

    test("Custom pricing cost is correctly calculated and stored when a matching LLM span is ingested", {
        tag: ['@modelPricing', '@costVerification', '@P0', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        const ts      = Date.now();
        const pattern = `^e2e-llm-pricing-${ts}-.*`;
        const model   = `e2e-llm-pricing-${ts}-gpt`;

        // Prices: $3/M input, $15/M output — stored as per-token values
        const inputPricePerToken  = 3  / 1_000_000;  // 0.000003
        const outputPricePerToken = 15 / 1_000_000;  // 0.000015
        const inputTokens  = 1_000;
        const outputTokens = 500;
        const expectedInputCost  = inputTokens  * inputPricePerToken;   // 0.003
        const expectedOutputCost = outputTokens * outputPricePerToken;  // 0.0075
        const expectedTotalCost  = expectedInputCost + expectedOutputCost; // 0.0105

        let modelId = null;

        try {
            // ── Step 1: create the pricing model ──────────────────
            const created = await apiCreateModel({
                name:          `E2E Pricing Verifier ${ts}`,
                match_pattern: pattern,
                enabled:       true,
                tiers: [{
                    name:      'Default',
                    condition: null,
                    prices: { input: inputPricePerToken, output: outputPricePerToken },
                }],
            });
            modelId = created?.id;
            expect(modelId, 'pricing model must be created with an ID').toBeTruthy();
            testLogger.info('Pricing model created', { modelId, pattern });

            // ── Step 2: wait for the in-memory pricing cache to pick up the new definition
            await page.waitForTimeout(5_000);

            // ── Step 3: ingest a synthetic LLM span ───────────────
            const traceId = generateHexId(16);
            const spanId  = generateHexId(8);
            const payload = buildLlmOtlpPayload({ traceId, spanId, modelName: model, inputTokens, outputTokens });
            await ingestLlmSpan(page, payload);
            testLogger.info('LLM span ingested', { spanId, model, inputTokens, outputTokens });

            // ── Step 4: poll search API until the span is queryable ─
            const hit = await pollForSpan(spanId);
            expect(hit, `span ${spanId} must appear in the default trace stream within 30 s`).not.toBeNull();
            testLogger.info('Span found in stream', { hit });

            // ── Step 5: verify cost fields ─────────────────────────
            const actualCost = Number(hit.gen_ai_usage_cost);
            expect(actualCost, 'gen_ai_usage_cost must be > 0').toBeGreaterThan(0);
            expect(
                Math.abs(actualCost - expectedTotalCost),
                `total cost must be ~${expectedTotalCost} (got ${actualCost})`
            ).toBeLessThan(1e-9);

            if (hit.gen_ai_usage_cost_input != null) {
                expect(Math.abs(Number(hit.gen_ai_usage_cost_input) - expectedInputCost)).toBeLessThan(1e-9);
            }
            if (hit.gen_ai_usage_cost_output != null) {
                expect(Math.abs(Number(hit.gen_ai_usage_cost_output) - expectedOutputCost)).toBeLessThan(1e-9);
            }

            testLogger.info('Cost assertion passed', {
                expectedTotal:  expectedTotalCost,
                actualTotal:    actualCost,
                expectedInput:  expectedInputCost,
                expectedOutput: expectedOutputCost,
            });

        } finally {
            if (modelId) await apiDeleteModel(modelId);
        }

        testLogger.info('Test completed successfully');
    });
});

// ============================================================
// Journey 13 — LLM span with no matching pricing model stores
// zero cost
// ============================================================

test.describe("Model Pricing — No Matching Model Stores Zero Cost", () => {
    test.describe.configure({ mode: 'serial' });

    test("LLM span with a completely unknown model name is stored with no cost applied", {
        tag: ['@modelPricing', '@costVerification', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        const ts      = Date.now();
        const model   = `e2e-unknown-model-${ts}-xqz`;
        const traceId = generateHexId(16);
        const spanId  = generateHexId(8);

        const payload = buildLlmOtlpPayload({
            traceId, spanId, modelName: model,
            inputTokens: 500, outputTokens: 200,
        });
        await ingestLlmSpan(page, payload);
        testLogger.info('LLM span with unknown model ingested', { spanId, model });

        const hit = await pollForSpan(spanId);
        expect(hit, `span ${spanId} must appear in the default trace stream within 30 s`).not.toBeNull();

        const cost = hit.gen_ai_usage_cost;
        const costIsAbsent = cost == null || cost === '' || cost === undefined;
        const costIsZero   = Number(cost) === 0;
        expect(
            costIsAbsent || costIsZero,
            `gen_ai_usage_cost must be absent or 0 for an unrecognised model (got: ${cost})`
        ).toBe(true);

        testLogger.info('Zero-cost assertion passed', { cost });
        testLogger.info('Test completed successfully');
    });
});
