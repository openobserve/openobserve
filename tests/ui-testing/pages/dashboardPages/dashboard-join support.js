import { expect } from "@playwright/test";

export default class DashboardJoin {
  constructor(page) {
    this.page = page;
    this.addJoinBtn = page.locator('[data-test="dashboard-add-join-btn"]');
    this.joinItem = page.locator('[data-test="dashboard-join-item-0"]');
    this.joinTypeDropdown = page.locator(
      '[data-test="dashboard-config-panel-join-type"]'
    );
    this.joinToDropdown = page.locator(
      '[data-test="dashboard-config-panel-join-to"]'
    );
    this.leftFieldDropdown = page
      .locator('[data-test="dashboard-join-condition-leftField-0"] div')
      .filter({ hasText: "arrow_drop_down" })
      .nth(2);
    this.operationDropdown = page.locator(
      '[data-test="dashboard-join-condition-operation-0"]'
    );
    this.rightFieldDropdown = page.locator(
      '[data-test="dashboard-join-condition-rightField-0"] [data-test="stream-field-select"]'
    );
  }

  async performJoin({ joinType, toTable, leftField, operation, rightField }) {
    // Click the Add Join button
    await this.addJoinBtn.click();

    // Wait for the join item and click it
    await this.joinItem.waitFor({ state: "visible" });
    await this.joinItem.click();

    // Select Join Type
    await this.joinTypeDropdown.click();
    const joinTypeOption = this.page.getByRole("option", { name: joinType });
    await joinTypeOption.waitFor();
    await joinTypeOption.click();

    // Select To Table
    await this.joinToDropdown.click();
    const toTableOption = this.page.getByRole("option", { name: toTable });
    await toTableOption.waitFor();
    await toTableOption.click();

    // Select Left Field
    await this.leftFieldDropdown.click();
    const leftFieldOption = this.page.getByText(leftField, { exact: true });
    await leftFieldOption.waitFor();
    await leftFieldOption.click();

    // Select Operator
    await this.operationDropdown.click();
    const operationOption = this.page.getByRole("option", { name: operation });
    await operationOption.waitFor();
    await operationOption.click();

    // Select Right Field
    await this.rightFieldDropdown.click();
    const rightFieldOption = this.page.getByText(rightField, { exact: true });
    await rightFieldOption.waitFor();
    await rightFieldOption.click();
  }
}
