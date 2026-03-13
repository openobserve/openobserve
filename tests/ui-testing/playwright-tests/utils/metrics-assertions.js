const { expect } = require('@playwright/test');

/**
 * Shared helper function to verify data visualization on UI
 * Complies with Page Object Model pattern by using page object methods
 *
 * @param {PageManager} pm - PageManager instance with metricsPage
 * @param {string} testName - Name of the test for logging purposes
 * @param {boolean} assertOnFailure - If true, throws assertion on no visualization (default: false)
 * @returns {Promise<{hasVisualization: boolean, hasNoData: boolean}>}
 */
async function verifyDataOnUI(pm, testName, assertOnFailure = false) {
  const hasVisualization = await pm.metricsPage.verifyDataVisualization(testName);

  // Only assert if explicitly requested (for tests that expect data)
  if (assertOnFailure) {
    expect(hasVisualization).toBeTruthy();
  }

  return { hasVisualization, hasNoData: !hasVisualization };
}

/**
 * Enhanced version with additional value checks
 * Used in aggregations tests for more thorough validation
 *
 * @param {PageManager} pm - PageManager instance with metricsPage
 * @param {string} testName - Name of the test for logging purposes
 * @param {boolean} assertOnFailure - If true, throws assertion on no visualization (default: true for this method)
 * @returns {Promise<{hasVisualization: boolean, hasNoData: boolean}>}
 */
async function verifyDataOnUIWithValues(pm, testName, assertOnFailure = true) {
  const hasVisualization = await pm.metricsPage.verifyDataVisualization(testName);

  // Assert by default for this enhanced validation method
  if (assertOnFailure) {
    expect(hasVisualization).toBeTruthy();
  }

  // Additional validation - check for actual data values (not just presence)
  const hasDataValues = await pm.metricsPage.hasDataValues();
  if (hasDataValues) {
    const dataValue = await pm.metricsPage.getFirstDataValue();
    if (assertOnFailure) {
      expect(dataValue).toBeTruthy(); // Should have actual data value
      expect(dataValue.trim().length).toBeGreaterThan(0); // Value should not be empty
    }
  }

  return { hasVisualization, hasNoData: !hasVisualization };
}

module.exports = {
  verifyDataOnUI,
  verifyDataOnUIWithValues
};
