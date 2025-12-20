/**
 * Dashboard Joins Page Object
 *
 * Provides helper methods for interacting with the Dashboard Joins feature
 * in the panel builder. Supports INNER, LEFT, and RIGHT joins with
 * configurable join conditions.
 */

const testLogger = require("../../playwright-tests/utils/test-logger.js");

/**
 * Helper class for join operations in dashboard panel builder
 */
export class JoinHelper {
  constructor(page) {
    this.page = page;
  }

  /**
   * Click the add join button to add a new join, then click the join item to open popup
   * @param {number} expectedIndex - The expected index of the new join (0-based)
   */
  async clickAddJoin(expectedIndex = 0) {
    const addJoinBtn = this.page.locator('[data-test="dashboard-add-join-btn"]');
    await addJoinBtn.waitFor({ state: "visible", timeout: 10000 });
    await addJoinBtn.click();

    // Wait for the new join item to appear in the list
    await this.page.waitForTimeout(1000);

    // Click on the new join item to open the configuration popup
    const newJoinItem = this.page.locator(`[data-test="dashboard-join-item-${expectedIndex}"]`);
    await newJoinItem.waitFor({ state: "visible", timeout: 10000 });
    await newJoinItem.click();

    // Wait for the popup to appear
    await this.page.locator('[data-test="dashboard-join-pop-up"]').waitFor({
      state: "visible",
      timeout: 10000,
    });
  }

  /**
   * Select the join type
   * @param {string} type - 'inner', 'left', or 'right'
   */
  async selectJoinType(type) {
    const joinTypeSelector = this.page.locator(
      `[data-test="dashboard-join-type-${type}"]`
    );
    await joinTypeSelector.waitFor({ state: "visible", timeout: 5000 });
    await joinTypeSelector.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Select the stream to join with (the "On Stream")
   * @param {string} streamName - Name of the stream to join
   */
  async selectJoinStream(streamName) {
    const streamDropdown = this.page.locator(
      '[data-test="dashboard-config-panel-join-to"]'
    );
    await streamDropdown.waitFor({ state: "visible", timeout: 10000 });

    // Click to open the dropdown and focus the input
    await streamDropdown.click();
    await this.page.waitForTimeout(500);

    // Type in the search field
    await this.page.keyboard.type(streamName);
    await this.page.waitForTimeout(1000);

    // Select the option from dropdown
    const option = this.page.getByRole("option", { name: streamName, exact: true });
    await option.waitFor({ state: "visible", timeout: 10000 });
    await option.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Configure a join condition
   * @param {number} conditionIndex - Index of the condition (0-based)
   * @param {string} leftField - Field name from the left stream
   * @param {string} operation - Join operation (=, !=, >, <, >=, <=)
   * @param {string} rightField - Field name from the right stream
   */
  async configureJoinCondition(conditionIndex, leftField, operation, rightField) {
    // Configure left field using StreamFieldSelect
    const leftFieldWrapper = this.page.locator(
      `[data-test="dashboard-join-condition-left-field-${conditionIndex}"]`
    );
    await leftFieldWrapper.waitFor({ state: "visible", timeout: 10000 });

    // Click on the select inside the wrapper
    const leftSelect = leftFieldWrapper.locator('[data-test="stream-field-select"]');
    await leftSelect.click();
    await this.page.waitForTimeout(500);

    // Type to filter and select the field
    await this.page.keyboard.type(leftField);
    await this.page.waitForTimeout(1000);

    // Click the option using the specific data-test attribute
    const leftFieldOption = this.page.locator(
      `[data-test="stream-field-select-option-${leftField}"]`
    );
    await leftFieldOption.waitFor({ state: "visible", timeout: 10000 });
    await leftFieldOption.click();
    await this.page.waitForTimeout(500);

    // Configure operation if not default
    if (operation !== "=") {
      const operationSelector = this.page.locator(
        `[data-test="dashboard-join-condition-operation-${conditionIndex}"]`
      );
      await operationSelector.click();
      await this.page.waitForTimeout(300);
      const operationOption = this.page.getByRole("option", {
        name: operation,
        exact: true,
      });
      await operationOption.click();
      await this.page.waitForTimeout(300);
    }

    // Configure right field using StreamFieldSelect
    const rightFieldWrapper = this.page.locator(
      `[data-test="dashboard-join-condition-right-field-${conditionIndex}"]`
    );
    const rightSelect = rightFieldWrapper.locator('[data-test="stream-field-select"]');
    await rightSelect.click();
    await this.page.waitForTimeout(500);

    // Type to filter and select the field
    await this.page.keyboard.type(rightField);
    await this.page.waitForTimeout(1000);

    // Click the option using the specific data-test attribute
    const rightFieldOption = this.page.locator(
      `[data-test="stream-field-select-option-${rightField}"]`
    );
    await rightFieldOption.waitFor({ state: "visible", timeout: 10000 });
    await rightFieldOption.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Add another join condition (clause)
   * @param {number} currentConditionIndex - Index of the current condition
   */
  async addAnotherCondition(currentConditionIndex) {
    const addConditionBtn = this.page.locator(
      `[data-test="dashboard-join-condition-add-${currentConditionIndex}"]`
    );
    await addConditionBtn.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Remove a join condition
   * @param {number} conditionIndex - Index of the condition to remove
   */
  async removeCondition(conditionIndex) {
    const removeConditionBtn = this.page.locator(
      `[data-test="dashboard-join-condition-remove-${conditionIndex}"]`
    );
    await removeConditionBtn.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Close the join popup by pressing Escape
   */
  async closeJoinPopup() {
    await this.page.keyboard.press("Escape");
    await this.page.waitForTimeout(500);
  }

  /**
   * Remove a join from the joins list
   * @param {number} joinIndex - Index of the join to remove
   */
  async removeJoin(joinIndex) {
    const removeBtn = this.page.locator(
      `[data-test="dashboard-join-item-${joinIndex}-remove"]`
    );
    await removeBtn.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Configure a complete join in one method
   * @param {string} joinType - 'inner', 'left', or 'right'
   * @param {string} streamName - Name of the stream to join
   * @param {Array} conditions - Array of condition objects: [{leftField, operation, rightField}]
   * @param {number} joinIndex - The index of this join (0 for first, 1 for second, etc.)
   */
  async configureJoin(joinType, streamName, conditions, joinIndex = 0) {
    await this.clickAddJoin(joinIndex);
    await this.selectJoinType(joinType);
    await this.selectJoinStream(streamName);

    // Configure first condition
    if (conditions.length > 0) {
      await this.configureJoinCondition(
        0,
        conditions[0].leftField,
        conditions[0].operation || "=",
        conditions[0].rightField
      );
    }

    // Add and configure additional conditions
    for (let i = 1; i < conditions.length; i++) {
      await this.addAnotherCondition(i - 1);
      await this.configureJoinCondition(
        i,
        conditions[i].leftField,
        conditions[i].operation || "=",
        conditions[i].rightField
      );
    }

    await this.closeJoinPopup();
  }

  /**
   * Verify that a join chip is visible with the expected stream name
   * @param {string} streamName - Expected stream name in the chip
   * @param {number} joinIndex - Index of the join chip (0-based)
   * @param {Function} expect - Playwright expect function
   */
  async verifyJoinChipVisible(streamName, joinIndex = 0, expect) {
    const joinChip = this.page.locator(`[data-test="dashboard-join-item-${joinIndex}"]`);
    await expect(joinChip).toBeVisible({ timeout: 5000 });
    await expect(joinChip).toContainText(streamName);
  }

  /**
   * Open an existing join item's configuration popup
   * @param {number} joinIndex - Index of the join to open (0-based)
   */
  async openJoinItemPopup(joinIndex) {
    const joinItem = this.page.locator(`[data-test="dashboard-join-item-${joinIndex}"]`);
    await joinItem.click();
    await this.page.locator('[data-test="dashboard-join-pop-up"]').waitFor({
      state: "visible",
      timeout: 10000,
    });
  }

  /**
   * Verify that the condition remove button is disabled (when only one condition exists)
   * @param {number} conditionIndex - Index of the condition
   * @param {Function} expect - Playwright expect function
   */
  async verifyConditionRemoveButtonDisabled(conditionIndex, expect) {
    const removeBtn = this.page.locator(`[data-test="dashboard-join-condition-remove-${conditionIndex}"]`);
    await expect(removeBtn).toBeDisabled();
  }

  /**
   * Verify that the condition remove button is enabled
   * @param {number} conditionIndex - Index of the condition
   * @param {Function} expect - Playwright expect function
   */
  async verifyConditionRemoveButtonEnabled(conditionIndex, expect) {
    const removeBtn = this.page.locator(`[data-test="dashboard-join-condition-remove-${conditionIndex}"]`);
    await expect(removeBtn).not.toBeDisabled();
  }

  /**
   * Verify that a join chip is not visible (after removal)
   * @param {number} joinIndex - Index of the join chip (0-based)
   * @param {Function} expect - Playwright expect function
   */
  async verifyJoinChipNotVisible(joinIndex, expect) {
    const joinChip = this.page.locator(`[data-test="dashboard-join-item-${joinIndex}"]`);
    await expect(joinChip).not.toBeVisible({ timeout: 5000 });
  }

  /**
   * Check if a join chip is visible
   * @param {number} joinIndex - Index of the join to check
   * @returns {Promise<boolean>} True if visible
   */
  async isJoinChipVisible(joinIndex) {
    const joinChip = this.page.locator(`[data-test="dashboard-join-item-${joinIndex}"]`);
    return await joinChip.isVisible();
  }

  /**
   * Click the add join button only (without opening popup)
   * Used for incomplete join scenarios
   */
  async clickAddJoinButton() {
    const addJoinBtn = this.page.locator('[data-test="dashboard-add-join-btn"]');
    await addJoinBtn.waitFor({ state: "visible", timeout: 10000 });
    await addJoinBtn.click();
    await this.page.waitForTimeout(1000);
  }

  /**
   * Wait for join item to appear
   * @param {number} joinIndex - Index of the join item to wait for
   */
  async waitForJoinItem(joinIndex) {
    const joinItem = this.page.locator(`[data-test="dashboard-join-item-${joinIndex}"]`);
    await joinItem.waitFor({ state: "visible", timeout: 10000 });
  }
}

/**
 * Get the count of data rows in the dashboard panel table
 * Excludes empty header/footer rows within tbody
 * @param {Page} page - Playwright page object
 * @returns {Promise<number>} Number of data rows
 */
export async function getTableRowCount(page) {
  // Wait for table data to load
  await page.waitForTimeout(3000);

  // Count rows - exclude empty rows (header/footer rows within tbody)
  const rows = page.locator('[data-test="dashboard-panel-table"] tbody tr');
  const totalRows = await rows.count();

  // Filter out empty rows by checking if they have actual content
  let dataRowCount = 0;
  for (let i = 0; i < totalRows; i++) {
    const firstCell = rows.nth(i).locator('td').first();
    const cellText = await firstCell.textContent().catch((err) => {
      testLogger.debug(`Could not get cell text: ${err.message}`);
      return '';
    });
    if (cellText && cellText.trim() !== '') {
      dataRowCount++;
    }
  }

  return dataRowCount;
}

/**
 * Standalone function to verify join chip is visible
 * For use when JoinHelper instance is not available
 * @param {Page} page - Playwright page object
 * @param {string} streamName - Expected stream name in the chip
 * @param {number} joinIndex - Index of the join chip (0-based)
 * @param {Function} expect - Playwright expect function
 */
export async function verifyJoinChipVisible(page, streamName, joinIndex, expect) {
  const joinChip = page.locator(`[data-test="dashboard-join-item-${joinIndex}"]`);
  await expect(joinChip).toBeVisible({ timeout: 5000 });
  await expect(joinChip).toContainText(streamName);
}
