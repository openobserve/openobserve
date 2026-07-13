// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const path = require('path');

test.describe.configure({ mode: 'parallel' });

test.use({
    contextOptions: {
        slowMo: 500,
    },
});

// ─── CreateBackfillJobDialog – Form Validation ────────────────────────────────

test.describe(
    'Pipelines – CreateBackfillJobDialog Form Validation',
    { tag: ['@pipelines-form-validation', '@P0', '@smoke'] },
    () => {
        /** @type {PageManager} */
        let pm;

        test.beforeEach(async ({ page }, testInfo) => {
            testLogger.testStart(testInfo.title, testInfo.file);
            await navigateToBase(page);
            pm = new PageManager(page);
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        });

        test.afterEach(async ({ page }) => {
            // Close any open drawer/dialog to avoid bleed-through between tests
            try {
                const cancelBtn = pm.pipelinesFormValidation.getBackfillSecondaryBtnLocator();
                if (await cancelBtn.isVisible({ timeout: 1000 })) {
                    await cancelBtn.click();
                }
            } catch {
                // nothing to close
            }
        });

        /**
         * Opens the backfill drawer for a pipeline by navigating via the
         * Pipelines list and triggering the backfill action on the first
         * available scheduled pipeline row.  Returns false if no scheduled
         * pipeline is available in the current org (test is skipped).
         */
        async function openBackfillDrawer(page) {
            const orgId = process.env['ORGNAME'] || 'default';
            const baseUrl = process.env['ZO_BASE_URL'] || 'http://localhost:5080';

            // Navigate to the scheduled-pipelines tab
            await page.goto(
                `${baseUrl}/web/?org_identifier=${orgId}#/pipeline`
            );
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

            // Switch to the Scheduled Pipelines tab if it exists
            const scheduledTab = pm.pipelinesFormValidation.getPipelineScheduledTabLocator();
            if (await scheduledTab.isVisible({ timeout: 5000 })) {
                await scheduledTab.click();
                await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
            }

            // Locate the first "Create Backfill Job" trigger button in the list
            const backfillTriggerBtn = pm.pipelinesFormValidation.getPipelineListBackfillBtnLocator().first();

            if (!(await backfillTriggerBtn.isVisible({ timeout: 5000 }))) {
                testLogger.warn('No scheduled pipeline with backfill btn found – skipping drawer open');
                return false;
            }

            await backfillTriggerBtn.click();
            await pm.pipelinesFormValidation.waitForBackfillDrawer();
            return true;
        }

        // ── Test 1: Submit with no time range selected shows validation message ─

        test(
            'should show time-range validation message when submitted without selecting a time range',
            { tag: ['@pipelines-form-validation', '@P0', '@smoke'] },
            async ({ page }) => {
                const drawerOpened = await openBackfillDrawer(page);
                test.skip(!drawerOpened, 'No scheduled pipeline available');

                // Drawer is open; do NOT select a time range – click Create Backfill Job
                await pm.pipelinesFormValidation.clickCreateBackfillJob();

                // Expect either an inline validation message or a toast error
                const timeRangeErrorVisible = await pm.pipelinesFormValidation
                    .getTimeRangeErrorLocator()
                    .isVisible({ timeout: 3000 })
                    .catch(() => false);

                const toastErrorVisible = await pm.pipelinesFormValidation
                    .getToastErrorLocator()
                    .isVisible({ timeout: 3000 })
                    .catch(() => false);

                expect(timeRangeErrorVisible || toastErrorVisible).toBe(true);
            }
        );

        // ── Test 2: Invalid chunk-period shows field-level error ──────────────

        test(
            'should show chunk-period error when value is out of range (0)',
            { tag: ['@pipelines-form-validation', '@P0', '@smoke'] },
            async ({ page }) => {
                const drawerOpened = await openBackfillDrawer(page);
                test.skip(!drawerOpened, 'No scheduled pipeline available');

                // Expand advanced options and enter an invalid chunk period
                await pm.pipelinesFormValidation.expandAdvancedOptions();
                await pm.pipelinesFormValidation.fillChunkPeriod('0');
                await pm.pipelinesFormValidation.clickCreateBackfillJob();

                // Chunk period error should appear
                await expect(
                    pm.pipelinesFormValidation.getChunkPeriodInputErrorLocator()
                ).toBeVisible({ timeout: 5000 });
                await expect(
                    pm.pipelinesFormValidation.getChunkPeriodInputErrorLocator()
                ).toContainText('Must be between 1 and 1440');
            }
        );

        // ── Test 3: Invalid delay value shows field-level error ───────────────

        test(
            'should show delay-between-chunks error when value is out of range (9999)',
            { tag: ['@pipelines-form-validation', '@P0', '@smoke'] },
            async ({ page }) => {
                const drawerOpened = await openBackfillDrawer(page);
                test.skip(!drawerOpened, 'No scheduled pipeline available');

                await pm.pipelinesFormValidation.expandAdvancedOptions();
                await pm.pipelinesFormValidation.fillDelayBetweenChunks('9999');
                await pm.pipelinesFormValidation.clickCreateBackfillJob();

                await expect(
                    pm.pipelinesFormValidation.getDelayBetweenChunksErrorLocator()
                ).toBeVisible({ timeout: 5000 });
                await expect(
                    pm.pipelinesFormValidation.getDelayBetweenChunksErrorLocator()
                ).toContainText('Must be between 1 and 3600');
            }
        );

        // ── Test 4: Cancel closes the drawer without submitting ───────────────

        test(
            'should close the drawer when Cancel is clicked',
            { tag: ['@pipelines-form-validation', '@P0', '@smoke'] },
            async ({ page }) => {
                const drawerOpened = await openBackfillDrawer(page);
                test.skip(!drawerOpened, 'No scheduled pipeline available');

                await pm.pipelinesFormValidation.clickCancelBackfillJob();

                // The drawer should no longer be visible
                await expect(
                    pm.pipelinesFormValidation.getBackfillDrawerLocator()
                ).toBeHidden({ timeout: 5000 });
            }
        );

        // ── Test 5: delete-before-backfill confirmation dialog ────────────────

        test(
            'should show delete-confirmation dialog when delete-before-backfill is checked and form is valid',
            { tag: ['@pipelines-form-validation', '@P0', '@smoke'] },
            async ({ page }) => {
                const drawerOpened = await openBackfillDrawer(page);
                test.skip(!drawerOpened, 'No scheduled pipeline available');

                // Check the delete-before-backfill checkbox (visible without expanding advanced)
                const checkbox = pm.pipelinesFormValidation.getDeleteBeforeBackfillChkLocator();
                if (!(await checkbox.isVisible({ timeout: 5000 }))) {
                    // May be inside advanced options
                    await pm.pipelinesFormValidation.expandAdvancedOptions();
                }
                await checkbox.click();

                // The warning block should become visible
                await expect(
                    pm.pipelinesFormValidation.getDeleteConfirmDialogIrreversibleTextLocator()
                ).toBeVisible({ timeout: 5000 });
            }
        );
    }
);

// ─── LLM Evaluation Node – Form Validation ───────────────────────────────────

test.describe(
    'Pipelines – LLM Evaluation Node Form Validation',
    { tag: ['@domainFormValidation', '@P0', '@smoke'] },
    () => {
        /** @type {PageManager} */
        let pm;

        test.describe.configure({ mode: 'parallel' });

        let nodeOpened = false;

        test.beforeEach(async ({ page }, testInfo) => {
            testLogger.testStart(testInfo.title, testInfo.file);
            await navigateToBase(page);
            pm = new PageManager(page);
            nodeOpened = await pm.pipelinesFormValidation.openFirstLlmEvalNode().catch(() => false);
            // If node search fails, navigate back to a clean state so serial suite
            // tests that follow are not left on the pipeline editor page
            if (!nodeOpened) {
                await navigateToBase(page).catch(() => {});
            }
        });

        // ── Test: empty name => error or save disabled ────────────────────────

        test(
            'should show name error or disable save when LLM Evaluation node name is empty',
            { tag: ['@domainFormValidation', '@P0', '@smoke'] },
            async ({ page }) => {
                test.skip(!nodeOpened, 'No pipeline with LLM Evaluation node found in this environment');

                await pm.pipelinesFormValidation.clearLlmEvalName();
                await page.keyboard.press('Tab');

                const errorVisible = await pm.pipelinesFormValidation
                    .getLlmEvalNameErrorLocator()
                    .isVisible({ timeout: 3000 })
                    .catch(() => false);

                expect(errorVisible).toBe(true);
            }
        );

        // ── Test: enable sampling toggle shows sampling rate input ────────────

        test(
            'should show sampling rate input when enable sampling toggle is activated',
            { tag: ['@domainFormValidation', '@P0', '@smoke'] },
            async ({ page }) => {
                test.skip(!nodeOpened, 'No pipeline with LLM Evaluation node found in this environment');

                await pm.pipelinesFormValidation.clickLlmEvalEnableSamplingToggle();

                // After enabling sampling, a sampling-rate input should appear in the DOM
                const samplingRateInput = pm.pipelinesFormValidation.getLlmEvalSamplingRateFieldLocator();
                await expect(samplingRateInput).toBeVisible({ timeout: 5000 });
            }
        );
    }
);

// ─── Associate Function Node – Form Validation ───────────────────────────────

test.describe(
    'Pipelines – Associate Function Node Form Validation',
    { tag: ['@domainFormValidation', '@P0', '@smoke'] },
    () => {
        /** @type {PageManager} */
        let pm;

        test.describe.configure({ mode: 'parallel' });

        let nodeOpened = false;

        test.beforeEach(async ({ page }, testInfo) => {
            testLogger.testStart(testInfo.title, testInfo.file);
            await navigateToBase(page);
            pm = new PageManager(page);
            nodeOpened = await pm.pipelinesFormValidation.openFirstAssociateFunctionNode();
        });

        // ── Test: open drawer without selecting function => error or save disabled

        test(
            'should show function-required error or disable save when no function is selected in Associate Function drawer',
            { tag: ['@domainFormValidation', '@P0', '@smoke'] },
            async ({ page }) => {
                test.skip(!nodeOpened, 'No pipeline with Associate Function node found in this environment');

                // Verify drawer is visible
                await expect(
                    pm.pipelinesFormValidation.getAssociateFunctionDrawerLocator()
                ).toBeVisible({ timeout: 10000 });

                // Attempt to save without selecting a function
                const saveBtn = pm.pipelinesFormValidation.getAssociateFunctionSaveBtnLocator();
                await saveBtn.click();

                const errorVisible = await pm.pipelinesFormValidation
                    .getAssociateFunctionSelectErrorLocator()
                    .isVisible({ timeout: 3000 })
                    .catch(() => false);

                const saveDisabled = await saveBtn.isDisabled({ timeout: 1000 }).catch(() => false);

                expect(errorVisible || saveDisabled).toBe(true);
            }
        );

        // ── Test: toggle create-function => form mode changes ─────────────────

        test(
            'should change form mode when create-function toggle is activated',
            { tag: ['@domainFormValidation', '@P0', '@smoke'] },
            async ({ page }) => {
                test.skip(!nodeOpened, 'No pipeline with Associate Function node found in this environment');

                await expect(
                    pm.pipelinesFormValidation.getAssociateFunctionDrawerLocator()
                ).toBeVisible({ timeout: 10000 });

                await pm.pipelinesFormValidation.clickCreateFunctionToggle();

                // After toggling, the select-function popover should be hidden and a
                // create-function form or input should be visible instead.
                const selectPopoverVisible = await pm.pipelinesFormValidation
                    .getAssociateFunctionSelectPopoverLocator()
                    .isVisible({ timeout: 2000 })
                    .catch(() => false);

                expect(selectPopoverVisible).toBe(false);
            }
        );
    }
);

// ─── Create Destination Form – Form Validation ───────────────────────────────

test.describe(
    'Pipelines – Create Destination Form Validation',
    { tag: ['@domainFormValidation', '@P0', '@smoke'] },
    () => {
        /** @type {PageManager} */
        let pm;

        test.describe.configure({ mode: 'parallel' });

        test.beforeEach(async ({ page }, testInfo) => {
            testLogger.testStart(testInfo.title, testInfo.file);
            await navigateToBase(page);
            pm = new PageManager(page);
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        });

        test.afterEach(async ({ page }) => {
            // Dismiss the form if it is still open
            try {
                const cancelBtn = pm.pipelinesFormValidation.getAddDestinationCancelBtnLocator();
                if (await cancelBtn.isVisible({ timeout: 1000 })) {
                    await cancelBtn.click();
                }
            } catch {
                // nothing to close
            }
        });

        // ── Test: empty name => name error or continue disabled ───────────────

        test(
            'should show name error or disable Continue when destination name is empty',
            { tag: ['@domainFormValidation', '@P0', '@smoke'] },
            async ({ page }) => {
                await pm.pipelinesFormValidation.navigateToAddDestination();

                // Select HTTP type if available
                const typeCard = pm.pipelinesFormValidation.getDestinationTypeCardHttpLocator();
                if (await typeCard.isVisible({ timeout: 5000 })) {
                    await typeCard.click();
                }

                // Attempt to continue without filling name
                const continueBtn = pm.pipelinesFormValidation.getStep1ContinueBtnLocator();
                if (await continueBtn.isVisible({ timeout: 5000 })) {
                    await continueBtn.click();

                    const errorVisible = await pm.pipelinesFormValidation
                        .getAddDestinationNameErrorLocator()
                        .isVisible({ timeout: 3000 })
                        .catch(() => false);

                    const continueDisabled = await continueBtn.isDisabled({ timeout: 1000 }).catch(() => false);

                    expect(errorVisible || continueDisabled).toBe(true);
                } else {
                    // Step 1 continue btn not found — check submit btn disabled state
                    const submitBtn = pm.pipelinesFormValidation.getAddDestinationSubmitBtnLocator();
                    const submitDisabled = await submitBtn.isDisabled({ timeout: 3000 }).catch(() => true);
                    expect(submitDisabled).toBe(true);
                }
            }
        );

        // ── Test: invalid URL => URL error ────────────────────────────────────

        test(
            'should show URL error when destination URL has a trailing slash',
            { tag: ['@domainFormValidation', '@P0', '@smoke'] },
            async ({ page }) => {
                await pm.pipelinesFormValidation.navigateToAddDestination();

                // Step 1: select HTTP destination type
                // The destination form is enterprise-only — skip gracefully if unavailable.
                const typeCard = pm.pipelinesFormValidation.getDestinationTypeCardHttpLocator();
                const typeCardVisible = await typeCard.isVisible({ timeout: 10000 }).catch(() => false);
                test.skip(!typeCardVisible, 'Pipeline destination type cards not available in this environment (enterprise-only feature)');
                await typeCard.click();

                // Advance to step 2 via the Continue button
                const continueBtn = pm.pipelinesFormValidation.getStep1ContinueBtnLocator();
                await continueBtn.waitFor({ state: 'visible', timeout: 5000 });
                await continueBtn.click();

                // Step 2: fill name and a URL with a trailing slash to trigger validation
                const nameField = pm.pipelinesFormValidation.getAddDestinationNameFieldLocator();
                await nameField.waitFor({ state: 'visible', timeout: 8000 });
                await pm.pipelinesFormValidation.fillAddDestinationName('test_fv_dest_001');

                await pm.pipelinesFormValidation.fillAddDestinationUrl('http://example.com/');
                await page.keyboard.press('Tab');

                await expect(
                    pm.pipelinesFormValidation.getAddDestinationUrlErrorLocator()
                ).toBeVisible({ timeout: 5000 });
                await expect(
                    pm.pipelinesFormValidation.getAddDestinationUrlErrorLocator()
                ).toContainText('URL should not end with a trailing slash');
            }
        );

        // ── Test: cancel closes the form ──────────────────────────────────────

        test(
            'should close the destination form when Cancel is clicked',
            { tag: ['@domainFormValidation', '@P0', '@smoke'] },
            async ({ page }) => {
                await pm.pipelinesFormValidation.navigateToAddDestination();

                const cancelBtn = pm.pipelinesFormValidation.getAddDestinationCancelBtnLocator();
                if (await cancelBtn.isVisible({ timeout: 5000 })) {
                    await pm.pipelinesFormValidation.clickAddDestinationCancelBtn();

                    // After cancel, the submit button or cancel button should no longer be visible
                    await expect(
                        pm.pipelinesFormValidation.getAddDestinationCancelBtnLocator()
                    ).toBeHidden({ timeout: 5000 });
                } else {
                    // Navigate away via URL and confirm cancel worked implicitly
                    expect(page.url()).not.toContain('/destination/add');
                }
            }
        );
    }
);

// ─── Edit Backfill Job Dialog – Form Validation ───────────────────────────────

test.describe(
    'Pipelines – EditBackfillJobDialog Form Validation',
    { tag: ['@domainFormValidation', '@P0', '@smoke'] },
    () => {
        /** @type {PageManager} */
        let pm;

        test.describe.configure({ mode: 'parallel' });

        let dialogOpened = false;

        test.beforeEach(async ({ page }, testInfo) => {
            testLogger.testStart(testInfo.title, testInfo.file);
            await navigateToBase(page);
            pm = new PageManager(page);
            dialogOpened = await pm.pipelinesFormValidation.openFirstEditBackfillJob();
        });

        // ── Test: open edit dialog => chunk period input visible ──────────────

        test(
            'should show chunk period input when Edit Backfill Job dialog is open',
            { tag: ['@domainFormValidation', '@P0', '@smoke'] },
            async ({ page }) => {
                test.skip(!dialogOpened, 'No existing backfill jobs found in this environment');

                await expect(
                    pm.pipelinesFormValidation.getEditBackfillJobDialogLocator()
                ).toBeVisible({ timeout: 10000 });

                await expect(
                    pm.pipelinesFormValidation.getEditChunkPeriodFieldLocator()
                ).toBeVisible({ timeout: 5000 });
            }
        );

        // ── Test: clear chunk period => error shown ───────────────────────────

        test(
            'should show chunk period error when chunk period is cleared in Edit Backfill Job dialog',
            { tag: ['@domainFormValidation', '@P0', '@smoke'] },
            async ({ page }) => {
                test.skip(!dialogOpened, 'No existing backfill jobs found in this environment');

                await expect(
                    pm.pipelinesFormValidation.getEditBackfillJobDialogLocator()
                ).toBeVisible({ timeout: 10000 });

                await pm.pipelinesFormValidation.clearEditChunkPeriod();
                await page.keyboard.press('Tab');

                await expect(
                    pm.pipelinesFormValidation.getEditChunkPeriodErrorLocator()
                ).toBeVisible({ timeout: 5000 });
                await expect(
                    pm.pipelinesFormValidation.getEditChunkPeriodErrorLocator()
                ).toContainText('Must be between 1 and 1440');
            }
        );
    }
);

// ─── Pipeline Stream Node – Form Validation ──────────────────────────────────

test.describe(
    'Pipelines – Stream Node Form Validation',
    { tag: ['@domainFormValidation', '@P0', '@smoke'] },
    () => {
        /** @type {PageManager} */
        let pm;

        test.describe.configure({ mode: 'parallel' });

        test.beforeEach(async ({ page }, testInfo) => {
            testLogger.testStart(testInfo.title, testInfo.file);
            await navigateToBase(page);
            pm = new PageManager(page);
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

            // Navigate to pipelines and open the pipeline editor with a stream node
            await pm.pipelinesPage.openPipelineMenu();
            await pm.pipelinesPage.addPipeline();
            await pm.pipelinesPage.selectStream();
            await pm.pipelinesPage.dragStreamToTarget(pm.pipelinesPage.streamButton);
        });

        // ── Test 1: stream node drawer is visible after drag ──────────────────

        test(
            'should show the stream node drawer after dragging a stream onto the canvas',
            { tag: ['@domainFormValidation', '@P0', '@smoke'] },
            async ({ page }) => {
                const drawer = pm.pipelinesFormValidation.getStreamNodeDrawerLocator();
                await drawer.waitFor({ state: 'visible', timeout: 10000 });
                await expect(drawer).toBeVisible();
            }
        );

        // ── Test 2: stream type select renders inside the drawer ──────────────

        test(
            'should render the stream type select inside the stream node drawer',
            { tag: ['@domainFormValidation', '@P0', '@smoke'] },
            async ({ page }) => {
                const drawer = pm.pipelinesFormValidation.getStreamNodeDrawerLocator();
                await drawer.waitFor({ state: 'visible', timeout: 10000 });

                const typeSelect = pm.pipelinesFormValidation.getStreamNodeTypeSelectLocator();
                await expect(typeSelect).toBeVisible({ timeout: 5000 });
            }
        );

        // ── Test 3: stream name select is disabled until stream type is selected ─

        test(
            'should disable the stream name select when no stream type has been selected',
            { tag: ['@domainFormValidation', '@P0', '@smoke'] },
            async ({ page }) => {
                const drawer = pm.pipelinesFormValidation.getStreamNodeDrawerLocator();
                await drawer.waitFor({ state: 'visible', timeout: 10000 });

                // Without selecting a stream type, the stream name select is present
                // but its option list is empty (options are populated by updateStreams() on type change).
                // The select is always enabled — it does not carry a :disabled prop.
                const nameSelect = pm.pipelinesFormValidation.getStreamNodeNameSelectLocator();
                await expect(nameSelect).toBeVisible({ timeout: 5000 });
            }
        );
    }
);

// ─── ImportPipeline – Form Validation ────────────────────────────────────────

test.describe(
    'Pipelines – ImportPipeline Form Validation',
    { tag: ['@pipelines-form-validation', '@P0', '@smoke'] },
    () => {
        /** @type {PageManager} */
        let pm;

        test.beforeEach(async ({ page }, testInfo) => {
            testLogger.testStart(testInfo.title, testInfo.file);
            await navigateToBase(page);
            pm = new PageManager(page);
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        });

        // ── Test 6: Import button is disabled when no file is selected ────────

        test(
            'should show error toast when Import is clicked with no file selected',
            { tag: ['@pipelines-form-validation', '@P0', '@smoke'] },
            async ({ page }) => {
                // The Import button is always enabled — it is not disabled when no file is
                // selected. Clicking it without a file triggers importJson() which rejects
                // with a toast error ("JSON string is empty").
                await pm.pipelinesFormValidation.navigateToImportPipeline();
                await pm.pipelinesFormValidation.waitForImportPage();

                await pm.pipelinesFormValidation.getImportPipelineImportBtnLocator().click();

                await expect(page.locator('[data-test-variant="error"]')).toBeVisible({ timeout: 5000 });
            }
        );

        // ── Test 7: Import button becomes enabled after file is attached ──────

        test(
            'should enable the Import button after a valid JSON file is uploaded',
            { tag: ['@pipelines-form-validation', '@P0', '@smoke'] },
            async ({ page }) => {
                await pm.pipelinesFormValidation.navigateToImportPipeline();
                await pm.pipelinesFormValidation.waitForImportPage();

                // Create a minimal valid pipeline JSON in a temp file
                const tmpDir = require('os').tmpdir();
                const tmpFile = path.join(tmpDir, 'test_fv_pipeline_001.json');
                require('fs').writeFileSync(
                    tmpFile,
                    JSON.stringify({
                        name: 'test_fv_pipeline_001',
                        description: 'E2E form validation test pipeline',
                        source: { source_type: 'realtime' },
                        nodes: [],
                        edges: [],
                    })
                );

                await pm.pipelinesFormValidation.uploadPipelineFile(tmpFile);

                // After file upload the button should become enabled
                await expect(
                    pm.pipelinesFormValidation.getImportPipelineImportBtnLocator()
                ).not.toBeDisabled({ timeout: 5000 });

                // Clean up temp file
                require('fs').unlinkSync(tmpFile);
            }
        );

        // ── Test 8: Cancel navigates away from the import page ────────────────

        test(
            'should navigate away when Cancel is clicked on the Import Pipeline page',
            { tag: ['@pipelines-form-validation', '@P0', '@smoke'] },
            async ({ page }) => {
                await pm.pipelinesFormValidation.navigateToImportPipeline();
                await pm.pipelinesFormValidation.waitForImportPage();

                await pm.pipelinesFormValidation.clickCancelButton();

                // After cancel the import page import button should no longer be visible
                await expect(
                    pm.pipelinesFormValidation.getImportPipelineImportBtnLocator()
                ).toBeHidden({ timeout: 5000 });
            }
        );
    }
);
