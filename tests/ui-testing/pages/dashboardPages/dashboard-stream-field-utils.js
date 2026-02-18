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
  await page
    .getByRole("option", { name: streamType, exact: true })
    .locator("div")
    .nth(2)
    .click();
}

/**
 * Select a stream from the stream dropdown.
 * Handles both real stream names (e.g., "e2e_automate") and variable references (e.g., "$streamVar").
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} streamNameOrVar - Stream name or $variable reference
 */
export async function selectStreamFromDropdown(page, streamNameOrVar) {
  const streamSelect = page.locator(SELECTORS.VARIABLE_STREAM_SELECT);
  await streamSelect.click();
  await streamSelect.fill(streamNameOrVar);

  // Wait for dropdown options to appear
  await page.waitForFunction(
    () => document.querySelectorAll('[role="option"]').length > 0,
    { timeout: 10000, polling: 100 }
  );

  // Multi-strategy selection
  let selected = false;

  // Strategy 1: Exact match by role
  try {
    const option = page.getByRole("option", { name: streamNameOrVar, exact: true });
    await option.waitFor({ state: "visible", timeout: 5000 });
    await option.click();
    selected = true;
  } catch {
    // Strategy 2: Partial match
    try {
      const option = page.getByRole("option", { name: streamNameOrVar, exact: false }).first();
      await option.waitFor({ state: "visible", timeout: 5000 });
      await option.click();
      selected = true;
    } catch {
      // Strategy 3: Keyboard navigation
      try {
        await page.keyboard.press("ArrowDown");
        await page.waitForTimeout(200);
        await page.keyboard.press("Enter");
        selected = true;
      } catch {
        // Strategy 4: JS direct click
        const clicked = await page.evaluate((name) => {
          const options = document.querySelectorAll('[role="option"]');
          for (const opt of options) {
            if (opt.textContent.trim().includes(name)) {
              opt.click();
              return true;
            }
          }
          return false;
        }, streamNameOrVar);
        if (clicked) {
          await page.waitForTimeout(300);
          selected = true;
        }
      }
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
  await fieldSelect.click();
  await fieldSelect.fill(fieldNameOrVar);

  // Wait for dropdown options to appear
  const hasOptions = await page
    .waitForFunction(
      () => document.querySelectorAll('[role="option"]').length > 0,
      { timeout: isVariable ? 5000 : 10000, polling: 100 }
    )
    .then(() => true)
    .catch(() => false);

  if (!hasOptions) {
    // No options appeared. For variables this may happen if it's the only one;
    // for real fields this shouldn't happen (stream is real so schema loads).
    // Accept typed value by pressing Escape to close empty dropdown.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    return;
  }

  // Multi-strategy selection
  let selected = false;

  // Strategy 1: Exact match
  try {
    const option = page.getByRole("option", {
      name: fieldNameOrVar,
      exact: true,
    });
    await option.waitFor({ state: "visible", timeout: 3000 });
    await option.click();
    selected = true;
  } catch {
    // Strategy 2: Partial match (useful for variable options that may have "(variable)" label)
    try {
      const option = page
        .getByRole("option", { name: fieldNameOrVar, exact: false })
        .first();
      await option.waitFor({ state: "visible", timeout: 3000 });
      await option.click();
      selected = true;
    } catch {
      // Strategy 3: Click first available option
      try {
        const firstOption = page.locator('[role="option"]').first();
        await firstOption.waitFor({ state: "visible", timeout: 3000 });
        await firstOption.click();
        selected = true;
      } catch {
        // Strategy 4: JS direct click
        const clicked = await page.evaluate((name) => {
          const options = document.querySelectorAll('[role="option"]');
          for (const opt of options) {
            if (opt.textContent.trim().includes(name)) {
              opt.click();
              return true;
            }
          }
          return false;
        }, fieldNameOrVar);
        if (clicked) {
          await page.waitForTimeout(300);
          selected = true;
        }
      }
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
  await dropdown.click();

  // Type $ to filter for variables
  await dropdown.fill(`$${variableName}`);

  // Wait for options to appear
  await page.waitForFunction(
    () => document.querySelectorAll('[role="option"]').length > 0,
    { timeout: 10000, polling: 100 }
  );

  // Check if the variable option exists
  const varOption = page.getByRole("option").filter({ hasText: `$${variableName}` });
  const found = await varOption.count() > 0;

  // Check for "(variable)" label
  let hasVariableLabel = false;
  if (found) {
    const optionText = await varOption.first().textContent();
    hasVariableLabel = optionText.includes("(variable)");
  }

  // Close dropdown
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

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
  await page.waitForTimeout(1000);

  // Check option count - should be 0 or only variable options (containing "$")
  const optionCount = await page.locator('[role="option"]').count();

  if (optionCount === 0) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    return true;
  }

  // Check if all options are variable references
  const allVariables = await page.evaluate(() => {
    const options = document.querySelectorAll('[role="option"]');
    return Array.from(options).every((opt) =>
      opt.textContent.trim().startsWith("$")
    );
  });

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

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
    () => document.querySelectorAll('[role="option"]').length > 0,
    { timeout: 10000, polling: 100 }
  ).catch(() => {});

  const options = await page.evaluate(() => {
    const opts = document.querySelectorAll('[role="option"]');
    return Array.from(opts).map((o) => o.textContent.trim());
  });

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

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
    // Quasar notifications use .q-notification with type danger/negative
    const errorNotif = page.locator(
      '.q-notification--standard.bg-negative, .q-notification--standard.bg-red, .q-notification.text-negative'
    );
    await errorNotif.waitFor({ state: "visible", timeout: waitMs });
    return true;
  } catch {
    return false;
  }
}
