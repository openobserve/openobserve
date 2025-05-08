import { test, expect } from "../baseFixtures.js";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import { login } from "../utils/dashLogin.js";
import { ingestion, removeUTFCharacters } from "../utils/dashIngestion.js";
import {
  waitForDashboardPage,
  applyQueryButton,
  deleteDashboard,
} from "../utils/dashCreation.js";

const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });

test.describe("dashboard filter testcases", () => {
  test.beforeEach(async ({ page }) => {
    console.log("running before each");
    await login(page);
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(2000);

    const orgNavigation = page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await orgNavigation;
  });

  test("should correctly apply the filter conditions with different operators, and successfully apply them to the query", async ({
    page,
  }) => {
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-add"]').click();
    await page.locator('[data-test="add-dashboard-name"]').click();
    await page
      .locator('[data-test="add-dashboard-name"]')
      .fill(randomDashboardName);

    await page.locator('[data-test="dashboard-add-submit"]').click();
    await page.waitForTimeout(500);

    const settingsButton = page.locator('[data-test="dashboard-setting-btn"]');
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();

    await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
    await page.locator('[data-test="dashboard-variable-add-btn"]').click();

    await page
      .locator('[data-test="dashboard-variable-name"]')
      .fill("variablename");

    await page
      .locator("label")
      .filter({ hasText: "Stream Type *arrow_drop_down" })
      .locator("i")
      .click();
    await page
      .getByRole("option", { name: "logs" })
      .locator("div")
      .nth(2)
      .click();

    await page
      .locator('[data-test="dashboard-variable-stream-select"]')
      .fill("e2e_automate");
    await page
      .getByRole("option", { name: "e2e_automate", exact: true })
      .locator("div")
      .nth(2)
      .click();

    await page.locator('[data-test="dashboard-variable-field-select"]').click();
    await page
      .locator('[data-test="dashboard-variable-field-select"]')
      .fill("kubernetes_container_name");
    await page.getByText("kubernetes_container_name").click();

    await page.locator('[data-test="dashboard-variable-save-btn"]').click();

    await page.waitForTimeout(3000);

    await page.locator('[data-test="dashboard-settings-close-btn"]').click();

    const button = page.locator(
      '[data-test="dashboard-if-no-panel-add-panel-btn"]'
    );
    await expect(button).toBeVisible();

    await page.waitForTimeout(2000);
    await button.click();

    await page
      .locator('[data-test="index-dropdown-stream"]')
      .waitFor({ state: "visible" });
    await page.locator('[data-test="index-dropdown-stream"]').click();

    await page
      .locator('[data-test="index-dropdown-stream"]')
      .press("Control+a");
    await page
      .locator('[data-test="index-dropdown-stream"]')
      .fill("e2e_automat");

    await page
      .getByRole("option", { name: "e2e_automate", exact: true })
      .click();

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-_timestamp"] [data-test="dashboard-add-y-data"]'
      )
      .click();

    await page.locator('[data-test="dashboard-apply"]').click();

    await page.waitForSelector('[data-test="date-time-btn"]:not([disabled])', {
      timeout: 5000,
    });
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="date-time-apply-btn"]').click();

    await page.waitForTimeout(2000);

    await page.locator('[data-test="dashboard-apply"]').click();

    const filterButton = page.locator(
      '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_name"] [data-test="dashboard-add-filter-data"]'
    );
    await expect(filterButton).toBeVisible();
    await filterButton.click();
    await page
      .locator('[data-test="dashboard-variable-query-value-selector"]')
      .click();
    await page
      .locator('[data-test="dashboard-variable-query-value-selector"]')
      .fill("ziox");
    await page.getByRole("option", { name: "ziox" }).click();
    await page.locator('[data-test="dashboard-add-condition-add"]').click();

    await page
      .locator(
        '[data-test="dashboard-add-condition-label-0-kubernetes_container_name"]'
      )
      .click();
    await page
      .locator('[data-test="dashboard-add-condition-condition-0"]')
      .click();
    await page
      .locator('[data-test="dashboard-add-condition-operator"]')
      .click();

    await page.getByText("=", { exact: true }).click();
    await page.getByLabel("Value").click();
    await page.getByLabel("Value").fill("$variablename");

    await page.locator('[data-test="dashboard-apply"]').click();

    await page.waitForTimeout(2000);

    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();

    await expect(
      page.getByRole("cell", {
        name: 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE kubernetes_container_name = \'$variablename\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
        exact: true,
      })
    ).toBeVisible();

    await page.locator('[data-test="query-inspector-close-btn"]').click();

    await page.locator('[data-test="dashboard-panel-name"]').click();
    await page
      .locator('[data-test="dashboard-panel-name"]')
      .fill("Dashboard_test");
    await page.locator('[data-test="dashboard-panel-save"]').click();

    // Delete dashbaord
    await page.locator('[data-test="dashboard-back-btn"]').click();

    await deleteDashboard(page, randomDashboardName);
  });

  test("should successfully apply filter conditions using both AND and OR operators", async ({
    page,
  }) => {
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-add"]').click();
    await page.locator('[data-test="add-dashboard-name"]').click();
    await page
      .locator('[data-test="add-dashboard-name"]')
      .fill(randomDashboardName);

    await page.locator('[data-test="dashboard-add-submit"]').click();
    await page.waitForTimeout(3000);

    const settingsButton = page.locator('[data-test="dashboard-setting-btn"]');
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();

    await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
    await page.locator('[data-test="dashboard-variable-add-btn"]').click();

    await page
      .locator('[data-test="dashboard-variable-name"]')
      .fill("variablename");

    await page
      .locator("label")
      .filter({ hasText: "Stream Type *arrow_drop_down" })
      .locator("i")
      .click();
    await page
      .getByRole("option", { name: "logs" })
      .locator("div")
      .nth(2)
      .click();

    await page
      .locator('[data-test="dashboard-variable-stream-select"]')
      .fill("e2e_automate");
    await page
      .getByRole("option", { name: "e2e_automate", exact: true })
      .locator("div")
      .nth(2)
      .click();

    await page.locator('[data-test="dashboard-variable-field-select"]').click();
    await page
      .locator('[data-test="dashboard-variable-field-select"]')
      .fill("kubernetes_container_name");
    await page.getByText("kubernetes_container_name").click();

    await page.locator('[data-test="dashboard-variable-save-btn"]').click();

    await page.waitForTimeout(3000);
    await page.locator('[data-test="dashboard-settings-close-btn"]').click();

    const button = page.locator(
      '[data-test="dashboard-if-no-panel-add-panel-btn"]'
    );
    await expect(button).toBeVisible();

    await page.waitForTimeout(1000);
    await button.click();

    await page
      .locator('[data-test="index-dropdown-stream"]')
      .waitFor({ state: "visible" });
    await page.locator('[data-test="index-dropdown-stream"]').click();

    await page.waitForTimeout(2000);

    await page
      .getByRole("option", { name: "e2e_automate", exact: true })
      .click();

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-_timestamp"] [data-test="dashboard-add-y-data"]'
      )
      .click();
    await page.locator('[data-test="dashboard-apply"]').click();

    await page.waitForSelector('[data-test="date-time-btn"]:not([disabled])', {
      timeout: 5000,
    });
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="date-time-apply-btn"]').click();

    await page.waitForTimeout(3000);

    const filterButton = page.locator(
      '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_name"] [data-test="dashboard-add-filter-data"]'
    );
    await expect(filterButton).toBeVisible();
    await filterButton.click();

    const filterButton1 = page.locator(
      '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_image"] [data-test="dashboard-add-filter-data"]'
    );
    await expect(filterButton1).toBeVisible();
    await filterButton1.click();

    await page
      .locator('[data-test="dashboard-variable-query-value-selector"]')
      .click();

    await page
      .locator('[data-test="dashboard-variable-query-value-selector"]')
      .fill("ziox");
    await page.getByRole("option", { name: "ziox" }).click();

    await page.locator('[data-test="dashboard-add-condition-add"]').click();
    await page
      .locator(
        '[data-test="dashboard-add-condition-label-0-kubernetes_container_name"]'
      )
      .click();
    await page
      .locator('[data-test="dashboard-add-condition-condition-0"]')
      .click();
    await page
      .locator('[data-test="dashboard-add-condition-operator"]')
      .first()
      .click();

    await page.getByText("=", { exact: true }).click();
    await page.getByLabel("Value").click();
    await page.getByLabel("Value").fill("$variablename");

    await page
      .locator(
        '[data-test="dashboard-add-condition-label-1-kubernetes_container_image"]'
      )
      .click();
    await page
      .locator('[data-test="dashboard-add-condition-condition-1"]')
      .click();
    await page
      .locator('[data-test="dashboard-add-condition-condition-1"]')
      .click();

    await page
      .locator('[data-test="dashboard-add-condition-operator"]')
      .last()
      .click();

    await page
      .getByRole("option", { name: "<>" })
      .locator("div")
      .nth(2)
      .click();
    await page
      .locator("div")
      .filter({ hasText: /^Value$/ })
      .nth(2)
      .click();
    await page.getByLabel("Value").fill("$variablename");

    await page.locator('[data-test="dashboard-apply"]').click();
    await page.getByText("arrow_rightQueryAutoPromQLCustom SQL").click();
    await expect(page.getByText("'$variablename'").first()).toBeVisible();
    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();

    await expect(
      page.getByRole("cell", {
        name: 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE kubernetes_container_name = \'ziox\' AND kubernetes_container_image <> \'ziox\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
        exact: true,
      })
    ).toBeVisible();

    const cell = page.getByRole("cell", {
      name: 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE kubernetes_container_name = \'ziox\' AND kubernetes_container_image <> \'ziox\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
      exact: true,
    });

    // Check if the cell is visible
    await expect(cell).toBeVisible();

    // Verify it contains the correct text
    await expect(cell).toHaveText(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE kubernetes_container_name = \'ziox\' AND kubernetes_container_image <> \'ziox\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC'
    );

    await page.waitForTimeout(2000);
    await page.locator('[data-test="query-inspector-close-btn"]').click();

    await page.getByText("ANDarrow_drop_down").click();
    await page.getByRole("option", { name: "OR" }).click();
    await page.locator('[data-test="dashboard-apply"]').click();

    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();

    await expect(
      page.getByRole("cell", {
        name: 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE kubernetes_container_name = \'ziox\' OR kubernetes_container_image <> \'ziox\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
        exact: true,
      })
    ).toBeVisible();

    const ORoprator = page.getByRole("cell", {
      name: 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE kubernetes_container_name = \'ziox\' OR kubernetes_container_image <> \'ziox\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
      exact: true,
    });

    // Check if the cell is visible
    await expect(ORoprator).toBeVisible();

    // Verify it contains the correct text
    await expect(ORoprator).toHaveText(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE kubernetes_container_name = \'ziox\' OR kubernetes_container_image <> \'ziox\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC'
    );

    await page.waitForTimeout(2000);
    await page.locator('[data-test="query-inspector-close-btn"]').click();

    await page.locator('[data-test="dashboard-panel-name"]').click();
    await page.locator('[data-test="dashboard-panel-name"]').fill("test");
    await page.locator('[data-test="dashboard-panel-save"]').click();

    // Delete dashbaord
    await page.locator('[data-test="dashboard-back-btn"]').click();

    await deleteDashboard(page, randomDashboardName);
  });

  test("Should  apply the  filter group inside group", async ({ page }) => {
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-add"]').click();
    await page.locator('[data-test="add-dashboard-name"]').click();
    await page
      .locator('[data-test="add-dashboard-name"]')
      .fill(randomDashboardName);

    await page.locator('[data-test="dashboard-add-submit"]').click();

    await page.waitForTimeout(3000);

    const settingsButton = page.locator('[data-test="dashboard-setting-btn"]');
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();

    await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
    await page.locator('[data-test="dashboard-variable-add-btn"]').click();

    await page
      .locator('[data-test="dashboard-variable-name"]')
      .fill("variablename");

    await page
      .locator("label")
      .filter({ hasText: "Stream Type *arrow_drop_down" })
      .locator("i")
      .click();
    await page
      .getByRole("option", { name: "logs" })
      .locator("div")
      .nth(2)
      .click();

    await page
      .locator('[data-test="dashboard-variable-stream-select"]')
      .fill("e2e_automate");
    await page
      .getByRole("option", { name: "e2e_automate", exact: true })
      .locator("div")
      .nth(2)
      .click();

    await page.locator('[data-test="dashboard-variable-field-select"]').click();
    await page
      .locator('[data-test="dashboard-variable-field-select"]')
      .fill("kubernetes_container_name");
    await page.getByText("kubernetes_container_name").click();

    await page.locator('[data-test="dashboard-variable-save-btn"]').click();

    await page.waitForTimeout(3000);
    await page.locator('[data-test="dashboard-settings-close-btn"]').click();

    const button = page.locator(
      '[data-test="dashboard-if-no-panel-add-panel-btn"]'
    );
    await expect(button).toBeVisible();

    await page.waitForTimeout(1000);
    await button.click();

    await page
      .locator('[data-test="index-dropdown-stream"]')
      .waitFor({ state: "visible" });
    await page.locator('[data-test="index-dropdown-stream"]').click();

    await page.waitForTimeout(2000);

    await page
      .getByRole("option", { name: "e2e_automate", exact: true })
      .click();

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-_timestamp"] [data-test="dashboard-add-y-data"]'
      )
      .click();
    await page.locator('[data-test="dashboard-apply"]').click();

    await page.waitForSelector('[data-test="date-time-btn"]:not([disabled])', {
      timeout: 5000,
    });
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="date-time-apply-btn"]').click();

    await page.waitForTimeout(3000);

    await page
      .locator('[data-test="dashboard-variable-query-value-selector"]')
      .click();
    await page
      .locator('[data-test="dashboard-variable-query-value-selector"]')
      .fill("ziox");
    const zioxOption = page.getByRole("option", { name: "ziox" });

    await expect(zioxOption).toBeVisible();
    await zioxOption.click();

    await page.locator('[data-test="dashboard-add-condition-add"]').click();

    await page.getByText("Add Group").click();

    const textContent = await page
      .locator("div.field_label")
      .first()
      .evaluate((el) => {
        return Array.from(el.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE) // Get only text nodes
          .map((node) => node.textContent.trim()) // Trim whitespace
          .join("");
      });

    await page
      .locator(`[data-test="dashboard-add-condition-label-0-${textContent}"]`)
      .waitFor({ state: "visible" });
    await page
      .locator(`[data-test="dashboard-add-condition-label-0-${textContent}"]`)
      .click();

    await page
      .locator('[data-test="dashboard-add-condition-column-0\\}"]')
      .click();

    await page
      .getByRole("option", { name: "kubernetes_container_name" })
      .click();
    await page
      .locator('[data-test="dashboard-add-condition-condition-0"]')
      .click();
    await page
      .locator('[data-test="dashboard-add-condition-operator"]')
      .first()
      .click();

    await page.getByText("=", { exact: true }).click();
    await page.getByLabel("Value").click();
    await page.getByLabel("Value").fill("$variablename");

    await page
      .locator("div")
      .filter({ hasText: /^kubernetes_container_namearrow_drop_downcloseadd$/ })
      .locator('[data-test="dashboard-add-condition-add"]')
      .click();
    await page.locator("div").filter({ hasText: "Add Group" }).nth(3).click();

    await page
      .locator(`[data-test="dashboard-add-condition-label-0-${textContent}"]`)
      .click();

    const lastInput = page
      .locator('[data-test="dashboard-add-condition-column-0\\}"]')
      .last();
    await lastInput.click();
    lastInput.fill("kubernetes_container_image");

    await page.getByText("kubernetes_container_image", { exact: true }).click();

    await page
      .locator('[data-test="dashboard-add-condition-condition-0"]')
      .first()
      .click();

    await page
      .locator('[data-test="dashboard-add-condition-operator"]')
      .click();
    await page
      .getByRole("option", { name: "<>" })
      .locator("div")
      .nth(2)
      .click();

    await page.getByLabel("Value").click();
    await page.getByLabel("Value").fill("$variablename");

    await page.locator('[data-test="dashboard-apply"]').click();

    await page.locator('[data-test="dashboard-apply"]').click();
    await page.getByText("arrow_rightQueryAutoPromQLCustom SQL").click();
    await expect(page.getByText("'$variablename'").first()).toBeVisible();
    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();
    await expect(
      page.getByRole("cell", {
        name: 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE (kubernetes_container_name = \'ziox\' AND (kubernetes_container_image <> \'ziox\')) GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
        exact: true,
      })
    ).toBeVisible();
    await page.locator('[data-test="query-inspector-close-btn"]').click();
    await page.locator('[data-test="dashboard-panel-name"]').click();
    await page.locator('[data-test="dashboard-panel-name"]').click();
    await page
      .locator('[data-test="dashboard-panel-name"]')
      .fill("Dashbaord_test");
    await page.locator('[data-test="dashboard-panel-save"]').click();

    // Delete dashbaord
    await page.locator('[data-test="dashboard-back-btn"]').click();
    await deleteDashboard(page, randomDashboardName);
  });

  test("Should apply the add group filter with apply the list of value successfully", async ({
    page,
  }) => {
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-add"]').click();
    await page.locator('[data-test="add-dashboard-name"]').click();
    await page
      .locator('[data-test="add-dashboard-name"]')
      .fill(randomDashboardName);

    await page.locator('[data-test="dashboard-add-submit"]').click();

    await page.waitForTimeout(3000);

    const settingsButton = page.locator('[data-test="dashboard-setting-btn"]');
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();

    await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
    await page.locator('[data-test="dashboard-variable-add-btn"]').click();

    await page
      .locator('[data-test="dashboard-variable-name"]')
      .fill("variablename");

    await page
      .locator("label")
      .filter({ hasText: "Stream Type *arrow_drop_down" })
      .locator("i")
      .click();
    await page
      .getByRole("option", { name: "logs" })
      .locator("div")
      .nth(2)
      .click();

    await page
      .locator('[data-test="dashboard-variable-stream-select"]')
      .fill("e2e_automate");
    await page
      .getByRole("option", { name: "e2e_automate", exact: true })
      .locator("div")
      .nth(2)
      .click();

    await page.locator('[data-test="dashboard-variable-field-select"]').click();
    await page
      .locator('[data-test="dashboard-variable-field-select"]')
      .fill("kubernetes_container_name");
    await page.getByText("kubernetes_container_name").click();

    await page.locator('[data-test="dashboard-variable-save-btn"]').click();
    await page.locator('[data-test="dashboard-settings-close-btn"]').click();

    await page.waitForTimeout(3000);

    const button = page.locator(
      '[data-test="dashboard-if-no-panel-add-panel-btn"]'
    );
    await expect(button).toBeVisible();

    await page.waitForTimeout(1000);
    await button.click();

    // await page.waitForTimeout(2000);

    await page
      .locator('[data-test="index-dropdown-stream"]')
      .waitFor({ state: "visible" });
    await page.locator('[data-test="index-dropdown-stream"]').click();

    await page.waitForTimeout(2000);

    await page
      .getByRole("option", { name: "e2e_automate", exact: true })
      .click();

    await page
      .locator('[data-test="dashboard-x-item-_timestamp-remove"]')
      .click();
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_name"] [data-test="dashboard-add-x-data"]'
      )
      .click();
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_image"] [data-test="dashboard-add-y-data"]'
      )
      .click();
    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_namespace_name"] [data-test="dashboard-add-filter-data"]'
      )
      .click();
    await page
      .locator(
        '[data-test="dashboard-add-condition-label-0-kubernetes_namespace_name"]'
      )
      .click();

    await page.waitForSelector('[data-test="date-time-btn"]:not([disabled])', {
      timeout: 5000,
    });
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="date-time-apply-btn"]').click();

    await page.waitForTimeout(3000);

    await page
      .locator(
        '[data-test="dashboard-add-condition-label-0-kubernetes_namespace_name"]'
      )
      .click();

    await page
      .locator('[data-test="dashboard-add-condition-list-tab"]')
      .waitFor({ state: "visible" });
    await page
      .locator('[data-test="dashboard-add-condition-list-tab"]')
      .click();

    await page.waitForTimeout(2000);

    await page
      .getByRole("option", { name: "ingress-nginx" })
      .locator('[data-test="dashboard-add-condition-list-item"]')
      .click();
    await page
      .getByRole("option", { name: "kube-system" })
      .locator('[data-test="dashboard-add-condition-list-item"]')
      .click();

    await page.locator('[data-test="dashboard-apply"]').click();

    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();

    const cell = await page.getByRole("cell", {
      name: /SELECT kubernetes_container_name as "x_axis_1", count\(kubernetes_container_image\) as "y_axis_1" FROM "e2e_automate" WHERE kubernetes_namespace_name IN \('ingress-nginx', 'kube-system'\) GROUP BY x_axis_1/,
    });

    // Ensure the cell is visible
    await expect(cell.first()).toBeVisible();

    // Verify the text matches
    await expect(cell.first()).toHaveText(
      'SELECT kubernetes_container_name as "x_axis_1", count(kubernetes_container_image) as "y_axis_1" FROM "e2e_automate" WHERE kubernetes_namespace_name IN (\'ingress-nginx\', \'kube-system\') GROUP BY x_axis_1'
    );

    await page.locator('[data-test="query-inspector-close-btn"]').click();
    await page.locator('[data-test="dashboard-panel-name"]').click();
    await page.locator('[data-test="dashboard-panel-name"]').click();
    await page
      .locator('[data-test="dashboard-panel-name"]')
      .fill("Dashbaord_test");
    await page.locator('[data-test="dashboard-panel-save"]').click();

    // Delete dashbaord
    await page.locator('[data-test="dashboard-back-btn"]').click();

    await deleteDashboard(page, randomDashboardName);
  });

  test("Should  apply the  filter using the field button", async ({ page }) => {
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-add"]').click();
    await page.locator('[data-test="add-dashboard-name"]').click();
    await page
      .locator('[data-test="add-dashboard-name"]')
      .fill(randomDashboardName);

    await page.locator('[data-test="dashboard-add-submit"]').click();

    await page.waitForTimeout(3000);

    const settingsButton = page.locator('[data-test="dashboard-setting-btn"]');
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();

    await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
    await page.locator('[data-test="dashboard-variable-add-btn"]').click();

    await page
      .locator('[data-test="dashboard-variable-name"]')
      .fill("variablename");

    await page
      .locator("label")
      .filter({ hasText: "Stream Type *arrow_drop_down" })
      .locator("i")
      .click();
    await page
      .getByRole("option", { name: "logs" })
      .locator("div")
      .nth(2)
      .click();

    await page
      .locator('[data-test="dashboard-variable-stream-select"]')
      .fill("e2e_automate");
    await page
      .getByRole("option", { name: "e2e_automate", exact: true })
      .locator("div")
      .nth(2)
      .click();

    await page.locator('[data-test="dashboard-variable-field-select"]').click();
    await page
      .locator('[data-test="dashboard-variable-field-select"]')
      .fill("kubernetes_container_name");
    await page.getByText("kubernetes_container_name").click();

    await page.locator('[data-test="dashboard-variable-save-btn"]').click();

    await page.locator('[data-test="dashboard-settings-close-btn"]').click();

    const button = page.locator(
      '[data-test="dashboard-if-no-panel-add-panel-btn"]'
    );
    await expect(button).toBeVisible();

    await page.waitForTimeout(1000);
    await button.click();
    // await page.waitForTimeout(2000);

    await page
      .locator('[data-test="index-dropdown-stream"]')
      .waitFor({ state: "visible" });
    await page.locator('[data-test="index-dropdown-stream"]').click();

    await page.waitForTimeout(2000);

    await page
      .getByRole("option", { name: "e2e_automate", exact: true })
      .click();

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-_timestamp"] [data-test="dashboard-add-y-data"]'
      )
      .click();
    await page.locator('[data-test="dashboard-apply"]').click();

    await page.waitForSelector('[data-test="date-time-btn"]:not([disabled])', {
      timeout: 5000,
    });
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="date-time-apply-btn"]').click();

    await page.waitForTimeout(3000);

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_namespace_name"] [data-test="dashboard-add-filter-data"]'
      )
      .click();
    await expect(
      page.locator(
        '[data-test="dashboard-add-condition-label-0-kubernetes_namespace_name"]'
      )
    ).toBeVisible();
    await page.locator('[data-test="dashboard-add-condition-remove"]').click();

    await page.locator('[data-test="dashboard-apply"]').click();

    await page.locator('[data-test="dashboard-panel-name"]').click();
    await page.locator('[data-test="dashboard-panel-name"]').click();
    await page
      .locator('[data-test="dashboard-panel-name"]')
      .fill("Dashbaord_test");
    await page.locator('[data-test="dashboard-panel-save"]').click();

    // Delete dashbaord
    await page.locator('[data-test="dashboard-back-btn"]').click();

    await deleteDashboard(page, randomDashboardName);
  });

  test("Should disply an error massge if added the invalid oprator", async ({
    page,
  }) => {
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-add"]').click();
    await page.locator('[data-test="add-dashboard-name"]').click();
    await page
      .locator('[data-test="add-dashboard-name"]')
      .fill(randomDashboardName);

    await page.locator('[data-test="dashboard-add-submit"]').click();

    await page.waitForTimeout(3000);

    const settingsButton = page.locator('[data-test="dashboard-setting-btn"]');
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();

    await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
    await page.locator('[data-test="dashboard-variable-add-btn"]').click();

    await page
      .locator('[data-test="dashboard-variable-name"]')
      .fill("variablename");

    await page
      .locator("label")
      .filter({ hasText: "Stream Type *arrow_drop_down" })
      .locator("i")
      .click();
    await page
      .getByRole("option", { name: "logs" })
      .locator("div")
      .nth(2)
      .click();

    await page
      .locator('[data-test="dashboard-variable-stream-select"]')
      .fill("e2e_automate");
    await page
      .getByRole("option", { name: "e2e_automate", exact: true })
      .locator("div")
      .nth(2)
      .click();

    await page.locator('[data-test="dashboard-variable-field-select"]').click();
    await page
      .locator('[data-test="dashboard-variable-field-select"]')
      .fill("kubernetes_container_name");
    await page.getByText("kubernetes_container_name").click();

    await page.locator('[data-test="dashboard-variable-save-btn"]').click();
    await page.locator('[data-test="dashboard-settings-close-btn"]').click();

    await page.waitForTimeout(3000);

    const button = page.locator(
      '[data-test="dashboard-if-no-panel-add-panel-btn"]'
    );
    await expect(button).toBeVisible();

    await page.waitForTimeout(1000);
    await button.click();
    // await page.waitForTimeout(2000);

    await page
      .locator('[data-test="index-dropdown-stream"]')
      .waitFor({ state: "visible" });
    await page.locator('[data-test="index-dropdown-stream"]').click();

    await page.waitForTimeout(2000);

    await page
      .getByRole("option", { name: "e2e_automate", exact: true })
      .click();

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-_timestamp"] [data-test="dashboard-add-y-data"]'
      )
      .click();
    await page.locator('[data-test="dashboard-apply"]').click();

    await page.waitForSelector('[data-test="date-time-btn"]:not([disabled])', {
      timeout: 5000,
    });
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="date-time-apply-btn"]').click();
    await page.waitForTimeout(3000);

    const filterButton = page.locator(
      '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_name"] [data-test="dashboard-add-filter-data"]'
    );
    await expect(filterButton).toBeVisible();
    await filterButton.click();
    await page
      .locator(
        '[data-test="dashboard-add-condition-label-0-kubernetes_container_name"]'
      )
      .click();
    await page
      .locator('[data-test="dashboard-add-condition-condition-0"]')
      .click();
    await page
      .locator('[data-test="dashboard-add-condition-operator"]')
      .click();
    await page.getByRole("option", { name: "IN", exact: true }).click();
    await page.locator('[data-test="common-auto-complete"]').click();
    await page.locator('[data-test="common-auto-complete-option"]').click();
    await page.locator('[data-test="dashboard-apply"]').click();
    await page.getByText("Error Loading Data").click();

    await page
      .locator(
        '[data-test="dashboard-add-condition-label-0-kubernetes_container_name"]'
      )
      .click();
    await page
      .locator('[data-test="dashboard-add-condition-condition-0"]')
      .click();
    await page
      .locator('[data-test="dashboard-add-condition-operator"]')
      .click();
    await page.getByRole("option", { name: "=", exact: true }).click();
    await page.locator('[data-test="dashboard-apply"]').click();

    await page.locator('[data-test="dashboard-panel-name"]').click();
    await page.locator('[data-test="dashboard-panel-name"]').click();
    await page
      .locator('[data-test="dashboard-panel-name"]')
      .fill("Dashbaord_test");
    await page.locator('[data-test="dashboard-panel-save"]').click();

    // Delete dashbaord
    await page.locator('[data-test="dashboard-back-btn"]').click();

    await deleteDashboard(page, randomDashboardName);
  });

  test("Should Filter work correcly if Added the breakdwon filed", async ({
    page,
  }) => {
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await waitForDashboardPage(page);
    await page.locator('[data-test="dashboard-add"]').click();
    await page.locator('[data-test="add-dashboard-name"]').click();
    await page
      .locator('[data-test="add-dashboard-name"]')
      .fill(randomDashboardName);

    await page.locator('[data-test="dashboard-add-submit"]').click();

    await page.waitForTimeout(3000);

    const settingsButton = page.locator('[data-test="dashboard-setting-btn"]');
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();

    await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
    await page.locator('[data-test="dashboard-variable-add-btn"]').click();

    await page
      .locator('[data-test="dashboard-variable-name"]')
      .fill("variablename");

    await page
      .locator("label")
      .filter({ hasText: "Stream Type *arrow_drop_down" })
      .locator("i")
      .click();
    await page
      .getByRole("option", { name: "logs" })
      .locator("div")
      .nth(2)
      .click();

    await page
      .locator('[data-test="dashboard-variable-stream-select"]')
      .fill("e2e_automate");
    await page
      .getByRole("option", { name: "e2e_automate", exact: true })
      .locator("div")
      .nth(2)
      .click();

    await page.locator('[data-test="dashboard-variable-field-select"]').click();
    await page
      .locator('[data-test="dashboard-variable-field-select"]')
      .fill("kubernetes_container_name");
    await page.getByText("kubernetes_container_name").click();

    await page.locator('[data-test="dashboard-variable-save-btn"]').click();

    await page.waitForTimeout(3000);
    await page.locator('[data-test="dashboard-settings-close-btn"]').click();

    const button = page.locator(
      '[data-test="dashboard-if-no-panel-add-panel-btn"]'
    );
    await expect(button).toBeVisible();

    await page.waitForTimeout(1000);
    await button.click();

    // await page.waitForTimeout(2000);

    await page
      .locator('[data-test="index-dropdown-stream"]')
      .waitFor({ state: "visible" });
    await page.locator('[data-test="index-dropdown-stream"]').click();

    await page.waitForTimeout(2000);

    await page
      .getByRole("option", { name: "e2e_automate", exact: true })
      .click();

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-_timestamp"] [data-test="dashboard-add-y-data"]'
      )
      .click();

    await page
      .locator(
        '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_name"] [data-test="dashboard-add-b-data"]'
      )
      .click();

    await page.locator('[data-test="dashboard-apply"]').click();

    await page.waitForSelector('[data-test="date-time-btn"]:not([disabled])', {
      timeout: 5000,
    });
    await page.locator('[data-test="date-time-btn"]').click();
    await page.locator('[data-test="date-time-relative-6-w-btn"]').click();
    await page.locator('[data-test="date-time-apply-btn"]').click();

    await page.waitForTimeout(3000);

    const filterButton = page.locator(
      '[data-test="field-list-item-logs-e2e_automate-kubernetes_container_name"] [data-test="dashboard-add-filter-data"]'
    );
    await expect(filterButton).toBeVisible();
    await filterButton.click();
    await page
      .locator('[data-test="dashboard-variable-query-value-selector"]')
      .click();
    await page
      .locator('[data-test="dashboard-variable-query-value-selector"]')
      .fill("ziox");
    await page.getByRole("option", { name: "ziox" }).click();

    await page.locator('[data-test="dashboard-add-condition-add"]').click();
    await page
      .locator(
        '[data-test="dashboard-add-condition-label-0-kubernetes_container_name"]'
      )
      .click();
    await page
      .locator('[data-test="dashboard-add-condition-condition-0"]')
      .click();
    await page
      .locator('[data-test="dashboard-add-condition-operator"]')
      .click();
    await page.getByText("=", { exact: true }).click();
    await page.getByLabel("Value").click();
    await page.getByLabel("Value").fill("$variablename");
    await page.locator('[data-test="dashboard-apply"]').click();

    await page
      .locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]')
      .click();

    await page.waitForTimeout(3000);

    await expect(
      page.getByRole("cell", {
        name: 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", kubernetes_container_name as "breakdown_1" FROM "e2e_automate" WHERE kubernetes_container_name = \'$variablename\' GROUP BY x_axis_1, breakdown_1 ORDER BY x_axis_1 ASC',
        exact: true,
      })
    ).toBeVisible();

    await page.locator('[data-test="query-inspector-close-btn"]').click();
    await page.locator('[data-test="dashboard-apply"]').click();

    await page.locator('[data-test="dashboard-panel-name"]').click();
    await page.locator('[data-test="dashboard-panel-name"]').click();
    await page
      .locator('[data-test="dashboard-panel-name"]')
      .fill("Dashbaord_test");
    await page.locator('[data-test="dashboard-panel-save"]').click();

    // Delete dashbaord
    await page.locator('[data-test="dashboard-back-btn"]').click();

    await deleteDashboard(page, randomDashboardName);
  });
});
