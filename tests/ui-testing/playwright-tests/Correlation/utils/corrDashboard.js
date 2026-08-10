// corrDashboard.js — Browser-side helpers for the full-drawer
// TelemetryCorrelationDashboard (dialog mode) and correlation settings
// Discovered-Services detail panel.
//
// Selectors proven against the feature doc and existing Correlation tests.

const { expect } = require("@playwright/test");
const { UI_BASE_URL } = require("./corrUi");

// ── Full-drawer dashboard ──────────────────────────────────────────

/**
 * Expand the first log result row inline and click
 * [data-test="log-correlation-btn"] to open the full-drawer
 * correlation dashboard (mode="dialog").
 */
async function openFullDrawerDashboard(page) {
  const firstRow = page
    .locator('[data-test="logs-search-result-logs-table"] tbody tr')
    .first();
  await firstRow.waitFor({ state: "visible", timeout: 20_000 });

  const expander = firstRow
    .locator(
      '[data-test="o2-table-expand-cell"], [data-test^="o2-table-expand-"]',
    )
    .first();
  await expander.waitFor({ state: "visible", timeout: 15_000 });
  await expander.click();

  const btn = page.locator('[data-test="log-correlation-btn"]').first();
  await btn.waitFor({ state: "visible", timeout: 15_000 });
  await btn.click();
}

/** Assert the full-drawer correlation dashboard container is visible. */
async function expectDashboardDrawerVisible(page) {
  await expect(
    page.locator('[data-test="telemetry-correlation-dashboard-drawer"]').first(),
  ).toBeVisible({ timeout: 30_000 });
}

/** Assert all three telemetry tabs (Logs, Metrics, Traces) are present. */
async function expectAllCorrelationTabsVisible(page) {
  await expect(
    page.getByRole("tab").filter({ hasText: "Logs" }).first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByRole("tab").filter({ hasText: "Metrics" }).first(),
  ).toBeVisible({ timeout: 5_000 });
  await expect(
    page.getByRole("tab").filter({ hasText: "Traces" }).first(),
  ).toBeVisible({ timeout: 5_000 });
}

// ── Dashboard tab switching ────────────────────────────────────────

async function clickDashboardLogsTab(page) {
  const tab = page.getByRole("tab").filter({ hasText: "Logs" }).first();
  await tab.waitFor({ state: "visible", timeout: 15_000 });
  await tab.click();
  // Wait for the tab panel to render (networkidle is more deterministic than a fixed sleep).
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
}

async function clickDashboardMetricsTab(page) {
  const tab = page.getByRole("tab").filter({ hasText: "Metrics" }).first();
  await tab.waitFor({ state: "visible", timeout: 15_000 });
  await tab.click();
  // Wait for the metric sidebar to appear instead of a blind timeout.
  await page
    .locator('[data-test="telemetry-correlation-metric-stream-item"]')
    .first()
    .waitFor({ state: "visible", timeout: 20_000 })
    .catch(() => {});
}

async function clickDashboardTracesTab(page) {
  const tab = page.getByRole("tab").filter({ hasText: "Traces" }).first();
  await tab.waitFor({ state: "visible", timeout: 15_000 });
  await tab.click();
  // Wait for the traces tab content to settle instead of a blind timeout.
  await Promise.race([
    page
      .locator('[data-test="correlation-no-traces-state-drawer"]')
      .first()
      .waitFor({ state: "visible", timeout: 30_000 })
      .catch(() => {}),
    page
      .locator('[data-test="correlation-view-traces-page"]')
      .first()
      .waitFor({ state: "visible", timeout: 30_000 })
      .catch(() => {}),
    page
      .locator('[data-test="telemetry-correlation-dashboard-drawer"]')
      .first()
      .waitFor({ state: "visible", timeout: 30_000 }),
  ]);
}

// ── Metric stream sidebar ──────────────────────────────────────────

/** Wait for at least one metric stream item to be visible. */
async function expectMetricStreamItemsVisible(page) {
  await expect(
    page
      .locator('[data-test="telemetry-correlation-metric-stream-item"]')
      .first(),
  ).toBeVisible({ timeout: 30_000 });
}

/** Click the nth metric stream item (0-indexed). */
async function clickMetricStreamItem(page, index = 0) {
  const items = page.locator(
    '[data-test="telemetry-correlation-metric-stream-item"]',
  );
  const target = items.nth(index);
  await target.waitFor({ state: "visible", timeout: 15_000 });
  await target.click();
}

/**
 * Assert the nth metric stream item's checkbox is checked (selected).
 * The OCheckbox component renders with role="checkbox" and aria-checked.
 */
async function expectMetricStreamItemSelected(page, index = 0) {
  const item = page
    .locator('[data-test="telemetry-correlation-metric-stream-item"]')
    .nth(index);
  const checkbox = item.locator('[role="checkbox"]').first();
  await expect(checkbox).toHaveAttribute("aria-checked", "true", {
    timeout: 10_000,
  });
}

// ── Traces tab ─────────────────────────────────────────────────────

/**
 * Wait for traces tab content to settle. Accepts empty state, results,
 * or informational content. Asserts no error state.
 */
async function expectTracesContentLoaded(page) {
  // Wait for any of the expected trace-tab states.
  await Promise.race([
    page
      .locator('[data-test="correlation-no-traces-state-drawer"]')
      .first()
      .waitFor({ state: "visible", timeout: 30_000 })
      .catch(() => {}),
    page
      .locator('[data-test="correlation-view-traces-page"]')
      .first()
      .waitFor({ state: "visible", timeout: 30_000 })
      .catch(() => {}),
    page
      .locator('[data-test="telemetry-correlation-dashboard-drawer"]')
      .first()
      .waitFor({ state: "visible", timeout: 30_000 }),
  ]);
  // No error state should appear.
  await expect(
    page.locator('[data-test="error-state"]').first(),
  ).not.toBeVisible({ timeout: 5_000 });
}

// ── General safety assertions ──────────────────────────────────────

/** Assert the error-state element is NOT visible — general guard for
 *  any test that should render without error. */
async function expectNoErrorStateVisible(page) {
  await expect(
    page.locator('[data-test="error-state"]').first(),
  ).not.toBeVisible({ timeout: 5_000 });
}

// ── No-match informational message (embedded-tabs path) ────────────

/** Click the "Correlated Logs" tab in the DetailTable sidebar. */
async function clickCorrelatedLogsTab(page) {
  const tab = page.locator('[data-test="correlated-logs-tab"]').first();
  await tab.waitFor({ state: "visible", timeout: 15_000 });
  await tab.click();
  // Wait for the correlated-logs table or empty/error state to render.
  await Promise.race([
    page
      .locator('[data-test="correlated-logs-table"]')
      .first()
      .waitFor({ state: "visible", timeout: 15_000 })
      .catch(() => {}),
    page
      .locator('[data-test="empty-state"]')
      .first()
      .waitFor({ state: "visible", timeout: 15_000 })
      .catch(() => {}),
    page
      .locator('[data-test="error-state"]')
      .first()
      .waitFor({ state: "visible", timeout: 15_000 })
      .catch(() => {}),
  ]);
}

/** Assert the no-match message: the empty-state informational message
 *  IS visible (CorrelatedLogsTable renders data-test="empty-state" when
 *  no correlated service is found for a 200-null response) AND the
 *  error-state element is NOT visible.
 */
async function expectNoMatchMessageVisible(page) {
  // Positive assertion: the informational empty-state must render.
  await expect(
    page.locator('[data-test="empty-state"]').first(),
    "no-match path must show an informational empty state",
  ).toBeVisible({ timeout: 15_000 });
  // Negative guard: the error state must NOT appear.
  await expect(
    page.locator('[data-test="error-state"]').first(),
    "no-match path must not render an error state",
  ).not.toBeVisible({ timeout: 5_000 });
}

// ── Correlation settings page ─────────────────────────────────────

/** Navigate to the Correlation Settings page for a given org. */
async function navigateToCorrelationSettings(page, orgId) {
  await page.goto(
    `${UI_BASE_URL}/web/settings/correlation?org_identifier=${orgId}`,
    { waitUntil: "domcontentloaded" },
  );
  await page
    .locator('[data-test="correlation-settings-tabs"]')
    .waitFor({ state: "visible", timeout: 20_000 });
}

/** Click the "Discovered Services" tab on the correlation settings page. */
async function clickDiscoveredServicesTab(page) {
  const tab = page.getByRole("tab", { name: "Discovered Services" });
  await tab.click();
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
}

/** Click the "Detection Rules" tab on the correlation settings page. */
async function clickDetectionRulesTab(page) {
  const tab = page.getByRole("tab", { name: "Detection Rules" });
  await tab.click();
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
}

// ── Discovered Services detail drawer ──────────────────────────────

/**
 * Wait for the services table or empty state. Returns true if the services
 * table is visible (services found), false if empty state.
 */
async function waitForServicesTableOrEmpty(page) {
  try {
    await page
      .locator('[data-test="services-list-table"]')
      .waitFor({ state: "visible", timeout: 20_000 });
    return true;
  } catch {
    await page
      .locator('[data-test="discovered-services-empty-state"]')
      .waitFor({ state: "visible", timeout: 10_000 });
    return false;
  }
}

/**
 * Expand the first service group's collapse toggle and click the first
 * inner row to open the service detail side panel.
 */
async function openFirstServiceDetail(page) {
  // Expand the first service group if collapsed.
  const toggle = page
    .locator('[data-test="service-collapse-toggle"]')
    .first();
  if (await toggle.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await toggle.click();
    await page.waitForTimeout(500);
  }

  // Click the first inner row (skip the pivot header row at index 0).
  const rows = page.locator(
    '[data-test="services-list-table"] tbody tr',
  );
  const count = await rows.count();
  if (count > 1) {
    await rows.nth(1).click();
  } else if (count === 1) {
    await rows.first().click();
  }
}

/** Assert the service detail side panel (ODrawer) is visible. */
async function expectServiceSidePanelVisible(page) {
  await expect(
    page.locator('[data-test="service-side-panel"]').first(),
  ).toBeVisible({ timeout: 15_000 });
}

/** Assert the Discovered Services empty state is visible (no services
 *  discovered yet — tab loaded successfully but list is empty). */
async function expectDiscoveredServicesEmptyStateVisible(page) {
  await expect(
    page.locator('[data-test="discovered-services-empty-state"]').first(),
  ).toBeVisible({ timeout: 10_000 });
}

// ── Service Identity (Detection Rules) save ────────────────────────

/** Wait for the Save Configuration button to be visible on the Detection
 *  Rules tab. */
async function expectSaveConfigurationButtonVisible(page) {
  await page
    .getByRole("button", { name: "Save Configuration" })
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
}

/** Click the Save Configuration button. */
async function clickSaveConfiguration(page) {
  const btn = page
    .getByRole("button", { name: "Save Configuration" })
    .first();
  await btn.click();
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
}

/** Assert a success notification (toast) is visible. */
async function expectSuccessNotification(page) {
  await expect(
    page.locator('[role="alert"]').first(),
  ).toBeVisible({ timeout: 10_000 });
}

// ── K8s nested mode ────────────────────────────────────────────────

/**
 * Check whether Pods/Nodes outer tabs are visible (k8s nested mode).
 * Returns true if either tab is found.
 */
async function hasK8sNestedTabs(page) {
  const pods = page.getByRole("tab", { name: "Pods" });
  const nodes = page.getByRole("tab", { name: "Nodes" });
  const podsV = await pods.isVisible({ timeout: 3_000 }).catch(() => false);
  const nodesV = await nodes.isVisible({ timeout: 3_000 }).catch(() => false);
  return podsV || nodesV;
}

module.exports = {
  openFullDrawerDashboard,
  expectDashboardDrawerVisible,
  expectAllCorrelationTabsVisible,
  clickDashboardLogsTab,
  clickDashboardMetricsTab,
  clickDashboardTracesTab,
  expectMetricStreamItemsVisible,
  clickMetricStreamItem,
  expectMetricStreamItemSelected,
  expectTracesContentLoaded,
  expectNoErrorStateVisible,
  clickCorrelatedLogsTab,
  expectNoMatchMessageVisible,
  navigateToCorrelationSettings,
  clickDiscoveredServicesTab,
  clickDetectionRulesTab,
  waitForServicesTableOrEmpty,
  openFirstServiceDetail,
  expectServiceSidePanelVisible,
  expectDiscoveredServicesEmptyStateVisible,
  expectSaveConfigurationButtonVisible,
  clickSaveConfiguration,
  expectSuccessNotification,
  hasK8sNestedTabs,
};
