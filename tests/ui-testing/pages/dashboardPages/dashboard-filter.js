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

    // Find the input element within the StreamFieldSelect component using data-test
    const streamFieldSelect = this.page.locator('[data-test="stream-field-select"]').last();
    await streamFieldSelect.waitFor({ state: "visible" });
    // Use pressSequentially to properly trigger Vue reactive filtering
    await streamFieldSelect.pressSequentially(fieldName, { delay: 50 });

    // Wait for the dropdown menu to appear — OSelect popover uses data-test="stream-field-select-popover".
    const dropdownMenu = this.page.locator('[data-test="stream-field-select-popover"]').last();
    await dropdownMenu.waitFor({ state: "visible", timeout: 5000 });

    // Wait for the option with the matching label to appear after filtering
    await dropdownMenu
      .locator(`[data-test="stream-field-select-option"][data-test-label="${fieldName}"]`)
      .first()
      .waitFor({ state: "visible", timeout: 5000 })
      .catch(() => {});

    // Find and click the field item by data-test-label (label = field name)
    await dropdownMenu
      .locator(`[data-test="stream-field-select-option"][data-test-label="${fieldName}"]`)
      .first()
      .click();
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
      // Ensure any previously open filter popover is fully closed before re-opening.
      // Reka UI portals leave stale condition-tab elements in DOM mid-transition,
      // causing "element not stable / detached" failures on subsequent edits.
      await this.page.keyboard.press("Escape").catch(() => {});
      await this.page
        .locator('[data-test="dashboard-add-condition-operator-popover"]')
        .waitFor({ state: "hidden", timeout: 2000 })
        .catch(() => {});

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
      // Wait for popover to fully open and tabs to mount — deterministically
      // wait on the condition-tab itself becoming visible (the dependent step).
      await this.page
        .locator(`[data-test="dashboard-add-condition-condition-${idx}"]`)
        .last()
        .waitFor({ state: "visible", timeout: 10000 })
        .catch(() => {});
    }

    // Step 2: Select the new field from dropdown
    if (newFieldName) {
      const fieldDropdown = this.page.locator(
        `[data-test="dashboard-add-condition-column-${idx}"]`
      );
      await this.selectFieldFromDropdown(newFieldName, fieldDropdown);
    }

    // Step 3: Open the condition selector
    if (operator || value) {
      // Use .last() to target the most recently opened portal — when a filter
      // condition is re-edited, the tab from the previous popover may still
      // exist in the DOM mid-transition.
      const conditionLocator = this.page
        .locator(`[data-test="dashboard-add-condition-condition-${idx}"]`)
        .last();
      await conditionLocator.waitFor({ state: "visible", timeout: 10000 });
      // Reka UI tabs may re-mount during portal transition; retry click with force
      // to bypass detached-element instability.
      await conditionLocator.click({ force: true, timeout: 10000 });
      // Wait deterministically for the operator dropdown (Step 4's target) to
      // appear instead of a fixed-ms buffer.
      await this.page
        .locator('[data-test="dashboard-add-condition-operator"]')
        .first()
        .waitFor({ state: "visible", timeout: 10000 })
        .catch(() => {});
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

      // OSelect in listbox mode: outer div gets data-test; PopoverTrigger is the inner button.
      // Use JS click to avoid viewport/portal click interception issues.
      await operatorLocator.waitFor({ state: "visible", timeout: 10000 });
      await operatorLocator.locator('button').first().evaluate((el) => el.click());
      // Options render in portal with data-test="${parent}-popover"
      const operatorPopover = this.page.locator('[data-test="dashboard-add-condition-operator-popover"]');
      await operatorPopover.waitFor({ state: "visible", timeout: 10000 });
      // Wait deterministically for the virtualizer's first option to mount inside the popover.
      await operatorPopover
        .locator('[data-test="dashboard-add-condition-operator-option"]')
        .first()
        .waitFor({ state: "visible", timeout: 10000 })
        .catch(() => {});
      // The virtualizer renders items asynchronously; search then select
      // Type into the search filter to narrow results, then click
      const searchInput = operatorPopover.locator('[data-test="o-select-search-input"]').first();
      const hasSearch = await searchInput.count() > 0;
      if (hasSearch) {
        await searchInput.fill(operator);
        // After typing, wait for the filtered option to be visible — the
        // option's `data-test-value` mirrors the typed operator text.
        await operatorPopover
          .locator(`[data-test="dashboard-add-condition-operator-option"][data-test-value="${operator}"]`)
          .first()
          .waitFor({ state: "visible", timeout: 5000 })
          .catch(() => {});
      }
      // Pick the option by its data-test-value (OSelect option convention).
      const optionByValue = operatorPopover.locator(
        `[data-test="dashboard-add-condition-operator-option"][data-test-value="${operator}"]`,
      ).first();
      if (await optionByValue.isVisible({ timeout: 3000 }).catch(() => false)) {
        await optionByValue.click();
      } else {
        // Fallback to first visible option in the popover (post-filter only one should remain).
        await operatorPopover
          .locator('[data-test="dashboard-add-condition-operator-option"]')
          .first()
          .click();
      }
      // Wait for the operator dropdown portal to fully close before step 5.
      await operatorPopover
        .waitFor({ state: "hidden", timeout: 5000 })
        .catch(() => {});
    }

    // Step 5: Enter value (if required)
    if (value) {
      // OCombobox in AddCondition.vue has data-test="dashboard-add-condition-value";
      // OCombobox renders its inner input as [data-test="${name}-input"]
      const valueInput = this.page.locator('[data-test="dashboard-add-condition-value-input"]');

      await valueInput.waitFor({ state: "visible", timeout: 10000 });
      await valueInput.click();
      // Use pressSequentially char-by-char to trigger OCombobox's reactive filtering
      await valueInput.pressSequentially(value, { delay: 50 });

      // Try to click a matching autocomplete suggestion if one appears
      const optionLocator = '[data-test="dashboard-add-condition-value-option"]';
      const optionVisible = await this.page.locator(optionLocator).first()
        .isVisible({ timeout: 3000 }).catch(() => false);

      if (optionVisible) {
        try {
          await this.page.locator(optionLocator).first().click({ timeout: 3000 });
        } catch {
          // If suggestion click fails, value is already typed — accept with Tab
          await this.page.keyboard.press('Tab');
        }
      }
      // If no suggestions appeared, the typed value is accepted as-is
    }
  }

  // Select List Filter Items in the test case we have to select the items pass in Array
  //eg   ["ingress-nginx", "kube-system"]
  async selectListFilterItems(index, fieldName, values) {
    const idx = String(index);

    // 1. Open the condition popover via the label button
    const labelLocator = this.page.locator(
      `[data-test="dashboard-add-condition-label-${idx}-${fieldName}"]`
    );
    await labelLocator.waitFor({ state: "visible" });
    await labelLocator.click();

    // 2. Click the "List" OTab to switch to list mode
    // OTab has data-test="dashboard-add-condition-list-${conditionIndex}"
    const listTabTrigger = this.page
      .locator(`[data-test="dashboard-add-condition-list-${idx}"]`)
      .last();
    await listTabTrigger.waitFor({ state: "visible", timeout: 10000 });
    await listTabTrigger.click();

    // 3. Click the OSelect trigger button to open the list dropdown
    // OSelect renders its trigger as [data-test="${parent}-trigger"]
    const listSelect = this.page
      .locator('[data-test="dashboard-add-condition-list-tab"]')
      .last();
    await listSelect.waitFor({ state: "visible", timeout: 5000 });
    await listSelect.locator('button').first().evaluate((el) => el.click());

    // 4. Wait for the OSelect popover and its options to load
    const listPopover = this.page.locator(
      '[data-test="dashboard-add-condition-list-tab-popover"]'
    );
    await listPopover.waitFor({ state: "visible", timeout: 10000 });
    await listPopover
      .locator('[data-test="dashboard-add-condition-list-tab-option"]')
      .first()
      .waitFor({ state: "visible", timeout: 5000 })
      .catch(() => {});

    // 5. Click each option by its data-test-value
    for (const val of values) {
      const option = listPopover.locator(
        `[data-test="dashboard-add-condition-list-tab-option"][data-test-value="${val}"]`
      );
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

      await operatorLocator.waitFor({ state: "visible", timeout: 5000 });
      await operatorLocator.locator('button').first().evaluate((el) => el.click());

      const operatorPopover = this.page.locator('[data-test="dashboard-add-condition-operator-popover"]');
      await operatorPopover.waitFor({ state: "visible", timeout: 10000 });

      const searchInput = operatorPopover.locator('[data-test="o-select-search-input"]').first();
      const hasSearch = await searchInput.count() > 0;
      if (hasSearch) {
        await searchInput.fill(operator);
        await operatorPopover
          .locator(`[data-test="dashboard-add-condition-operator-option"][data-test-value="${operator}"]`)
          .first()
          .waitFor({ state: "visible", timeout: 5000 })
          .catch(() => {});
      }

      const optionByValue = operatorPopover.locator(
        `[data-test="dashboard-add-condition-operator-option"][data-test-value="${operator}"]`
      ).first();
      if (await optionByValue.isVisible({ timeout: 3000 }).catch(() => false)) {
        await optionByValue.click();
      } else {
        await operatorPopover.locator('[data-test="dashboard-add-condition-operator-option"]').first().click();
      }

      await operatorPopover
        .waitFor({ state: "hidden", timeout: 5000 })
        .catch(() => {});
    }

    // Step 5: Fill value field
    if (value) {
      const valueInput = this.page.locator('[data-test="dashboard-add-condition-value-input"]').last();

      await valueInput.waitFor({ state: "visible", timeout: 5000 });
      await valueInput.click();
      await valueInput.pressSequentially(value, { delay: 50 });

      const optionLocator = '[data-test="dashboard-add-condition-value-option"]';
      const optionVisible = await this.page.locator(optionLocator).first()
        .isVisible({ timeout: 3000 }).catch(() => false);

      if (optionVisible) {
        try {
          await this.page.locator(optionLocator).first().click({ timeout: 3000 });
        } catch {
          await this.page.keyboard.press('Tab');
        }
      }
    }

    // Step 2: Handle multiple matching elements for column dropdown
    const allColumnLocators = this.page.locator(
      `[data-test="dashboard-add-condition-column-${idx}"]`
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
      await operatorLocator.locator('button').first().evaluate((el) => el.click());

      const nestedOperatorPopover = this.page.locator('[data-test="dashboard-add-condition-operator-popover"]');
      await nestedOperatorPopover.waitFor({ state: "visible", timeout: 10000 });

      const nestedSearchInput = nestedOperatorPopover.locator('[data-test="o-select-search-input"]').first();
      const nestedHasSearch = await nestedSearchInput.count() > 0;
      if (nestedHasSearch) {
        await nestedSearchInput.fill(operator);
        await nestedOperatorPopover
          .locator(`[data-test="dashboard-add-condition-operator-option"][data-test-value="${operator}"]`)
          .first()
          .waitFor({ state: "visible", timeout: 5000 })
          .catch(() => {});
      }

      const nestedOptionByValue = nestedOperatorPopover.locator(
        `[data-test="dashboard-add-condition-operator-option"][data-test-value="${operator}"]`
      ).first();
      if (await nestedOptionByValue.isVisible({ timeout: 3000 }).catch(() => false)) {
        await nestedOptionByValue.click();
      } else {
        await nestedOperatorPopover.locator('[data-test="dashboard-add-condition-operator-option"]').first().click();
      }

      await nestedOperatorPopover
        .waitFor({ state: "hidden", timeout: 5000 })
        .catch(() => {});
    }

    // Step 6: Fill value if provided (appears in portal, use page scope)
    if (value) {
      const valueInput = this.page
        .locator('[data-test="dashboard-add-condition-value-input"]')
        .last();

      await valueInput.waitFor({ state: "visible", timeout: 5000 });
      await valueInput.click();
      await valueInput.pressSequentially(value, { delay: 50 });

      const suggestion = this.page
        .locator('[data-test="dashboard-add-condition-value-option"]')
        .first();

      await suggestion.waitFor({ state: "visible", timeout: 10000 });
      await suggestion.click({ timeout: 15000 });
    }

    // Step 7: Update the field name (appears in portal, use page scope)
    const allColumnLocators = this.page.locator(
      `[data-test="dashboard-add-condition-column-${idx}"]`
    );
    const count = await allColumnLocators.count();

    const columnLocator = count === 1 ? allColumnLocators.first() : allColumnLocators.last();

    await columnLocator.waitFor({ state: "visible", timeout: 5000 });
    await this.selectFieldFromDropdown(fieldName, columnLocator);
  }
}
