export default class ChartTypeSelector {
  constructor(page) {
    this.page = page;
  }
  // Add filter condition its working
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
      await conditionLocator.click();
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

      // await expect(valueInput).toBeVisible({ timeout: 10000 });
      await valueInput.click();
      await valueInput.fill(value);

      const suggestion = this.page
        .locator('[data-test="common-auto-complete-option"]')
        .first();
      // await expect(suggestion).toBeVisible({ timeout: 10000 });
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
  ///group inside grup filter method for that crewting this method ,but it isin progress
  // async addFilterCondition11(index, newFieldName, operator, value) {
  //   const idx = String(index);

  //   // Step 1: Detect the dynamic field label if needed
  //   const dynamicLabelLocator = this.page.locator("div.field_label").nth(index);

  //   const textContent = await dynamicLabelLocator.evaluate((el) => {
  //     return Array.from(el.childNodes)
  //       .filter((node) => node.nodeType === Node.TEXT_NODE)
  //       .map((node) => node.textContent.trim())
  //       .join("");
  //   });

  //   const fieldLabelLocator = this.page.locator(
  //     `[data-test="dashboard-add-condition-label-${idx}-${textContent}"]`
  //   );
  //   await fieldLabelLocator.waitFor({ state: "visible" });
  //   await fieldLabelLocator.click();

  //   // Step 2: Open and select from column dropdown
  //   const columnLocator = this.page.locator(
  //     `[data-test="dashboard-add-condition-column-${idx}"]`
  //   );
  //   await columnLocator.click();
  //   await columnLocator.fill(newFieldName);
  //   await this.page
  //     .getByRole("option", { name: newFieldName, exact: true })
  //     .first()
  //     .click();

  //   // Step 3: Click the condition dropdown
  //   if (operator || value) {
  //     const conditionLocator = this.page.locator(
  //       `[data-test="dashboard-add-condition-condition-${idx}"]`
  //     );
  //     await conditionLocator.click();
  //     await conditionLocator.click(); // for safety
  //   }

  //   // Step 4: Operator selection — use `.first()` for 0 and `.last()` for others
  //   if (operator) {
  //     const operatorLocator =
  //       index === 0
  //         ? this.page
  //             .locator('[data-test="dashboard-add-condition-operator"]')
  //             .first()
  //         : this.page
  //             .locator('[data-test="dashboard-add-condition-operator"]')
  //             .last();

  //     await operatorLocator.click();
  //     await this.page
  //       .getByRole("option", { name: operator, exact: true })
  //       .first()
  //       .click();
  //   }

  //   // Step 5: Fill the value field (if needed)
  //   if (value) {
  //     const valueInput =
  //       index === 0
  //         ? this.page.locator('[data-test="common-auto-complete"]').first()
  //         : this.page.locator('[data-test="common-auto-complete"]').last();

  //     await expect(valueInput).toBeVisible({ timeout: 10000 });
  //     await valueInput.click();
  //     await valueInput.fill(value);

  //     const suggestion = this.page
  //       .locator('[data-test="common-auto-complete-option"]')
  //       .first();
  //     await expect(suggestion).toBeVisible({ timeout: 10000 });
  //     await suggestion.click();
  //   } else if (operator && newFieldName) {
  //     const expectedError = `Filter: ${newFieldName}: Condition value required`;
  //     const errorMessage = this.page
  //       .locator("div")
  //       .filter({ hasText: expectedError });
  //   }
  // }

  // Select List Filter Items in the test case we have to slect the itesm pass in Array
  //eg   ["ingress-nginx", "kube-system"]

  async selectListFilterItems(index, fieldName, values) {
    // console.log("Selecting list filter items", values);

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
      // console.log(`Selecting option: ${val}`, values);

      const option = this.page
        .getByRole("option", { name: val, exact: true })
        .locator('[data-test="dashboard-add-condition-list-item"]');
      // console.log(`Selecting option: ${val}`, option);

      await option.waitFor({ state: "visible" });
      await option.click();
    }
  }
}
