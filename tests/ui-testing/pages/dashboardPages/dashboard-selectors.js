/**
 * Dashboard Common Selectors - Centralized selector definitions
 *
 * Purpose: Eliminates raw selectors scattered across spec files,
 * providing a single source of truth for all dashboard UI selectors.
 *
 * Usage in spec files:
 *   const { SELECTORS, getVariableSelector } = require("../../pages/dashboardPages/dashboard-selectors.js");
 *   await page.locator(SELECTORS.DIALOG).waitFor({ state: "visible" });
 *   await page.locator(getVariableSelector("myVar")).click();
 */

/**
 * Static selectors - Quasar Framework UI components
 */
const QUASAR = {
  // Dialog components
  DIALOG: '.q-dialog',
  DIALOG_CARD: '.q-dialog .q-card',

  // Menu/Dropdown components
  MENU: '.q-menu',
  MENU_ITEM: '.q-item',

  // Form components
  CHECKBOX: '.q-checkbox',
  CHECKBOX_CHECKED: '.q-checkbox[aria-checked="true"]',
  CHECKBOX_UNCHECKED: '.q-checkbox[aria-checked="false"]',

  // Loading indicators
  SPINNER: '.q-spinner',
  LINEAR_PROGRESS: '.q-linear-progress',

  // Chip/Badge components
  CHIP: '.q-chip',

  // Tooltip
  TOOLTIP: '.q-tooltip',
};

/**
 * Static selectors - Dashboard data-test attributes
 */
const DASHBOARD = {
  // Dashboard main buttons
  SETTING_BTN: '[data-test="dashboard-setting-btn"]',
  REFRESH_BTN: '[data-test="dashboard-refresh-btn"]',
  SEARCH: '[data-test="dashboard-search"]',
  ADD_PANEL_BTN: '[data-test="dashboard-if-no-panel-add-panel-btn"]',

  // Dashboard settings dialog
  SETTINGS_DIALOG: '[data-test="dashboard-settings-dialog"]',
  SETTINGS_CLOSE_BTN: '[data-test="dashboard-settings-close-btn"]',

  // Variables tab in settings
  VARIABLE_TAB: '[data-test="dashboard-settings-variable-tab"]',
  ADD_VARIABLE_BTN: '[data-test="dashboard-add-variable-btn"]',
  VARIABLE_DRAG: '[data-test="dashboard-variable-settings-drag"]',
  VARIABLE_DRAGGABLE_ROW: '[data-test="dashboard-variable-settings-draggable-row"]',

  // Variable form fields
  VARIABLE_NAME: '[data-test="dashboard-variable-name"]',
  VARIABLE_SCOPE_SELECT: '[data-test="dashboard-variable-scope-select"]',
  VARIABLE_TABS_SELECT: '[data-test="dashboard-variable-tabs-select"]',
  VARIABLE_PANELS_SELECT: '[data-test="dashboard-variable-panels-select"]',
  VARIABLE_STREAM_TYPE_SELECT: '[data-test="dashboard-variable-stream-type-select"]',
  VARIABLE_STREAM_SELECT: '[data-test="dashboard-variable-stream-select"]',
  VARIABLE_FIELD_SELECT: '[data-test="dashboard-variable-field-select"]',
  VARIABLE_SAVE_BTN: '[data-test="dashboard-variable-save-btn"]',
  VARIABLE_HIDE_ON_DASHBOARD: '[data-test="dashboard-variable-hide_on_dashboard"]',

  // Variable filter configuration
  ADD_FILTER_BTN: '[data-test="dashboard-add-filter-btn"]',
  FILTER_NAME_SELECTOR: '[data-test="dashboard-query-values-filter-name-selector"]',
  FILTER_OPERATOR_SELECTOR: '[data-test="dashboard-query-values-filter-operator-selector"]',

  // Variable options
  SHOW_MULTIPLE_VALUES: '[data-test="dashboard-query_values-show_multiple_values"]',
  CUSTOM_VALUE_TOGGLE: '[data-test="dashboard-multi-select-default-value-toggle-custom"]',
  ADD_CUSTOM_VALUE_BTN: '[data-test="dashboard-add-custom-value-btn"]',
  CUSTOM_VALUE_INPUT: (index) => `[data-test="dashboard-variable-custom-value-${index}"]`,

  // Panels
  PANEL_CONTAINER: '[data-test="dashboard-panel-container"]',
  PANEL_REFRESH_BTN: '[data-test="dashboard-panel-refresh-panel-btn"]',
  PANEL_ANY: '[data-test*="dashboard-panel-"]', // Wildcard match for any panel

  // Common autocomplete
  AUTO_COMPLETE: '[data-test="common-auto-complete"]',
  AUTO_COMPLETE_OPTION: '[data-test="common-auto-complete-option"]',

  // Chart type selection
  CHART_LINE_ITEM: '[data-test="selected-chart-line-item"]',
  APPLY_BTN: '[data-test="dashboard-apply"]',

  // Date/Time
  DATE_TIME_BTN: '[data-test="date-time-btn"]',
  DATE_TIME_RELATIVE_6H: '[data-test="date-time-relative-6-h-btn"]',
};

/**
 * Role-based selectors (ARIA)
 */
const ROLES = {
  OPTION: '[role="option"]',
  ROLE_OPTION: '[role="option"]', // Alias for clarity
  LISTBOX: '[role="listbox"]',
  ROLE_LISTBOX: '[role="listbox"]', // Alias for clarity
  TOOLTIP: '[role="tooltip"]',
};

/**
 * Inspector/Debug selectors
 */
const INSPECTOR = {
  QUERY_EDITOR: '.inspector-query-editor',
};

/**
 * Combined SELECTORS export for easy access
 */
const SELECTORS = {
  ...QUASAR,
  ...DASHBOARD,
  ...ROLES,
  ...INSPECTOR,
  // Keep QUASAR as nested object for explicit access like SELECTORS.QUASAR.DIALOG
  QUASAR,
};

/**
 * Dynamic selector functions - generate selectors with interpolated values
 */

/**
 * Get variable selector dropdown by name
 * @param {string} variableName - Variable name
 * @returns {string} Selector string
 */
function getVariableSelector(variableName) {
  return `[data-test="variable-selector-${variableName}"]`;
}

/**
 * Get variable selector inner element by name
 * @param {string} variableName - Variable name
 * @returns {string} Selector string
 */
function getVariableSelectorInner(variableName) {
  return `[data-test="variable-selector-${variableName}-inner"]`;
}

/**
 * Get edit variable button by name
 * @param {string} variableName - Variable name
 * @returns {string} Selector string
 */
function getEditVariableBtn(variableName) {
  return `[data-test="dashboard-edit-variable-${variableName}"]`;
}

/**
 * Get delete variable button by name
 * @param {string} variableName - Variable name
 * @returns {string} Selector string
 */
function getDeleteVariableBtn(variableName) {
  return `[data-test="dashboard-delete-variable-${variableName}"]`;
}

/**
 * Get variable loading indicator by name
 * @param {string} variableName - Variable name
 * @returns {string} Selector string
 */
function getVariableLoadingIndicator(variableName) {
  return `[data-test="variable-selector-${variableName}"] .q-spinner, [data-test="variable-selector-${variableName}"] .q-linear-progress`;
}

/**
 * Get panel by ID
 * @param {string} panelId - Panel ID
 * @returns {string} Selector string
 */
function getPanelById(panelId) {
  return `[data-test-panel-id="${panelId}"]`;
}

/**
 * Get panel refresh button by panel ID
 * @param {string} panelId - Panel ID
 * @returns {string} Selector string
 */
function getPanelRefreshBtn(panelId) {
  return `[data-test-panel-id="${panelId}"] [data-test="dashboard-panel-refresh-panel-btn"]`;
}

/**
 * Get menu item by text (case-insensitive)
 * Uses filter pattern: .q-item filter hasText
 * @param {string} text - Item text
 * @param {boolean} exact - Use exact match (default: true)
 * @returns {Object} Object with selector and filter pattern
 */
function getMenuItemByText(text, exact = true) {
  // Escape regex metacharacters for safe text matching
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = exact ? new RegExp(`^${escaped}$`) : new RegExp(escaped);
  return {
    selector: QUASAR.MENU_ITEM,
    filter: { hasText: pattern }
  };
}

/**
 * Get dialog filtered by text content
 * @param {string} text - Dialog title/content text
 * @returns {Object} Object with selector and filter pattern
 */
function getDialogByText(text) {
  return {
    selector: QUASAR.DIALOG,
    filter: { hasText: text }
  };
}

/**
 * Get dashboard variable element by name
 * @param {string} variableName - Variable name
 * @returns {string} Selector string
 */
function getDashboardVariable(variableName) {
  return `[data-test="dashboard-variable-${variableName}"]`;
}

/**
 * Get variable error indicator by name
 * @param {string} variableName - Variable name
 * @returns {string} Selector string
 */
function getVariableError(variableName) {
  return `[data-test="dashboard-variable-${variableName}-error"]`;
}

/**
 * Get variable state indicator by name
 * @param {string} variableName - Variable name
 * @returns {string} Selector string
 */
function getVariableState(variableName) {
  return `[data-test="dashboard-variable-${variableName}-state"]`;
}

/**
 * Get tab selector by tab title
 * @param {string} tabTitle - Tab title (e.g., "Tab1", "Tab2")
 * @returns {string} Selector string
 */
function getTabSelector(tabTitle) {
  return `span[data-test*="dashboard-tab-"][title="${tabTitle}"]`;
}

/**
 * Common helper: Select stream type, stream name, and field for a variable.
 *
 * This is the SINGLE source of truth for the stream/field selection sequence.
 * All page objects (DashboardVariables, DashboardVariablesScoped, DashboardSettings)
 * should call this function instead of duplicating the selector logic.
 *
 * When the CommonAutoComplete component or stream/field selectors change,
 * only this function needs to be updated.
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {string} streamType - Stream type (e.g., "logs", "metrics", "traces")
 * @param {string} streamName - Stream name (e.g., "e2e_automate")
 * @param {string} field - Field name (e.g., "kubernetes_namespace_name")
 * @param {Object} options - Additional options
 * @param {number} options.timeout - Timeout for waiting on elements (default: 10000)
 * @param {number} options.fieldLoadDelay - Wait time after stream selection for fields to load (default: 0)
 */
async function selectStreamAndField(page, streamType, streamName, field, options = {}) {
  const { timeout = 10000, fieldLoadDelay = 0 } = options;

  // 1. Select Stream Type
  await page
    .locator(DASHBOARD.VARIABLE_STREAM_TYPE_SELECT)
    .click();
  await page
    .getByRole("option", { name: streamType, exact: true })
    .locator("div")
    .nth(2)
    .click();

  // 2. Select Stream (CommonAutoComplete component)
  // Use .first() because CommonAutoComplete renders data-test on both root div and q-input
  const streamSelect = page.locator(DASHBOARD.VARIABLE_STREAM_SELECT).first();
  await streamSelect.click();
  await streamSelect.locator('input').fill(streamName);
  // Wait for and click the matching CommonAutoComplete option
  const streamOption = page.locator(DASHBOARD.AUTO_COMPLETE_OPTION)
    .filter({ hasText: streamName }).first();
  await streamOption.waitFor({ state: "visible", timeout });
  await streamOption.click();

  // Optional delay for field data to load after stream selection
  if (fieldLoadDelay > 0) {
    await page.waitForTimeout(fieldLoadDelay);
  }

  // 3. Select Field (CommonAutoComplete component)
  // Use .first() because CommonAutoComplete renders data-test on both root div and q-input
  const fieldSelect = page.locator(DASHBOARD.VARIABLE_FIELD_SELECT).first();
  if (fieldLoadDelay > 0) {
    await fieldSelect.waitFor({ state: "visible", timeout });
  }
  await fieldSelect.click();
  await fieldSelect.locator('input').fill(field);
  // Wait for and click the matching CommonAutoComplete option
  const fieldOption = page.locator(DASHBOARD.AUTO_COMPLETE_OPTION)
    .filter({ hasText: field }).first();
  await fieldOption.waitFor({ state: "visible", timeout });
  await fieldOption.click();
}

module.exports = {
  // Selector groups
  QUASAR,
  DASHBOARD,
  ROLES,
  INSPECTOR,
  SELECTORS,

  // Dynamic selector functions
  getVariableSelector,
  getVariableSelectorInner,
  getEditVariableBtn,
  getDeleteVariableBtn,
  getVariableLoadingIndicator,
  getPanelById,
  getPanelRefreshBtn,
  getMenuItemByText,
  getDialogByText,
  getDashboardVariable,
  getVariableError,
  getVariableState,
  getTabSelector,

  // Common helpers
  selectStreamAndField,
};
