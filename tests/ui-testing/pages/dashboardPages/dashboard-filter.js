export default class DashboardFilter {
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

    // Now find and click the field item - use getByText which is more reliable
    await dropdownMenu.getByText(fieldName, { exact: true }).click();
  }

  // Add filter condition

  async addFilterCondition(
    index,
    initialFieldName,
    newFieldName,
    operator,
    value
  ) {
    const idx = String(index);

    // Step 1: Click on the filter condition button
    // The label might have changed from previous edits, so we use a more flexible selector
    if (initialFieldName || newFieldName || operator || value) {
      // Try to find by the exact label first (for new filters)
      const exactLabelButton = this.page.locator(
        `[data-test="dashboard-add-condition-label-${idx}-${initialFieldName}"]`
      );

      const buttonExists = await exactLabelButton.count() > 0;

      if (buttonExists) {
        await exactLabelButton.click();
      } else {
        // If exact label doesn't exist, find the button by index using a partial match
        // This handles cases where the label has changed due to previous edits
        const allFilterButtons = this.page.locator(`[data-test^="dashboard-add-condition-label-${idx}-"]`);
        const buttonCount = await allFilterButtons.count();

        if (buttonCount > 0) {
          await allFilterButtons.first().click();
        } else {
          throw new Error(`Could not find filter condition button at index ${idx}`);
        }
      }
    }

    // Step 2: Select the new field from dropdown
    if (newFieldName) {
      const fieldDropdown = this.page.locator(
        `[data-test="dashboard-add-condition-column-${idx}}"]`
      );
      await this.selectFieldFromDropdown(newFieldName, fieldDropdown);
    }

    // Step 3: Open the condition selector
    if (operator || value) {
      const conditionLocator = this.page.locator(
        `[data-test="dashboard-add-condition-condition-${idx}"]`
      );
      await conditionLocator.waitFor({ state: "visible" });
      await conditionLocator.click(); // double click for stability
    }

    // Step 4: Operator dropdown
    if (operator) {
      const operatorLocator =
        index === 0
          ? this.page
              .locator('[data-test="dashboard-add-condition-operator"]')
              .first()
          : this.page
              .locator('[data-test="dashboard-add-condition-operator"]')
              .last();

      await operatorLocator.click();
      await this.page
        .getByRole("option", { name: operator, exact: true })
        .first()
        .click();
    }

    // Step 5: Enter value (if required)
    if (value) {
      const valueInput =
        index === 0
          ? this.page.locator('[data-test="common-auto-complete"]').first()
          : this.page.locator('[data-test="common-auto-complete"]').last();

      await valueInput.waitFor({ state: "visible", timeout: 10000 });
      await valueInput.click();
      await valueInput.fill(value);

      // Retry logic for clicking autocomplete suggestion
      const maxRetries = 5;
      let clicked = false;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // Get a fresh reference to the suggestion each time
          const suggestion = this.page
            .locator('[data-test="common-auto-complete-option"]')
            .first();

          // Wait for suggestion to appear
          await suggestion.waitFor({ state: "visible", timeout: 10000 });

          // Wait for element to be attached and stable
          await suggestion.waitFor({ state: "attached", timeout: 3000 });

          // Check if still visible
          const isVisible = await suggestion.isVisible();
          if (!isVisible) {
            throw new Error('Element not visible');
          }

          // Try to click
          await suggestion.click({ timeout: 3000 });

          clicked = true;
          break;

        } catch (error) {
          const isRetryable =
            error.message.includes('detached') ||
            error.message.includes('not visible') ||
            error.message.includes('not found') ||
            error.message.includes('Target closed');

          if (isRetryable && attempt < maxRetries) {
            // Wait progressively longer between retries
            await this.page.waitForTimeout(150 * attempt);
            continue;
          }

          // Last attempt failed or non-retryable error
          throw new Error(`Failed to click autocomplete after ${attempt} attempts: ${error.message}`);
        }
      }

      if (!clicked) {
        throw new Error(`Failed to click autocomplete suggestion after ${maxRetries} retries`);
      }
    } else if (operator && (newFieldName || initialFieldName)) {
      const selectedField = newFieldName || initialFieldName;
      const expectedError = `Filter: ${selectedField}: Condition value required`;

      const errorMessage = this.page
        .locator("div")
        .filter({ hasText: expectedError })
        .first();
      // Optional: assert if error must be visible
      // await expect(errorMessage).toBeVisible();
    }
  }

  // Select List Filter Items in the test case we have to select the items pass in Array
  //eg   ["ingress-nginx", "kube-system"]
  async selectListFilterItems(index, fieldName, values) {
    const idx = String(index);

    const labelLocator = this.page.locator(
      `[data-test="dashboard-add-condition-label-${idx}-${fieldName}"]`
    );
    await labelLocator.waitFor({ state: "visible" });
    await labelLocator.click();

    const listTab = this.page.locator(
      '[data-test="dashboard-add-condition-list-tab"]'
    );
    await listTab.waitFor({ state: "visible" });
    await listTab.click();

    await this.page
      .locator('[data-test="dashboard-add-condition-list-item"]')
      .first()
      .waitFor({ state: "visible" });

    for (const val of values) {
      const option = this.page
        .getByRole("option", { name: val, exact: true })
        .locator('[data-test="dashboard-add-condition-list-item"]');
      await option.waitFor({ state: "visible" });
      await option.click();
    }
  }

  // Add filter condition with dynamic ,Group inside group filter
  async addGroupFilterCondition(index, newFieldName, operator, value) {
    const idx = String(index);

    // Step 1: Get the dynamic label
    const dynamicLabelLocator = this.page.locator("div.field_label").nth(index);
    await dynamicLabelLocator.waitFor({ state: "visible" });

    const textContent = await dynamicLabelLocator.evaluate((el) => {
      return Array.from(el.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent.trim())
        .join("");
    });

    // await this.page.waitForTimeout(1000); // waits for 1 second
    await dynamicLabelLocator.waitFor({ state: "visible" });

    const fieldLabelLocator = this.page.locator(
      `[data-test="dashboard-add-condition-label-${idx}-${textContent}"]`
    );
    await fieldLabelLocator.click();

    // Step 3: Open the condition selector
    if (operator || value) {
      // Target the most recent (last) visible portal to avoid strict mode violation
      const conditionLocator = this.page
        .locator(`[data-test="dashboard-add-condition-condition-${idx}"]`)
        .last();
      await conditionLocator.waitFor({ state: "visible" });
      await conditionLocator.click(); // double click for stability
    }

    // Step 4: Operator dropdown
    if (operator) {
      const operatorLocator =
        index === 0
          ? this.page
              .locator('[data-test="dashboard-add-condition-operator"]')
              .first()
          : this.page
              .locator('[data-test="dashboard-add-condition-operator"]')
              .last();

      // Wait until operator dropdown is visible and stable
      await operatorLocator.waitFor({ state: "visible", timeout: 5000 });
      await this.page.waitForTimeout(500); // Wait for any animations to complete
      await operatorLocator.click();

      // Wait for the specific option to appear in any visible menu
      const optionLocator = this.page
        .getByRole("option", { name: operator, exact: true })
        .last();

      // Wait until option is visible with increased timeout
      await optionLocator.waitFor({ state: "visible", timeout: 10000 });
      await optionLocator.click();
    }

    // Step 5: Fill value field
    if (value) {
      const valueInput =
        index === 0
          ? this.page.locator('[data-test="common-auto-complete"]').first()
          : this.page.locator('[data-test="common-auto-complete"]').last();

      // Wait until input is visible
      await valueInput.waitFor({ state: "visible", timeout: 5000 });
      await valueInput.click();
      await valueInput.fill(value);

      const suggestion = this.page
        .locator('[data-test="common-auto-complete-option"]')
        .first();

      // Wait until suggestion is visible
      await suggestion.waitFor({ state: "visible", timeout: 5000 });
      await suggestion.click();
    } else if (operator && newFieldName) {
      const expectedError = `Filter: ${newFieldName}: Condition value required`;
      const errorMessage = this.page
        .locator("div")
        .filter({ hasText: expectedError });
      // Optional: Assert here if needed
    }

    // Step 2: Handle multiple matching elements for column dropdown
    const allColumnLocators = this.page.locator(
      `[data-test="dashboard-add-condition-column-${idx}\\}"]`
    );
    const count = await allColumnLocators.count();

    const columnLocator =
      count === 1
        ? allColumnLocators.first()
        : index === 0
        ? allColumnLocators.first()
        : allColumnLocators.last();

    await this.selectFieldFromDropdown(newFieldName, columnLocator);
  }

  // New robust function for nested group filter conditions
  async addNestedGroupFilterCondition(groupIndex, conditionIndex, fieldName, operator, value) {
    const idx = String(conditionIndex);

    // Step 1: Locate the specific group by its style attribute
    const groupLocator = this.page.locator(`.group[style*="--group-index: ${groupIndex}"]`);
    await groupLocator.waitFor({ state: "visible", timeout: 5000 });

    // Step 2: Find all label buttons within this specific group and click the one at conditionIndex
    const labelButtons = groupLocator.locator('[data-test^="dashboard-add-condition-label-"]');
    const targetLabel = labelButtons.nth(conditionIndex);
    await targetLabel.waitFor({ state: "visible", timeout: 5000 });
    await targetLabel.click();

    // Step 4: Click the condition selector (appears in portal, use page scope)
    if (operator || value) {
      const conditionSelector = this.page
        .locator(`[data-test="dashboard-add-condition-condition-${idx}"]`)
        .last();
      await conditionSelector.waitFor({ state: "visible", timeout: 5000 });
      await conditionSelector.click();
    }

    // Step 5: Select operator (dropdown appears in portal, use page scope)
    if (operator) {
      const operatorLocator = this.page
        .locator('[data-test="dashboard-add-condition-operator"]')
        .last();

      await operatorLocator.waitFor({ state: "visible", timeout: 5000 });
      await operatorLocator.waitFor({ state: "attached", timeout: 5000 });
      await operatorLocator.click();

      // Wait for operator option to be available and click it
      const operatorOption = this.page
        .getByRole("option", { name: operator, exact: true })
        .last();

      await operatorOption.waitFor({ state: "visible", timeout: 10000 });
      await operatorOption.click();
    }

    // Step 6: Fill value if provided (appears in portal, use page scope)
    if (value) {
      const valueInput = this.page
        .locator('[data-test="common-auto-complete"]')
        .last();

      await valueInput.waitFor({ state: "visible", timeout: 5000 });
      await valueInput.click();
      await valueInput.fill(value);

      // Wait for autocomplete suggestion
      const suggestion = this.page
        .locator('[data-test="common-auto-complete-option"]')
        .first();

      await suggestion.waitFor({ state: "visible", timeout: 5000 });
      await suggestion.click();
    }

    // Step 7: Update the field name (appears in portal, use page scope)
    const allColumnLocators = this.page.locator(
      `[data-test="dashboard-add-condition-column-${idx}\\}"]`
    );
    const count = await allColumnLocators.count();

    const columnLocator = count === 1 ? allColumnLocators.first() : allColumnLocators.last();

    await columnLocator.waitFor({ state: "visible", timeout: 5000 });
    await this.selectFieldFromDropdown(fieldName, columnLocator);
  }
}
