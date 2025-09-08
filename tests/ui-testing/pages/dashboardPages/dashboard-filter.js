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

      // Use robust dropdown selection
      await this.selectDropdownOptionByText(newFieldName);
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

      // Use robust dropdown selection for operator
      await this.selectDropdownOptionByText(operator);
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
      // Try the original approach first for list items
      try {
        const option = this.page
          .getByRole("option", { name: val, exact: true })
          .locator('[data-test="dashboard-add-condition-list-item"]');
        await option.waitFor({ state: "visible", timeout: 3000 });
        await option.click();
      } catch (error) {
        // Fallback to robust selection if needed
        console.log(`Using fallback selection for list item: ${val}`);
        await this.selectDropdownOptionByText(val);
      }
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

    await columnLocator.click();
    await columnLocator.fill(newFieldName);

    // await this.page
    //   .getByRole("option", { name: newFieldName, exact: true })
    //   .first()
    //   .click();

    // const option = this.page
    //   .getByRole("option", { name: newFieldName, exact: true })
    //   .first();
    // await option.waitFor({ state: "visible", timeout: 10000 });
    // await option.click();

    // await this.page
    //   .locator('div.q-menu[role="listbox"] div.q-item')
    //   .first()
    //   .click();

    // Robust dropdown selection with proper waiting and text matching
    await this.selectDropdownOptionByText(newFieldName);

    // Step 3: Condition dropdown
    if (operator || value) {
      const conditionLocator = this.page.locator(
        `[data-test="dashboard-add-condition-condition-${idx}"]`
      );
      await conditionLocator.click();
      await conditionLocator.click(); // safety click
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

      // Use robust dropdown selection for operator
      await this.selectDropdownOptionByText(operator);
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

  /**
   * Robust helper method to select dropdown options by text content
   * Handles virtual scrolling, timing issues, and provides retry mechanism
   * @param {string} optionText - The text content to look for
   * @param {number} timeout - Maximum time to wait for the option (default: 15000ms)
   * @param {number} retries - Number of retry attempts (default: 3)
   */
  async selectDropdownOptionByText(optionText, timeout = 15000, retries = 3) {
    let lastError;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        // Wait for the dropdown menu to be visible and stable
        const dropdownMenu = this.page.locator('div.q-menu[role="listbox"]');
        await dropdownMenu.waitFor({ state: "visible", timeout: timeout });

        // Wait for virtual scroll content to be loaded
        const virtualScrollContent = dropdownMenu.locator(
          ".q-virtual-scroll__content"
        );
        await virtualScrollContent.waitFor({ state: "visible", timeout: 5000 });

        // Wait a bit for the dropdown to be fully populated after typing
        await this.page.waitForTimeout(500);

        // Strategy 1: Try to find exact match using getByRole
        try {
          const exactOption = this.page.getByRole("option", {
            name: optionText,
            exact: true,
          });

          // Check if the option exists and is visible
          const optionCount = await exactOption.count();
          if (optionCount > 0) {
            const firstOption = exactOption.first();
            await firstOption.waitFor({ state: "visible", timeout: 3000 });
            await firstOption.click();
            return; // Success!
          }
        } catch (error) {
          console.log(
            `Strategy 1 failed on attempt ${attempt + 1}: ${error.message}`
          );
        }

        // Strategy 2: Find by text content within dropdown items
        try {
          const dropdownItems = dropdownMenu.locator(
            'div.q-item[role="option"]'
          );
          await dropdownItems
            .first()
            .waitFor({ state: "visible", timeout: 3000 });

          const itemCount = await dropdownItems.count();
          console.log(`Found ${itemCount} dropdown items`);

          for (let i = 0; i < itemCount; i++) {
            const item = dropdownItems.nth(i);

            // Wait for the item to be visible
            try {
              await item.waitFor({ state: "visible", timeout: 2000 });
            } catch (e) {
              continue; // Skip this item if not visible
            }

            // Get text content from the item
            const itemText = await item
              .locator(".q-item__label span, .q-item__label")
              .textContent();

            if (itemText && itemText.trim() === optionText.trim()) {
              // Scroll item into view if needed
              await item.scrollIntoViewIfNeeded();

              // Click the item
              await item.click();
              return; // Success!
            }
          }
        } catch (error) {
          console.log(
            `Strategy 2 failed on attempt ${attempt + 1}: ${error.message}`
          );
        }

        // Strategy 3: Use text filter on items
        try {
          const itemByText = dropdownMenu
            .locator('div.q-item[role="option"]')
            .filter({ hasText: optionText })
            .first();

          await itemByText.waitFor({ state: "visible", timeout: 3000 });
          await itemByText.scrollIntoViewIfNeeded();
          await itemByText.click();
          return; // Success!
        } catch (error) {
          console.log(
            `Strategy 3 failed on attempt ${attempt + 1}: ${error.message}`
          );
          lastError = error;
        }

        // If we get here, all strategies failed for this attempt
        console.log(
          `All strategies failed on attempt ${attempt + 1}. Retrying...`
        );

        // Small delay before retry
        if (attempt < retries - 1) {
          await this.page.waitForTimeout(1000);
        }
      } catch (error) {
        console.log(
          `Attempt ${attempt + 1} failed with error: ${error.message}`
        );
        lastError = error;

        // Small delay before retry
        if (attempt < retries - 1) {
          await this.page.waitForTimeout(1000);
        }
      }
    }

    // If all attempts failed, throw a descriptive error
    throw new Error(
      `Failed to select dropdown option "${optionText}" after ${retries} attempts. ` +
        `Last error: ${lastError?.message || "Unknown error"}`
    );
  }

  /**
   * Alternative method with even more robust handling for special cases
   * Use this if the main method still has issues
   */
  async selectDropdownOptionRobust(optionText, timeout = 20000) {
    // Wait for dropdown to appear and stabilize
    await this.page.waitForFunction(
      () => {
        const dropdown = document.querySelector('div.q-menu[role="listbox"]');
        if (!dropdown) return false;

        const items = dropdown.querySelectorAll('div.q-item[role="option"]');
        return items.length > 0;
      },
      { timeout }
    );

    // Use evaluate to find and click the option in the DOM directly
    const clicked = await this.page.evaluate((searchText) => {
      const dropdown = document.querySelector('div.q-menu[role="listbox"]');
      if (!dropdown) return false;

      const items = dropdown.querySelectorAll('div.q-item[role="option"]');

      for (const item of items) {
        const textElement =
          item.querySelector(".q-item__label span") ||
          item.querySelector(".q-item__label") ||
          item;

        const text = textElement?.textContent?.trim();

        if (text === searchText.trim()) {
          // Ensure the item is visible before clicking
          const rect = item.getBoundingClientRect();
          const isVisible =
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= window.innerHeight &&
            rect.right <= window.innerWidth;

          if (isVisible) {
            item.click();
            return true;
          }
        }
      }
      return false;
    }, optionText);

    if (!clicked) {
      throw new Error(`Could not find or click dropdown option: ${optionText}`);
    }
  }
}
