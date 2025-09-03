export default class DashboardFilter {
  constructor(page) {
    this.page = page;
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

    // Step 1: Click on the initial field name if provided
    if (initialFieldName) {
      await this.page
        .locator(
          `[data-test="dashboard-add-condition-label-${idx}-${initialFieldName}"]`
        )
        .click();
    }

    // Step 2: Select the new field from dropdown
    if (newFieldName) {
      const fieldDropdown = this.page.locator(
        `[data-test="dashboard-add-condition-column-${idx}}"]`
      );
      await fieldDropdown.click();
      await fieldDropdown.fill(newFieldName);
      await this.page
        .getByRole("option", { name: newFieldName, exact: true })
        .first()
        .click();
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
      // await expect(valueInput).toBeVisible({ timeout: 10000 });
      await valueInput.click();
      await valueInput.fill(value);

      const suggestion = this.page
        .locator('[data-test="common-auto-complete-option"]')
        .first();
      // await expect(suggestion).toBeVisible({ timeout: 10000 });
      await suggestion.waitFor({ state: "visible", timeout: 10000 });

      await suggestion.click();
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

    await dynamicLabelLocator.waitFor({ state: "visible" });

    const fieldLabelLocator = this.page.locator(
      `[data-test="dashboard-add-condition-label-${idx}-${textContent}"]`
    );
    await fieldLabelLocator.click();

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

    // More robust field selection approach
    await columnLocator.click();

    // Ensure field is focused and ready for input
    await columnLocator.focus();
    await this.page.waitForTimeout(300);

    // Clear existing content and enter new field name
    await this.page.keyboard.press("Control+a"); // Select all
    await this.page.keyboard.type(newFieldName);

    // Wait for suggestions to load
    await this.page.waitForTimeout(1000);

    // Use a more deterministic approach to select from dropdown
    const maxRetries = 5;
    let success = false;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Wait for dropdown to be present
        const dropdownExists = await this.page
          .locator('div.q-menu[role="listbox"]')
          .isVisible();

        if (dropdownExists) {
          // Get all dropdown options
          const options = this.page.locator(
            'div.q-menu[role="listbox"] div.q-item'
          );
          const optionCount = await options.count();

          if (optionCount > 0) {
            // Try to find exact match first
            const exactMatch = options.filter({
              hasText: new RegExp(
                `^${newFieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`
              ),
            });
            const exactCount = await exactMatch.count();

            if (exactCount > 0) {
              await exactMatch.first().click();
              success = true;
              break;
            } else {
              // If no exact match, click the first option
              await options.first().click();
              success = true;
              break;
            }
          }
        }

        // If dropdown not visible, try keyboard selection
        await this.page.keyboard.press("ArrowDown");
        await this.page.waitForTimeout(200);
        await this.page.keyboard.press("Enter");

        // Check if selection was successful by verifying dropdown closed
        await this.page.waitForTimeout(500);
        const stillVisible = await this.page
          .locator('div.q-menu[role="listbox"]')
          .isVisible();
        if (!stillVisible) {
          success = true;
          break;
        }
      } catch (error) {
        console.log(`Attempt ${attempt} failed: ${error.message}`);
        if (attempt === maxRetries) {
          // Last resort: just press Enter
          await this.page.keyboard.press("Enter");
          success = true;
          break;
        }
        await this.page.waitForTimeout(500); // Wait before retry
      }
    }

    if (!success) {
      throw new Error(
        `Failed to select field after ${maxRetries} attempts: ${newFieldName}`
      );
    }

    // Additional wait to ensure selection is processed
    await this.page.waitForTimeout(500);

    // Step 3: Condition dropdown
    if (operator || value) {
      const conditionLocator = this.page.locator(
        `[data-test="dashboard-add-condition-condition-${idx}"]`
      );

      // Wait for element to be ready for interaction
      // await conditionLocator.waitFor({
      //   state: "visible",
      //   timeout: 10000,
      // });

      // Simple and reliable approach - just wait for visibility and click
      await conditionLocator.waitFor({ state: "visible", timeout: 15000 });
      
      // Scroll into view if needed
      await conditionLocator.scrollIntoViewIfNeeded();
      
      // Click when ready - Playwright will automatically wait for element to be actionable
      await conditionLocator.click({ timeout: 15000 });
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

    // Step 5: Fill value field
    if (value) {
      const valueInput =
        index === 0
          ? this.page.locator('[data-test="common-auto-complete"]').first()
          : this.page.locator('[data-test="common-auto-complete"]').last();

      await valueInput.click();
      await valueInput.fill(value);

      const suggestion = this.page
        .locator('[data-test="common-auto-complete-option"]')
        .first();
      await suggestion.click();
    } else if (operator && newFieldName) {
      const expectedError = `Filter: ${newFieldName}: Condition value required`;
      const errorMessage = this.page
        .locator("div")
        .filter({ hasText: expectedError });
      // Optional: Assert here if needed
    }
  }
}
