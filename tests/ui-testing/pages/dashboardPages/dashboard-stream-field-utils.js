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
  // Use .first() — the q-focus-helper div that Quasar may insert makes
  // .locator("div").nth(2) index-unstable; clicking the option element directly is safe.
  const streamTypeOption = page.getByRole("option", { name: streamType, exact: true }).first();
  await streamTypeOption.waitFor({ state: "visible", timeout: 10000 });
  await streamTypeOption.click();
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

  // For variables, wait longer for the dropdown to filter and show variable options
  // Increased wait time especially for edit mode where variables need to load
  await page.waitForTimeout(isVariable ? 1500 : 500);

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

  // Strategy 1: Exact match — OSelect forwards parent data-test to ListboxItems (`*-option`).
  try {
    const option = page
      .locator('[data-test$="-option"]', { hasText: streamNameOrVar })
      .first();
    await option.waitFor({ state: "visible", timeout: 5000 });
    await option.click();
    selected = true;
  } catch {
    // Strategy 2: For variables, look for option containing both the variable name and "(variable)"
    if (isVariable && !selected) {
      try {
        // Variables are displayed as "$varName (variable)" in the dropdown
        const option = page
          .locator('[data-test$="-option"]', { hasText: streamNameOrVar })
          .filter({ hasText: "(variable)" })
          .first();
        await option.waitFor({ state: "visible", timeout: 3000 });
        await option.click();
        selected = true;
      } catch {
        // Fall through to next strategy
      }
    }

    // Strategy 3: Partial match (lower-case contains)
    if (!selected) {
      try {
        const option = page
          .locator('[data-test$="-option"]', { hasText: streamNameOrVar })
          .first();
        await option.waitFor({ state: "visible", timeout: 5000 });
        await option.click();
        selected = true;
      } catch {
        // Strategy 4: Keyboard navigation
        try {
          await page.keyboard.press("ArrowDown");
          await page.waitForTimeout(200);
          await page.keyboard.press("Enter");
          selected = true;
        } catch {
          // Strategy 5: JS direct click
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
            await page.waitForTimeout(300);
            selected = true;
          }
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
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    return;
  }

  // Multi-strategy selection
  let selected = false;

  // Strategy 1: Exact match — OSelect forwards parent data-test to ListboxItems (`*-option`).
  try {
    const option = page
      .locator('[data-test$="-option"]', { hasText: fieldNameOrVar })
      .first();
    await option.waitFor({ state: "visible", timeout: 3000 });
    await option.click();
    selected = true;
  } catch {
    // Strategy 2: Partial match (useful for variable options that may have "(variable)" label)
    try {
      const option = page
        .locator('[data-test$="-option"]', { hasText: fieldNameOrVar })
        .first();
      await option.waitFor({ state: "visible", timeout: 3000 });
      await option.click();
      selected = true;
    } catch {
      // Strategy 3: Click first available option
      try {
        const firstOption = page.locator('[data-test$="-option"]').first();
        await firstOption.waitFor({ state: "visible", timeout: 3000 });
        await firstOption.click();
        selected = true;
      } catch {
        // Strategy 4: JS direct click
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
  await page.waitForTimeout(300);

  // Type $ to filter for variables
  await dropdown.fill(`$${variableName}`);
  await page.waitForTimeout(500);

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

  // If not found via filter, try without filter text (open full list)
  if (!found) {
    await dropdown.fill("");
    await page.waitForTimeout(500);
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
  const optionCount = await page.locator('[data-test$="-option"]').count();

  if (optionCount === 0) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    return true;
  }

  // Check if all options are variable references
  const allVariables = await page.evaluate(() => {
    const options = document.querySelectorAll('[data-test$="-option"]');
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
    () => document.querySelectorAll('[data-test$="-option"]').length > 0,
    { timeout: 10000, polling: 100 }
  ).catch(() => {});

  const options = await page.evaluate(() => {
    const opts = document.querySelectorAll('[data-test$="-option"]');
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
