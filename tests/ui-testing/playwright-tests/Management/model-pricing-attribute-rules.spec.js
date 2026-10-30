const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { apiListModels, apiCreateModel, apiDeleteModel } = require('../utils/model-pricing-api.js');

// ============================================================
// Attribute Rules — create/save, test-match, edit round-trip,
// validation, tie warning, and the 8-rule cap.
// ============================================================

test.describe("Model Pricing — Attribute Rules", () => {
    test.describe.configure({ mode: 'parallel' });

    test.beforeEach(async ({ page }) => {
        await navigateToBase(page);
        const edition = await new PageManager(page).editionFeaturesPage.detectEdition();
        test.skip(edition === 'opensource', `Model pricing is Enterprise/Cloud-only (detected: ${edition})`);
    });

    test("Create a model with an attribute-rule tier, save persists it, and the drawer renders the rule", {
        tag: ['@model-pricing-attribute-rules', '@modelPricing', '@create', '@rules', '@P0', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const ts = Date.now();
        const name = `mp_rule_ui_${ts}`;
        let createdId = null;

        try {
            await navigateToBase(page);
            const pm = new PageManager(page);
            await pm.modelPricingPage.gotoEditorCreate();
            await pm.modelPricingPage.fillName(name);
            await pm.modelPricingPage.fillPattern(`^${name}.*`);

            // Three default-tier prices so the list row shows the "+N more" overflow chip
            // that opens the pricing drawer.
            await pm.modelPricingPage.addPriceRow('input', '0.000002');
            await pm.modelPricingPage.addPriceRow('output', '0.000008');
            await pm.modelPricingPage.addPriceRow('cache_read', '0.000001');

            // Add a non-default tier, then a rule on it.
            await pm.modelPricingPage.clickAddTier();
            // The tier arrives with a usage condition; a rule tier needs only the rule.
            await pm.modelPricingPage.removeTierCondition(1, 'input');
            await pm.modelPricingPage.addTierCondition(1, {
                field: 'openai.response.service_tier, openai.request.service_tier',
                search: 'openai.response',
                operator: 'in',
                values: ['flex'],
            });
            await pm.modelPricingPage.addPriceRow('input', '0.000003', 1);

            const saved = await pm.modelPricingPage.clickSave();
            createdId = saved?.id;
            await pm.modelPricingPage.verifyModelInList(name);

            // The pricing drawer renders the saved rule line.
            await pm.modelPricingPage.openPricingDrawerForModel(name);
            await pm.modelPricingPage.expectDrawerTierRuleVisible('openai.response.service_tier');

            // API round-trip: tiers[1].rules[0] carries the persisted rule.
            const models = await apiListModels();
            const created = models.find((m) => m.name === name);
            createdId = created?.id;
            expect(createdId).toBeTruthy();
            expect(created.tiers[1].rules[0]).toMatchObject({
                keys: ['openai.response.service_tier', 'openai.request.service_tier'],
                op: 'in',
                values: ['flex'],
            });
        } finally {
            if (createdId) await apiDeleteModel(createdId);
        }

        testLogger.info('Test completed successfully');
    });

    test("Test-Match resolves a winning rule tier from span attributes", {
        tag: ['@model-pricing-attribute-rules', '@modelPricing', '@testMatch', '@rules', '@P0', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const ts = Date.now();
        const name = `mp_tm_${ts}`;
        let createdId = null;

        try {
            const created = await apiCreateModel({
                name,
                match_pattern: `^${name}.*`,
                enabled: true,
                tiers: [
                    { name: 'Default', condition: null, prices: { input: 0.000002, output: 0.000008 } },
                    {
                        name: 'Flex tier',
                        condition: null,
                        rules: [{
                            keys: ['openai.response.service_tier'],
                            op: 'in',
                            values: ['flex', 'priority'],
                        }],
                        prices: { input: 0.000003 },
                    },
                ],
            });
            createdId = created?.id;
            expect(createdId).toBeTruthy();

            await navigateToBase(page);
            const pm = new PageManager(page);
            await pm.modelPricingPage.gotoModelPricingPage();
            await pm.modelPricingPage.clickTestMatch();
            await pm.modelPricingPage.fillTestMatchInput(`${name}-gpt-4o`);
            await pm.modelPricingPage.clickTestMatchAttributeAdd();
            await pm.modelPricingPage.fillTestMatchAttributeKey(0, 'openai.response.service_tier');
            await pm.modelPricingPage.fillTestMatchAttributeValue(0, 'flex');
            await pm.modelPricingPage.clickTestMatchRun();
            await pm.modelPricingPage.expectTestMatchResultVisible();
            await pm.modelPricingPage.expectTestMatchTierRuleVisible('openai.response.service_tier');
        } finally {
            if (createdId) await apiDeleteModel(createdId);
        }

        testLogger.info('Test completed successfully');
    });

    test("Saved rules prefill as chips, a replaced rule and an add-then-remove re-save as expected", {
        tag: ['@model-pricing-attribute-rules', '@modelPricing', '@edit', '@rules', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const ts = Date.now();
        const name = `mp_rule_edit_${ts}`;
        let createdId = null;

        try {
            const created = await apiCreateModel({
                name,
                match_pattern: `^${name}.*`,
                enabled: true,
                tiers: [
                    { name: 'Default', condition: null, prices: { input: 0.000002, output: 0.000008 } },
                    {
                        name: 'Flex tier',
                        condition: null,
                        rules: [{
                            keys: ['openai.response.service_tier', 'openai.request.service_tier'],
                            op: 'in',
                            values: ['flex'],
                        }],
                        prices: { input: 0.000003 },
                    },
                ],
            });
            createdId = created?.id;
            expect(createdId).toBeTruthy();

            await navigateToBase(page);
            const pm = new PageManager(page);
            await pm.modelPricingPage.gotoEditorEdit(createdId);

            const keys = 'openai.response.service_tier, openai.request.service_tier';
            // Prefill reflects the saved rule as one chip: keys joined by ", ", values "flex".
            await pm.modelPricingPage.expectTierCondition(1, keys, 'flex');

            // Swap it for a threshold rule on the same keys.
            await pm.modelPricingPage.removeTierCondition(1, keys);
            await pm.modelPricingPage.addTierCondition(1, {
                field: keys,
                search: 'openai.response',
                operator: 'gt',
                values: ['200000'],
            });

            // Add then remove a second rule — the tier returns to one rule.
            await pm.modelPricingPage.addTierCondition(1, { field: 'usage.output', operator: 'lt', values: ['10'] });
            await pm.modelPricingPage.expectTierConditionCount(1, 2);
            await pm.modelPricingPage.removeTierCondition(1, 'usage.output');
            await pm.modelPricingPage.expectTierConditionCount(1, 1);

            await pm.modelPricingPage.clickSave();
            await pm.modelPricingPage.verifyModelInList(name);

            const models = await apiListModels();
            const after = models.find((m) => m.name === name);
            expect(after.tiers[1].rules).toHaveLength(1);
            expect(after.tiers[1].rules[0]).toMatchObject({
                keys: ['openai.response.service_tier', 'openai.request.service_tier'],
                op: 'gt',
                value: 200000,
            });
            expect(after.tiers[1].rules[0].values).toBeFalsy();
        } finally {
            if (createdId) await apiDeleteModel(createdId);
        }

        testLogger.info('Test completed successfully');
    });

    test("Rule validation blocks save: presence-op-on-usage forbidden, shown under the tier's filter", {
        tag: ['@model-pricing-attribute-rules', '@modelPricing', '@validation', '@rules', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const ts = Date.now();
        const name = `mp_rule_val_${ts}`;

        await navigateToBase(page);
        const pm = new PageManager(page);
        await pm.modelPricingPage.gotoEditorCreate();
        await pm.modelPricingPage.fillName(name);
        await pm.modelPricingPage.fillPattern(`^${name}.*`);
        await pm.modelPricingPage.addPriceRow('input', '0.000002');
        await pm.modelPricingPage.clickAddTier();
        // "is set" on a usage. key is forbidden: save stays on the editor and says why under the builder.
        await pm.modelPricingPage.addTierCondition(1, { field: 'usage.input', operator: 'is_not_null' });
        await pm.modelPricingPage.saveBtn.click();
        await pm.modelPricingPage.expectTierFilterError(1, 'usage.');
        await pm.modelPricingPage.editorTitle.waitFor({ state: 'visible', timeout: 5000 });

        testLogger.info('Test completed successfully');
    });

    test("Two identical rule tiers with equal priority show the ambiguous-tier warning", {
        tag: ['@model-pricing-attribute-rules', '@modelPricing', '@warning', '@rules', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const ts = Date.now();
        const name = `mp_rule_tie_${ts}`;
        let createdId = null;

        try {
            const rule = { keys: ['openai.response.service_tier'], op: 'in', values: ['flex'] };
            const created = await apiCreateModel({
                name,
                match_pattern: `^${name}.*`,
                enabled: true,
                tiers: [
                    { name: 'Default', condition: null, prices: { input: 0.000002, output: 0.000008 } },
                    { name: 'Flex A', condition: null, rules: [rule], prices: { input: 0.000003 } },
                    { name: 'Flex B', condition: null, rules: [rule], prices: { input: 0.000004 } },
                ],
            });
            createdId = created?.id;
            expect(createdId).toBeTruthy();

            await navigateToBase(page);
            const pm = new PageManager(page);
            await pm.modelPricingPage.gotoEditorEdit(createdId);
            await pm.modelPricingPage.expectTieWarningVisible();
        } finally {
            if (createdId) await apiDeleteModel(createdId);
        }

        testLogger.info('Test completed successfully');
    });

    test("Add condition is disabled at the 8-rule cap", {
        tag: ['@model-pricing-attribute-rules', '@modelPricing', '@rules', '@P2', '@all'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        const ts = Date.now();
        const name = `mp_rule_cap_${ts}`;

        await navigateToBase(page);
        const pm = new PageManager(page);
        await pm.modelPricingPage.gotoEditorCreate();
        await pm.modelPricingPage.fillName(name);
        await pm.modelPricingPage.fillPattern(`^${name}.*`);
        await pm.modelPricingPage.addPriceRow('input', '0.000002');
        await pm.modelPricingPage.clickAddTier();

        // The seeded usage condition plus 8 rules is the tier's whole budget.
        for (let i = 0; i < 8; i += 1) {
            await pm.modelPricingPage.addTierCondition(1, {
                field: `attr_${i}`,
                operator: 'in',
                values: ['x'],
            });
        }

        // Confirm all 8 rules actually landed before asserting the cap — an
        // unrelated failure that disabled the button would otherwise pass.
        await pm.modelPricingPage.expectTierConditionCount(1, 9);
        await pm.modelPricingPage.expectTierAddConditionDisabled(1);

        testLogger.info('Test completed successfully');
    });
});
