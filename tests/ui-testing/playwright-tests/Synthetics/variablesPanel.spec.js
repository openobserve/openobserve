const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe('Synthetics Variables Panel testcases', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // P0 — Critical Path: Add, Edit, Delete variable lifecycle
  // ═══════════════════════════════════════════════════════════════════════

  test('should add a variable from empty state', {
    tag: ['@synthetics-variables-panel', '@synthetics', '@all', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Navigating to Create Browser Check wizard');
    await pm.syntheticsPage.navigateToCreateBrowserCheck('P0_1_test');

    testLogger.info('Asserting empty state is visible');
    await pm.syntheticsPage.expectEmptyStateVisible();
    await pm.syntheticsPage.expectAddVariableBtnNotVisible();

    testLogger.info('Opening add form from empty state');
    await pm.syntheticsPage.openAddFormFromEmptyState();
    await pm.syntheticsPage.expectAddFormVisible();

    testLogger.info('Filling and submitting add form');
    await pm.syntheticsPage.fillAddForm('MY_VAR', 'hello');
    await pm.syntheticsPage.commitAddForm();

    testLogger.info('Asserting card appears with correct name');
    await pm.syntheticsPage.expectCardVisible(0);
    await pm.syntheticsPage.expectCardName(0, 'MY_VAR');
    await pm.syntheticsPage.expectCountBadge('1');
    await pm.syntheticsPage.expectAddVariableBtnVisible();
    testLogger.info('Test completed');
  });

  test('should edit an existing variable', {
    tag: ['@synthetics-variables-panel', '@synthetics', '@all', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Navigating and adding a variable to edit');
    await pm.syntheticsPage.navigateToCreateBrowserCheck('P0_2_test');
    await pm.syntheticsPage.addVariable('MY_VAR', 'hello');

    testLogger.info('Clicking edit button on card 0');
    await pm.syntheticsPage.editVariable(0, 'UPDATED_VAR', 'world');

    testLogger.info('Asserting card shows updated name');
    await pm.syntheticsPage.expectCardVisible(0);
    await pm.syntheticsPage.expectCardName(0, 'UPDATED_VAR');
    testLogger.info('Test completed');
  });

  test('should edit a variable and toggle secure flag', {
    tag: ['@synthetics-variables-panel', '@synthetics', '@all', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Navigating and adding a variable to edit');
    await pm.syntheticsPage.navigateToCreateBrowserCheck('P0_2b_test');
    await pm.syntheticsPage.addVariable('MY_VAR', 'hello');

    testLogger.info('Editing variable: toggling secure on');
    await pm.syntheticsPage.cardEditBtn(0).click();
    await pm.syntheticsPage.expectEditFormVisible(0);
    await pm.syntheticsPage.editSecureSwitch(0).click();
    await pm.syntheticsPage.editSaveBtn(0).click();

    testLogger.info('Asserting value is masked (secure display)');
    await pm.syntheticsPage.expectCardVisible(0);
    await pm.syntheticsPage.expectCardValueMasked(0);
    testLogger.info('Test completed');
  });

  test('should remove a variable with undo', {
    tag: ['@synthetics-variables-panel', '@synthetics', '@all', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Navigating and adding a variable to remove');
    await pm.syntheticsPage.navigateToCreateBrowserCheck('P0_3_test');
    await pm.syntheticsPage.addVariable('REMOVE_ME', 'value');
    await pm.syntheticsPage.expectCardVisible(0);
    await pm.syntheticsPage.expectCountBadge('1');

    testLogger.info('Removing the variable');
    await pm.syntheticsPage.removeVariable(0);

    testLogger.info('Asserting undo row appears and count decremented');
    await pm.syntheticsPage.expectUndoRowVisible();
    await pm.syntheticsPage.expectCountBadge('0');

    testLogger.info('Clicking Undo to restore');
    await pm.syntheticsPage.undoRemove();

    testLogger.info('Asserting variable card is restored');
    await pm.syntheticsPage.expectCardVisible(0);
    await pm.syntheticsPage.expectCardName(0, 'REMOVE_ME');
    await pm.syntheticsPage.expectCountBadge('1');
    await pm.syntheticsPage.expectUndoRowNotVisible();
    testLogger.info('Test completed');
  });

  test('should cancel delete and keep variable intact', {
    tag: ['@synthetics-variables-panel', '@synthetics', '@all', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Navigating and adding a variable');
    await pm.syntheticsPage.navigateToCreateBrowserCheck('P0_4_test');
    await pm.syntheticsPage.addVariable('KEEP_ME', 'value');
    await pm.syntheticsPage.expectCardVisible(0);
    await pm.syntheticsPage.expectCountBadge('1');

    testLogger.info('Initiating remove then cancelling');
    await pm.syntheticsPage.cancelRemove(0);

    testLogger.info('Asserting dialog closed and variable still present');
    await pm.syntheticsPage.expectRemoveDialogNotVisible();
    await pm.syntheticsPage.expectCardVisible(0);
    await pm.syntheticsPage.expectCountBadge('1');
    testLogger.info('Test completed');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // P1 — Important Variations
  // ═══════════════════════════════════════════════════════════════════════

  test('should add a variable with secure flag enabled and display masked value', {
    tag: ['@synthetics-variables-panel', '@synthetics', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Navigating to Create Browser Check wizard');
    await pm.syntheticsPage.navigateToCreateBrowserCheck('P1_1_test');

    testLogger.info('Adding a secure variable');
    await pm.syntheticsPage.addVariable('SECRET_KEY', 'abcdef123', true);

    testLogger.info('Asserting card shows masked value');
    await pm.syntheticsPage.expectCardVisible(0);
    await pm.syntheticsPage.expectCardValueMasked(0);
    testLogger.info('Test completed');
  });

  test('should show required error when name is submitted empty', {
    tag: ['@synthetics-variables-panel', '@synthetics', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Navigating to Create Browser Check wizard');
    await pm.syntheticsPage.navigateToCreateBrowserCheck('P1_2_test');

    testLogger.info('Opening add form');
    await pm.syntheticsPage.openAddFormFromEmptyState();
    await pm.syntheticsPage.expectAddFormVisible();

    testLogger.info('Entering value but leaving name empty, clicking Add');
    await pm.syntheticsPage.addValueInput.fill('somevalue');
    await pm.syntheticsPage.commitAddForm();

    testLogger.info('Asserting name error is shown');
    await pm.syntheticsPage.expectAddNameError('Name is required');

    testLogger.info('Asserting no variable was added');
    await pm.syntheticsPage.expectCountBadge('0');
    // Add form should still be open (validation prevented close)
    await pm.syntheticsPage.expectAddFormVisible();
    testLogger.info('Test completed');
  });

  test('should show pattern error for names starting with a digit', {
    tag: ['@synthetics-variables-panel', '@synthetics', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Navigating to Create Browser Check wizard');
    await pm.syntheticsPage.navigateToCreateBrowserCheck('P1_3a_test');

    testLogger.info('Opening add form');
    await pm.syntheticsPage.openAddFormFromEmptyState();

    testLogger.info('Entering invalid name (starts with digit)');
    await pm.syntheticsPage.fillAddForm('123abc', 'value');
    await pm.syntheticsPage.commitAddForm();

    testLogger.info('Asserting pattern error shown');
    await pm.syntheticsPage.expectAddNameError('Names start with a letter');

    testLogger.info('Asserting no variable added');
    await pm.syntheticsPage.expectCountBadge('0');
    testLogger.info('Test completed');
  });

  test('should show pattern error for names containing a hyphen', {
    tag: ['@synthetics-variables-panel', '@synthetics', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Navigating to Create Browser Check wizard');
    await pm.syntheticsPage.navigateToCreateBrowserCheck('P1_3b_test');

    testLogger.info('Opening add form');
    await pm.syntheticsPage.openAddFormFromEmptyState();

    testLogger.info('Entering invalid name (contains hyphen)');
    await pm.syntheticsPage.fillAddForm('my-var', 'value');
    await pm.syntheticsPage.commitAddForm();

    testLogger.info('Asserting pattern error shown');
    await pm.syntheticsPage.expectAddNameError('Names start with a letter');

    testLogger.info('Asserting no variable added');
    await pm.syntheticsPage.expectCountBadge('0');
    testLogger.info('Test completed');
  });

  test('should show duplicate name error when adding a variable with existing name', {
    tag: ['@synthetics-variables-panel', '@synthetics', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Navigating and adding first variable');
    await pm.syntheticsPage.navigateToCreateBrowserCheck('P1_4_test');
    await pm.syntheticsPage.addVariable('MY_VAR', 'value');
    await pm.syntheticsPage.expectCountBadge('1');

    testLogger.info('Opening add form and entering duplicate name');
    await pm.syntheticsPage.openAddForm();
    await pm.syntheticsPage.fillAddForm('MY_VAR', 'other');
    await pm.syntheticsPage.commitAddForm();

    testLogger.info('Asserting duplicate error shown');
    await pm.syntheticsPage.expectAddNameError('already exists');

    testLogger.info('Asserting count unchanged');
    await pm.syntheticsPage.expectCountBadge('1');
    testLogger.info('Test completed');
  });

  test('should cancel add form and discard draft', {
    tag: ['@synthetics-variables-panel', '@synthetics', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Navigating to Create Browser Check wizard');
    await pm.syntheticsPage.navigateToCreateBrowserCheck('P1_5_test');

    testLogger.info('Opening add form and entering draft');
    await pm.syntheticsPage.openAddFormFromEmptyState();
    await pm.syntheticsPage.fillAddForm('TEMP_VAR', 'temp');

    testLogger.info('Clicking Cancel');
    await pm.syntheticsPage.cancelAddForm();

    testLogger.info('Asserting add form dismissed, no variable created');
    await pm.syntheticsPage.expectAddFormNotVisible();
    await pm.syntheticsPage.expectCountBadge('0');
    await pm.syntheticsPage.expectEmptyStateVisible();
    testLogger.info('Test completed');
  });

  test('should cancel edit and keep variable unchanged', {
    tag: ['@synthetics-variables-panel', '@synthetics', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Navigating and adding a variable');
    await pm.syntheticsPage.navigateToCreateBrowserCheck('P1_6_test');
    await pm.syntheticsPage.addVariable('ORIGINAL', 'original');

    testLogger.info('Opening edit and changing fields');
    await pm.syntheticsPage.cardEditBtn(0).click();
    await pm.syntheticsPage.expectEditFormVisible(0);
    await pm.syntheticsPage.editNameInput(0).clear();
    await pm.syntheticsPage.editNameInput(0).fill('CHANGED');

    testLogger.info('Clicking Cancel');
    await pm.syntheticsPage.editCancelBtn(0).click();

    testLogger.info('Asserting card shows original name');
    await pm.syntheticsPage.expectCardVisible(0);
    await pm.syntheticsPage.expectCardName(0, 'ORIGINAL');
    testLogger.info('Test completed');
  });

  test('should toggle variables panel visibility on Journey step', {
    tag: ['@synthetics-variables-panel', '@synthetics', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Navigating to Create Browser Check wizard');
    await pm.syntheticsPage.navigateToCreateBrowserCheck('P1_7_test');

    testLogger.info('Asserting panel is initially visible');
    await pm.syntheticsPage.expectPanelVisible();
    await pm.syntheticsPage.expectToggleBtnVisible();

    testLogger.info('Clicking toggle to hide panel');
    await pm.syntheticsPage.toggleVariablesPanel();

    testLogger.info('Asserting panel is hidden');
    await pm.syntheticsPage.expectPanelHidden();

    testLogger.info('Clicking toggle to show panel');
    await pm.syntheticsPage.toggleVariablesPanel();

    testLogger.info('Asserting panel is visible again');
    await pm.syntheticsPage.expectPanelVisible();
    testLogger.info('Test completed');
  });

  test('should persist variables across Journey and Configure steps', {
    tag: ['@synthetics-variables-panel', '@synthetics', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Navigating and adding a variable on Journey step');
    await pm.syntheticsPage.navigateToCreateBrowserCheck('P1_8_test');
    await pm.syntheticsPage.addVariable('CROSS_VAR', 'journey_value');
    await pm.syntheticsPage.expectCardVisible(0);

    testLogger.info('Clicking Continue to Configure step');
    await pm.syntheticsPage.clickContinue();

    testLogger.info('Asserting variable visible on Configure step');
    await pm.syntheticsPage.expectPanelVisible();
    await pm.syntheticsPage.expectCardVisible(0);
    await pm.syntheticsPage.expectCardName(0, 'CROSS_VAR');

    testLogger.info('Editing variable on Configure step');
    await pm.syntheticsPage.editVariable(0, undefined, 'configured_value');

    testLogger.info('Going back to Journey step');
    await pm.syntheticsPage.clickBackToJourney();

    testLogger.info('Asserting variable has updated value from Configure step');
    await pm.syntheticsPage.expectCardVisible(0);
    await pm.syntheticsPage.expectCardName(0, 'CROSS_VAR');
    testLogger.info('Test completed');
  });

  test('should always show variables panel on Configure step regardless of Journey toggle', {
    tag: ['@synthetics-variables-panel', '@synthetics', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Navigating to Journey step and hiding panel');
    await pm.syntheticsPage.navigateToCreateBrowserCheck('P1_9_test');
    await pm.syntheticsPage.toggleVariablesPanel();
    await pm.syntheticsPage.expectPanelHidden();

    testLogger.info('Clicking Continue to Configure step');
    await pm.syntheticsPage.clickContinue();

    testLogger.info('Asserting panel IS visible on Configure step');
    await pm.syntheticsPage.expectPanelVisible();
    testLogger.info('Test completed');
  });

  test('should show reference syntax tooltip on info icon hover', {
    tag: ['@synthetics-variables-panel', '@synthetics', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Navigating to Create Browser Check wizard');
    await pm.syntheticsPage.navigateToCreateBrowserCheck('P1_10_test');

    testLogger.info('Hovering over hint icon');
    await pm.syntheticsPage.hoverHintIcon();
    // Wait for tooltip to appear
    await page.waitForTimeout(500);

    testLogger.info('Asserting tooltip contains syntax reference');
    await pm.syntheticsPage.expectHintTooltipVisible();
    testLogger.info('Test completed');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // P2 — Edge Cases and Nice-to-Have
  // ═══════════════════════════════════════════════════════════════════════

  test('should let undo timer expire and permanently delete variable', {
    tag: ['@synthetics-variables-panel', '@synthetics', '@all', '@P2'],
  }, async ({ page }) => {
    testLogger.info('Navigating and adding a variable');
    await pm.syntheticsPage.navigateToCreateBrowserCheck('P2_1_test');
    await pm.syntheticsPage.addVariable('WILL_DIE', 'value');
    await pm.syntheticsPage.expectCardVisible(0);

    testLogger.info('Removing the variable');
    await pm.syntheticsPage.removeVariable(0);
    await pm.syntheticsPage.expectUndoRowVisible();

    testLogger.info('Waiting for undo timer to expire (7 seconds)');
    await page.waitForTimeout(7500);

    testLogger.info('Asserting undo banner auto-dismissed and variable gone');
    await pm.syntheticsPage.expectUndoRowNotVisible();
    await pm.syntheticsPage.expectCardNotVisible(0);
    await pm.syntheticsPage.expectCountBadge('0');
    testLogger.info('Test completed');
  });

  test('should only undo the most recently deleted variable', {
    tag: ['@synthetics-variables-panel', '@synthetics', '@all', '@P2'],
  }, async ({ page }) => {
    testLogger.info('Navigating and adding two variables');
    await pm.syntheticsPage.navigateToCreateBrowserCheck('P2_2_test');
    await pm.syntheticsPage.addVariable('VAR_A', 'value_a');
    await pm.syntheticsPage.addVariable('VAR_B', 'value_b');
    await pm.syntheticsPage.expectCountBadge('2');

    testLogger.info('Deleting VAR_A (index 0)');
    await pm.syntheticsPage.removeVariable(0);
    await pm.syntheticsPage.expectUndoRowVisible();

    testLogger.info('Immediately deleting VAR_B (now index 0 after shift)');
    await pm.syntheticsPage.removeVariable(0);

    testLogger.info('Clicking Undo');
    await pm.syntheticsPage.undoRemove();

    testLogger.info('Asserting only VAR_B is restored, VAR_A permanently gone');
    await pm.syntheticsPage.expectCardVisible(0);
    await pm.syntheticsPage.expectCardName(0, 'VAR_B');
    await pm.syntheticsPage.expectCountBadge('1');

    // VAR_A should not be present as a card with that name
    await pm.syntheticsPage.expectNoCardWithName('VAR_A');
    testLogger.info('Test completed');
  });

  test('should show usage badge count of zero when not referenced', {
    tag: ['@synthetics-variables-panel', '@synthetics', '@all', '@P2'],
  }, async ({ page }) => {
    testLogger.info('Navigating and adding a variable');
    await pm.syntheticsPage.navigateToCreateBrowserCheck('P2_3_test');
    await pm.syntheticsPage.addVariable('UNUSED', 'value');

    testLogger.info('Asserting usage badge shows 0');
    await pm.syntheticsPage.expectCardVisible(0);
    await pm.syntheticsPage.expectUsageBadge(0, '0');
    testLogger.info('Test completed');
  });

  test('should update usage count when variable is referenced in a journey step', {
    tag: ['@synthetics-variables-panel', '@synthetics', '@all', '@P2'],
  }, async ({ page }) => {
    testLogger.info('Navigating and adding a variable named MY_VAR');
    await pm.syntheticsPage.navigateToCreateBrowserCheck('P2_4_test');
    await pm.syntheticsPage.addVariable('MY_VAR', 'hello');

    testLogger.info('Asserting initial usage is 0');
    await pm.syntheticsPage.expectUsageBadge(0, '0');

    testLogger.info('Adding a journey step and referencing the variable');
    await pm.syntheticsPage.clickAddStep();
    await pm.syntheticsPage.fillStepUrl('https://example.com/{{MY_VAR}}');
    // Allow usage computation to settle
    await page.waitForTimeout(500);

    testLogger.info('Asserting usage badge now shows 1');
    await pm.syntheticsPage.expectUsageBadge(0, '1');
    testLogger.info('Test completed');
  });

  test('should preserve draft when re-opening add form while already open', {
    tag: ['@synthetics-variables-panel', '@synthetics', '@all', '@P2'],
  }, async ({ page }) => {
    testLogger.info('Navigating and adding a variable (to show pinned button)');
    await pm.syntheticsPage.navigateToCreateBrowserCheck('P2_5_test');
    await pm.syntheticsPage.addVariable('FIRST', 'first');
    await pm.syntheticsPage.expectAddVariableBtnVisible();

    testLogger.info('Opening add form and entering a draft');
    await pm.syntheticsPage.openAddForm();
    await pm.syntheticsPage.fillAddForm('DRAFT', 'draft_value');

    testLogger.info('Clicking pinned Add Variable button while form is open');
    await pm.syntheticsPage.addVariableBtn.click();

    testLogger.info('Asserting form is still open and draft preserved');
    await pm.syntheticsPage.expectAddFormVisible();
    await pm.syntheticsPage.expectAddNameInputHasValue('DRAFT');
    testLogger.info('Test completed');
  });

  test('should truncate long variable names and show full name on hover', {
    tag: ['@synthetics-variables-panel', '@synthetics', '@all', '@P2'],
  }, async ({ page }) => {
    testLogger.info('Navigating and adding a variable with a very long name');
    const longName = 'VERY_LONG_VARIABLE_NAME_THAT_EXCEEDS_CARD_WIDTH';
    await pm.syntheticsPage.navigateToCreateBrowserCheck('P2_6_test');
    await pm.syntheticsPage.addVariable(longName, 'value');

    testLogger.info('Asserting card is visible');
    await pm.syntheticsPage.expectCardVisible(0);

    // The card should show the name — check it contains the start of the long name
    await pm.syntheticsPage.expectCardName(0, longName);

    testLogger.info('Hovering over the card name to trigger tooltip');
    await pm.syntheticsPage.card(0).hover();
    await page.waitForTimeout(500);

    // Assert the tooltip shows the full name
    await pm.syntheticsPage.expectCardNameTooltipVisible(longName);
    testLogger.info('Test completed');
  });
});
