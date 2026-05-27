/**
 * Dashboard Stream & Field Selection Utilities
 *
 * Common functions for selecting streams and fields in dashboard variable forms.
 * Handles both real stream/field names AND $variable references.
 * Designed to be imported by any page object (DashboardVariablesScoped, DashboardVariables, DashboardSetting).
 *
 * Usage:
 *   import { selectStreamFromDropdown, selectFieldFromDropdown } from "./dashboard-stream-field-utils.js";
 *   await selectStreamFromDropdown(page, "e2e_automate");     // real stream
 *   await selectStreamFromDropdown(page, "$streamVar");        // variable reference
 */

import { SELECTORS } from "./dashboard-selectors.js";

/**
 * Select a stream type from the stream type dropdown (logs, metrics, traces)
 * @param {import('@playwright/test').Page} page
 * @param {string} streamType - Stream type to select (e.g., "logs", "metrics", "traces")
 */
export async function selectStreamType(page, streamType) {
  await page
    .locator(SELECTORS.VARIABLE_STREAM_TYPE_SELECT)
    .click();
  // Use data-test-value selector — OSelect emits `${parentDataTest}-option` with `data-test-value` per item.
  await page.locator('[data-test="dashboard-variable-stream-type-select-popover"]').waitFor({ state: 'visible', timeout: 5000 });
  const streamTypeOption = page.locator(`[data-test="dashboard-variable-stream-type-select-option"][data-test-value="${streamType}"]`);
  await streamTypeOption.waitFor({ state: "visible", timeout: 10000 });
  await streamTypeOption.click();
  await page.locator('[data-test="dashboard-variable-stream-type-select-popover"]').waitFor({ state: 'hidden', timeout: 5000 });
}

/**
 * Select a stream from the stream dropdown.
 * Handles both real stream names (e.g., "e2e_automate") and variable references (e.g., "$streamVar").
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} streamNameOrVar - Stream name or $variable reference
 */
export async function selectStreamFromDropdown(page, streamNameOrVar) {
  const isVariable = streamNameOrVar.startsWith("$");
  const streamSelect = page.locator(SELECTORS.VARIABLE_STREAM_SELECT);
  // Search input lives inside the popover (OSelect searchable pattern)
  const streamInput = page.locator('[data-test="dashboard-variable-stream-select-popover"] input');
  await streamSelect.click();

  // Wait for popover search input to be visible, then fill
  await streamInput.waitFor({ state: "visible", timeout: 5000 });
  await streamInput.fill(streamNameOrVar);

  // Wait for dropdown options to appear
  const hasOptions = await page
    .waitForFunction(
      () => document.querySelectorAll('[data-test$="-option"]').length > 0,
      { timeout: isVariable ? 8000 : 10000, polling: 100 }
    )
    .then(() => true)
    .catch(() => false);

  // If no options appeared initially, try alternate strategies
  if (!hasOptions && !isVariable) {
    // For real streams (not variables), this is an error
    throw new Error(`No dropdown options appeared for stream: ${streamNameOrVar}`);
  }

  // For variables without options, the value should already be in the input.
  // We'll proceed to try selection strategies anyway in case options load late.

  // Multi-strategy selection
  let selected = false;

  // Strategy 1: data-test-value exact match — OSelect sets data-test-value per option item.
  try {
    const option = page
      .locator(`[data-test$="-option"][data-test-value="${streamNameOrVar}"]`)
      .first();
    await option.waitFor({ state: "visible", timeout: 5000 });
    await option.click();
    selected = true;
  } catch {
    // Strategy 2: JS direct click by text content (fallback for variable references)
    const clicked = await page.evaluate((name) => {
      const options = document.querySelectorAll('[data-test$="-option"]');
      for (const opt of options) {
        if (opt.textContent.trim().includes(name)) {
          opt.click();
          return true;
        }
      }
      return false;
    }, streamNameOrVar);
    if (clicked) {
      selected = true;
    }
  }

  if (!selected) {
    throw new Error(`Failed to select stream: ${streamNameOrVar}`);
  }
}

/**
 * Select a field from the field dropdown.
 * Handles both real field names (e.g., "kubernetes_namespace_name") and variable references (e.g., "$fieldVar").
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} fieldNameOrVar - Field name or $variable reference
 */
export async function selectFieldFromDropdown(page, fieldNameOrVar) {
  const isVariable = fieldNameOrVar.startsWith("$");
  const fieldSelect = page.locator(SELECTORS.VARIABLE_FIELD_SELECT);
  const fieldInput = page.locator('[data-test="dashboard-variable-field-select-popover"] input');
  await fieldSelect.click();
  await fieldInput.waitFor({ state: "visible", timeout: 5000 });
  await fieldInput.fill(fieldNameOrVar);

  // Wait for dropdown options to appear
  const hasOptions = await page
    .waitForFunction(
      () => document.querySelectorAll('[data-test$="-option"]').length > 0,
      { timeout: isVariable ? 5000 : 10000, polling: 100 }
    )
    .then(() => true)
    .catch(() => false);

  if (!hasOptions) {
    // No options appeared. For variables this may happen if it's the only one;
    // for real fields this shouldn't happen (stream is real so schema loads).
    // Accept typed value by pressing Escape to close empty dropdown.
    await page.keyboard.press('Escape');
    await page.locator('[data-test="dashboard-variable-field-select-popover"]').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    return;
  }

  // Multi-strategy selection
  let selected = false;

  // Strategy 1: data-test-value exact match — OSelect sets data-test-value per option item.
  try {
    const option = page
      .locator(`[data-test$="-option"][data-test-value="${fieldNameOrVar}"]`)
      .first();
    await option.waitFor({ state: "visible", timeout: 3000 });
    await option.click();
    selected = true;
  } catch {
    // Strategy 2: JS direct click by text content (fallback for variable references)
    const clicked = await page.evaluate((name) => {
      const options = document.querySelectorAll('[data-test$="-option"]');
      for (const opt of options) {
        if (opt.textContent.trim().includes(name)) {
          opt.click();
          return true;
        }
      }
      return false;
    }, fieldNameOrVar);
    if (clicked) {
      selected = true;
    }
  }

  if (!selected) {
    throw new Error(`Failed to select field: ${fieldNameOrVar}`);
  }
}

/**
 * Verify that a variable appears in a dropdown alongside real options.
 * The variable should show as "$variableName" with a "(variable)" label.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} dropdownSelector - data-test selector for the dropdown
 * @param {string} variableName - Variable name (without $ prefix)
 * @returns {Promise<{found: boolean, hasVariableLabel: boolean}>}
 */
export async function verifyDropdownContainsVariable(page, dropdownSelector, variableName) {
  const dropdown = page.locator(dropdownSelector);

  // Derive the popover search input selector — dropdownSelector is e.g.
  // '[data-test="dashboard-variable-stream-select"]' → popover input is
  // '[data-test="dashboard-variable-stream-select-popover"] input'
  const dataTestMatch = dropdownSelector.match(/data-test="([^"]+)"/);
  const searchInputSelector = dataTestMatch
    ? `[data-test="${dataTestMatch[1]}-popover"] input`
    : null;

  await dropdown.click();

  // Type $ to filter for variables using the popover search input
  if (searchInputSelector) {
    const searchInput = page.locator(searchInputSelector);
    await searchInput.waitFor({ state: 'visible', timeout: 5000 });
    await searchInput.fill(`$${variableName}`);
  }

  // Wait for options to appear
  const hasOptions = await page
    .waitForFunction(
      () => document.querySelectorAll('[data-test$="-option"]').length > 0,
      { timeout: 10000, polling: 100 }
    )
    .then(() => true)
    .catch(() => false);

  let found = false;
  let hasVariableLabel = false;

  if (hasOptions) {
    // Use page.evaluate for reliable DOM inspection (avoids Playwright visibility heuristics)
    const result = await page.evaluate((varName) => {
      const options = document.querySelectorAll('[data-test$="-option"]');
      for (const opt of options) {
        const rect = opt.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const text = opt.textContent || "";
        if (text.includes(`$${varName}`)) {
          return { found: true, hasVariableLabel: text.includes("(variable)") };
        }
      }
      return { found: false, hasVariableLabel: false };
    }, variableName);
    found = result.found;
    hasVariableLabel = result.hasVariableLabel;
  }

  // If not found via filter, clear and retry with full list
  if (!found && searchInputSelector) {
    const searchInput = page.locator(searchInputSelector);
    await searchInput.fill("");
    const retryResult = await page.evaluate((varName) => {
      const options = document.querySelectorAll('[data-test$="-option"]');
      for (const opt of options) {
        const rect = opt.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const text = opt.textContent || "";
        if (text.includes(`$${varName}`)) {
          return { found: true, hasVariableLabel: text.includes("(variable)") };
        }
      }
      return { found: false, hasVariableLabel: false };
    }, variableName);
    found = retryResult.found;
    hasVariableLabel = retryResult.hasVariableLabel;
  }

  // Close dropdown — only press Escape if the popover is still open.
  // page.evaluate() above can cause focus loss that closes the popover early;
  // pressing Escape on a closed popover would propagate to the parent dialog.
  const popoverStillOpen = dataTestMatch
    ? await page.locator(`[data-test="${dataTestMatch[1]}-popover"]`).isVisible()
    : true;
  if (popoverStillOpen) {
    await page.keyboard.press('Escape');
    if (dataTestMatch) {
      await page
        .locator(`[data-test="${dataTestMatch[1]}-popover"]`)
        .waitFor({ state: 'hidden', timeout: 3000 })
        .catch(() => {});
    }
  }

  return { found, hasVariableLabel };
}

/**
 * Check if the field dropdown is empty (no schema-based options) when stream is a variable reference.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<boolean>} true if dropdown has no schema-based field options
 */
export async function verifyFieldDropdownEmptyOrVariablesOnly(page) {
  const fieldSelect = page.locator(SELECTORS.VARIABLE_FIELD_SELECT);
  await fieldSelect.click();
  await page.locator('[data-test="dashboard-variable-field-select-popover"]').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

  // Check option count - should be 0 or only variable options (containing "$")
  const optionCount = await page.locator('[data-test$="-option"]').count();

  if (optionCount === 0) {
    await page.keyboard.press('Escape');
    await page.locator('[data-test="dashboard-variable-field-select-popover"]').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    return true;
  }

  // Check if all options are variable references
  const allVariables = await page.evaluate(() => {
    const options = document.querySelectorAll('[data-test$="-option"]');
    return Array.from(options).every((opt) =>
      opt.textContent.trim().startsWith("$")
    );
  });

  await page.keyboard.press('Escape');
  await page.locator('[data-test="dashboard-variable-field-select-popover"]').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});

  return optionCount === 0 || allVariables;
}

/**
 * Get all dropdown options as text array
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} dropdownSelector - data-test selector for the dropdown
 * @returns {Promise<string[]>}
 */
export async function getDropdownOptions(page, dropdownSelector) {
  const dropdown = page.locator(dropdownSelector);
  await dropdown.click();

  await page.waitForFunction(
    () => document.querySelectorAll('[data-test$="-option"]').length > 0,
    { timeout: 10000, polling: 100 }
  ).catch(() => {});

  const options = await page.evaluate(() => {
    const opts = document.querySelectorAll('[data-test$="-option"]');
    return Array.from(opts).map((o) => o.textContent.trim());
  });

  await page.keyboard.press('Escape');

  return options;
}

/**
 * Check if any error notification is currently visible on the page
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} waitMs - Time to wait for notification to appear (default: 3000)
 * @returns {Promise<boolean>} true if an error notification is visible
 */
export async function hasErrorNotification(page, waitMs = 3000) {
  try {
    // ONotification (Reka UI) uses role="alert" with bg-negative/bg-red classes
    const errorNotif = page.locator(
      '[role="alert"][class*="bg-negative"], [role="alert"][class*="bg-red"], [data-test*="notification"][class*="negative"]'
    );
    await errorNotif.waitFor({ state: "visible", timeout: waitMs });
    return true;
  } catch {
    return false;
  }
}
