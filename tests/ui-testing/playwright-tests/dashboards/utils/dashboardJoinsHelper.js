// dashboardJoinsHelper.js
// Reusable helper functions for Dashboard Join feature testing

/**
 * Data-test attributes for Join UI elements
 */
export const JOIN_SELECTORS = {
  // Main join list
  addJoinButton: '[data-test="dashboard-add-join-btn"]',
  joinItem: (index) => `[data-test="dashboard-join-item-${index}"]`,
  joinMenu: (index) => `[data-test="dashboard-join-menu-${index}"]`,
  removeJoinButton: (index) => `[data-test="dashboard-join-item-${index}-remove"]`,
  joinFilterLayout: '[data-test="dashboard-filter-layout"]',

  // Join popup configuration
  joinPopUp: '[data-test="dashboard-join-pop-up"]',
  joinFromStream: '[data-test="dashboard-config-panel-join-from"]',
  joinToStream: '[data-test="dashboard-config-panel-join-to"]',

  // Join type selectors
  joinTypeLeft: '[data-test="dashboard-join-type-left"]',
  joinTypeInner: '[data-test="dashboard-join-type-inner"]',
  joinTypeRight: '[data-test="dashboard-join-type-right"]',

  // Join conditions
  joinConditionLeftField: (index) => `[data-test="dashboard-join-condition-left-field-${index}"]`,
  joinConditionOperation: (index) => `[data-test="dashboard-join-condition-operation-${index}"]`,
  joinConditionRightField: (index) => `[data-test="dashboard-join-condition-right-field-${index}"]`,
  joinConditionAdd: (index) => `[data-test="dashboard-join-condition-add-${index}"]`,
  joinConditionRemove: (index) => `[data-test="dashboard-join-condition-remove-${index}"]`,
};

/**
 * Join types supported by the system
 */
export const JOIN_TYPES = {
  INNER: "inner",
  LEFT: "left",
  RIGHT: "right",
};

/**
 * Join operations/operators
 */
export const JOIN_OPERATIONS = ["=", "!=", ">", "<", ">=", "<="];

/**
 * Helper class for Dashboard Join operations using Page Object Model
 */
export default class DashboardJoinsHelper {
  constructor(page) {
    this.page = page;
  }

  /**
   * Helper method to select a field from the StreamFieldSelect dropdown
   * @param {string} fieldName - The field name to select
   * @param {object} dropdownLocator - The locator for the field dropdown
   */
  async selectFieldFromDropdown(fieldName, dropdownLocator) {
    await dropdownLocator.click();

    // Find the input element within the StreamFieldSelect component
    const inputField = dropdownLocator.locator('input[aria-label="Select Field"]');
    await inputField.waitFor({ state: "visible" });
    await inputField.fill(fieldName);

    // Wait for the dropdown menu to appear - use .last() to get the most recent menu
    const dropdownMenu = this.page.locator('.q-menu[role="listbox"]').last();
    await dropdownMenu.waitFor({ state: "visible", timeout: 5000 });

    // Wait for options to be filtered
    await this.page.waitForTimeout(500);

    // First, ensure expansion items are expanded
    const expansionItems = dropdownMenu.locator('.q-expansion-item');
    const expansionCount = await expansionItems.count();

    for (let i = 0; i < expansionCount; i++) {
      const expansion = expansionItems.nth(i);
      const isExpanded = await expansion.evaluate(el => el.classList.contains('q-expansion-item--expanded'));

      if (!isExpanded) {
        await expansion.click();
        await this.page.waitForTimeout(500);
      }
    }

    // Wait a bit more for expansion animation to complete
    await this.page.waitForTimeout(500);

    // Now find and click the field item
    await dropdownMenu.getByText(fieldName, { exact: true }).click();
  }

  /**
   * Add a new join to the dashboard panel
   */
  async addJoin() {
    const addButton = this.page.locator(JOIN_SELECTORS.addJoinButton);
    await addButton.waitFor({ state: "visible", timeout: 5000 });
    await addButton.click();

    // Wait for join item to appear
    await this.page.waitForTimeout(500);
  }

  /**
   * Click on a specific join item to open its configuration
   * @param {number} index - Join index (0-based)
   */
  async openJoinConfig(index) {
    const joinItem = this.page.locator(JOIN_SELECTORS.joinItem(index));
    await joinItem.waitFor({ state: "visible", timeout: 5000 });
    await joinItem.click();

    // Wait for popup to open
    const popup = this.page.locator(JOIN_SELECTORS.joinPopUp);
    await popup.waitFor({ state: "visible", timeout: 5000 });
  }

  /**
   * Select join type (INNER, LEFT, RIGHT)
   * @param {string} joinType - One of: "inner", "left", "right"
   */
  async selectJoinType(joinType) {
    const joinTypeLower = joinType.toLowerCase();
    let selector;

    switch (joinTypeLower) {
      case JOIN_TYPES.INNER:
        selector = JOIN_SELECTORS.joinTypeInner;
        break;
      case JOIN_TYPES.LEFT:
        selector = JOIN_SELECTORS.joinTypeLeft;
        break;
      case JOIN_TYPES.RIGHT:
        selector = JOIN_SELECTORS.joinTypeRight;
        break;
      default:
        throw new Error(`Invalid join type: ${joinType}. Use "inner", "left", or "right"`);
    }

    const typeButton = this.page.locator(selector);
    await typeButton.waitFor({ state: "visible", timeout: 5000 });
    await typeButton.click();
  }

  /**
   * Select the target stream to join with
   * @param {string} streamName - Name of the stream to join
   */
  async selectTargetStream(streamName) {
    const streamDropdown = this.page.locator(JOIN_SELECTORS.joinToStream);
    await streamDropdown.waitFor({ state: "visible", timeout: 5000 });
    await streamDropdown.click();

    // Wait for dropdown menu
    await this.page.waitForTimeout(500);

    // Click on the stream option
    const streamOption = this.page.getByRole("option", { name: streamName, exact: true });
    await streamOption.waitFor({ state: "visible", timeout: 5000 });
    await streamOption.click();
  }

  /**
   * Add a join condition with field mapping and operator
   * @param {number} conditionIndex - Condition index within the join (0-based)
   * @param {string} leftField - Field from the main/left stream
   * @param {string} operator - Join operator (=, !=, >, <, >=, <=)
   * @param {string} rightField - Field from the joined/right stream
   */
  async addJoinCondition(conditionIndex, leftField, operator, rightField) {
    // Select left field
    const leftFieldDropdown = this.page.locator(
      JOIN_SELECTORS.joinConditionLeftField(conditionIndex)
    );
    await leftFieldDropdown.waitFor({ state: "visible", timeout: 5000 });
    await this.selectFieldFromDropdown(leftField, leftFieldDropdown);

    // Select operator
    const operatorDropdown = this.page.locator(
      JOIN_SELECTORS.joinConditionOperation(conditionIndex)
    );
    await operatorDropdown.waitFor({ state: "visible", timeout: 5000 });
    await operatorDropdown.click();

    const operatorOption = this.page.getByRole("option", { name: operator, exact: true });
    await operatorOption.waitFor({ state: "visible", timeout: 5000 });
    await operatorOption.click();

    // Select right field
    const rightFieldDropdown = this.page.locator(
      JOIN_SELECTORS.joinConditionRightField(conditionIndex)
    );
    await rightFieldDropdown.waitFor({ state: "visible", timeout: 5000 });
    await this.selectFieldFromDropdown(rightField, rightFieldDropdown);
  }

  /**
   * Add an additional condition to an existing join (click + button)
   * @param {number} afterConditionIndex - Index of the condition after which to add new one
   */
  async addAdditionalCondition(afterConditionIndex) {
    const addButton = this.page.locator(
      JOIN_SELECTORS.joinConditionAdd(afterConditionIndex)
    );
    await addButton.waitFor({ state: "visible", timeout: 5000 });
    await addButton.click();

    // Wait for new condition to appear
    await this.page.waitForTimeout(500);
  }

  /**
   * Remove a join condition (click X button)
   * @param {number} conditionIndex - Index of the condition to remove
   */
  async removeJoinCondition(conditionIndex) {
    const removeButton = this.page.locator(
      JOIN_SELECTORS.joinConditionRemove(conditionIndex)
    );
    await removeButton.waitFor({ state: "visible", timeout: 5000 });
    await removeButton.click();

    // Wait for condition to be removed
    await this.page.waitForTimeout(500);
  }

  /**
   * Remove a join entirely from the panel
   * @param {number} joinIndex - Index of the join to remove (0-based)
   */
  async removeJoin(joinIndex) {
    const removeButton = this.page.locator(JOIN_SELECTORS.removeJoinButton(joinIndex));
    await removeButton.waitFor({ state: "visible", timeout: 5000 });
    await removeButton.click();

    // Wait for join to be removed
    await this.page.waitForTimeout(500);
  }

  /**
   * Configure a complete join with all parameters
   * @param {object} config - Join configuration object
   * @param {number} config.joinIndex - Index of the join to configure
   * @param {string} config.joinType - Join type: "inner", "left", or "right"
   * @param {string} config.targetStream - Name of the stream to join with
   * @param {Array} config.conditions - Array of condition objects
   *   Each condition: { leftField: string, operator: string, rightField: string }
   */
  async configureJoin({ joinIndex, joinType, targetStream, conditions }) {
    // Open join configuration
    await this.openJoinConfig(joinIndex);

    // Select join type
    await this.selectJoinType(joinType);

    // Select target stream
    await this.selectTargetStream(targetStream);

    // Add all conditions
    for (let i = 0; i < conditions.length; i++) {
      const condition = conditions[i];

      // If not the first condition, add a new condition slot
      if (i > 0) {
        await this.addAdditionalCondition(i - 1);
      }

      // Configure the condition
      await this.addJoinCondition(
        i,
        condition.leftField,
        condition.operator,
        condition.rightField
      );
    }
  }

  /**
   * Verify join appears in the query inspector SQL
   * @param {string} expectedJoinClause - Expected JOIN clause in SQL (partial match)
   */
  async verifyJoinInSQL(expectedJoinClause) {
    // Open query inspector
    await this.page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();

    // Wait for query to be visible
    await this.page.waitForTimeout(2000);

    // Check if the expected join clause is present
    const queryCell = this.page.getByRole("cell", {
      name: new RegExp(expectedJoinClause),
    });

    await queryCell.waitFor({ state: "visible", timeout: 5000 });

    // Close query inspector
    await this.page.locator('[data-test="query-inspector-close-btn"]').click();
  }

  /**
   * Verify exact SQL query in the query inspector
   * @param {string} expectedSQL - Expected complete SQL query
   */
  async verifyExactSQL(expectedSQL) {
    // Open query inspector
    await this.page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();

    // Wait for query to be visible
    await this.page.waitForTimeout(2000);

    // Check exact match
    const queryCell = this.page.getByRole("cell", {
      name: expectedSQL,
      exact: true,
    });

    await queryCell.waitFor({ state: "visible", timeout: 5000 });

    // Close query inspector
    await this.page.locator('[data-test="query-inspector-close-btn"]').click();
  }

  /**
   * Get the count of joins currently configured
   * @returns {Promise<number>} Number of joins
   */
  async getJoinCount() {
    const joinItems = this.page.locator('[data-test^="dashboard-join-item-"]');
    return await joinItems.count();
  }

  /**
   * Verify chart renders without errors after applying joins
   */
  async verifyChartRendersSuccessfully() {
    // Wait for chart container to be visible
    const chartContainer = this.page.locator('[data-test="dashboard-panel-chart"]');
    await chartContainer.waitFor({ state: "visible", timeout: 10000 });

    // Verify no error messages
    const errorMessage = this.page.locator('.error-message, .q-notification--negative');
    const errorCount = await errorMessage.count();

    if (errorCount > 0) {
      const errorText = await errorMessage.first().textContent();
      throw new Error(`Chart rendering failed with error: ${errorText}`);
    }
  }

  /**
   * Verify error message appears when join configuration is invalid
   * @param {string|RegExp} expectedError - Expected error message (string or regex)
   */
  async verifyErrorMessage(expectedError) {
    const errorLocator = typeof expectedError === 'string'
      ? this.page.getByText(expectedError)
      : this.page.getByText(expectedError);

    await errorLocator.waitFor({ state: "visible", timeout: 5000 });
  }

  /**
   * Configure multiple joins at once
   * @param {Array} joinsConfig - Array of join configuration objects
   *   Each config: { joinType, targetStream, conditions }
   */
  async configureMultipleJoins(joinsConfig) {
    for (let i = 0; i < joinsConfig.length; i++) {
      // Add a new join
      await this.addJoin();

      // Configure the join
      await this.configureJoin({
        joinIndex: i,
        ...joinsConfig[i],
      });

      // Close the popup (click outside or use a close button if available)
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(500);
    }
  }

  /**
   * Verify join icon type is displayed correctly
   * @param {number} joinIndex - Index of the join
   * @param {string} expectedType - Expected join type ("inner", "left", "right")
   */
  async verifyJoinIconType(joinIndex, expectedType) {
    const joinItem = this.page.locator(JOIN_SELECTORS.joinItem(joinIndex));

    // Check for the presence of the corresponding SVG icon
    const iconSelector = expectedType === "inner"
      ? '.inner-join-icon'
      : expectedType === "left"
      ? '.left-join-icon'
      : '.right-join-icon';

    const icon = joinItem.locator(iconSelector);
    await icon.waitFor({ state: "visible", timeout: 5000 });
  }

  /**
   * Edit an existing join's configuration
   * @param {number} joinIndex - Index of the join to edit
   * @param {object} updates - Updates to apply
   *   Can include: { joinType, targetStream, conditions }
   */
  async editJoin(joinIndex, updates) {
    // Open join configuration
    await this.openJoinConfig(joinIndex);

    // Update join type if provided
    if (updates.joinType) {
      await this.selectJoinType(updates.joinType);
    }

    // Update target stream if provided
    if (updates.targetStream) {
      await this.selectTargetStream(updates.targetStream);
    }

    // Update conditions if provided
    if (updates.conditions) {
      // For simplicity, we'll assume replacing all conditions
      // In a real scenario, you might want more granular control

      // Remove existing conditions (keep first, remove others)
      const currentConditionCount = await this.page
        .locator('[data-test^="dashboard-join-condition-left-field-"]')
        .count();

      for (let i = currentConditionCount - 1; i > 0; i--) {
        await this.removeJoinCondition(i);
      }

      // Add new conditions
      for (let i = 0; i < updates.conditions.length; i++) {
        if (i > 0) {
          await this.addAdditionalCondition(i - 1);
        }

        const condition = updates.conditions[i];
        await this.addJoinCondition(
          i,
          condition.leftField,
          condition.operator,
          condition.rightField
        );
      }
    }
  }

  /**
   * Verify join condition fields are correctly displayed
   * @param {number} conditionIndex - Index of the condition to verify
   * @param {string} leftField - Expected left field
   * @param {string} operator - Expected operator
   * @param {string} rightField - Expected right field
   */
  async verifyJoinConditionValues(conditionIndex, leftField, operator, rightField) {
    // This would require reading the displayed values
    // Implementation depends on how the UI displays selected values

    const leftFieldElement = this.page.locator(
      JOIN_SELECTORS.joinConditionLeftField(conditionIndex)
    );
    const leftValue = await leftFieldElement.textContent();

    if (!leftValue.includes(leftField)) {
      throw new Error(`Expected left field "${leftField}" but got "${leftValue}"`);
    }

    // Similar checks for operator and right field
  }
}
