/**
 * Query Inspector Helper Utilities
 * Provides reusable functions for interacting with and verifying query inspector data
 */

import { expect } from "playwright/test";
import testLogger from '../../utils/test-logger.js';

/**
 * Open the query inspector in Add/Edit/View panel mode
 * @param {Object} page - Playwright page object
 */
export async function openQueryInspector(page) {
  testLogger.info('Opening query inspector');

  await page.locator('[data-test="dashboard-panel-data-view-query-inspector-btn"]').click();
  await page.waitForTimeout(1000);

  // Wait for query inspector to be visible
  await page.locator('.tw\\:text-xl:has-text("Query Inspector")').waitFor({
    state: "visible",
    timeout: 5000
  });

  testLogger.info('Query inspector opened successfully');
}

/**
 * Close the query inspector
 * @param {Object} page - Playwright page object
 */
export async function closeQueryInspector(page) {
  testLogger.info('Closing query inspector');

  await page.locator('[data-test="query-inspector-close-btn"]').click();
  await page.waitForTimeout(500);

  testLogger.info('Query inspector closed successfully');
}

/**
 * Get the start time and end time from query inspector
 * @param {Object} page - Playwright page object
 * @param {number} queryIndex - Query index (default: 0 for first query)
 * @returns {Promise<Object>} - { startTime, endTime, startTimeText, endTimeText }
 */
export async function getQueryInspectorDateTime(page, queryIndex = 0) {
  testLogger.info('Getting date time from query inspector', { queryIndex });

  // Get all Start Time and End Time sections
  const startTimeSections = page.locator('.tw\\:space-y-1:has-text("Start Time")');
  const endTimeSections = page.locator('.tw\\:space-y-1:has-text("End Time")');

  // Get the specific query's time sections (0-indexed)
  const startTimeSection = startTimeSections.nth(queryIndex);
  const endTimeSection = endTimeSections.nth(queryIndex);

  // Verify they are visible
  await expect(startTimeSection).toBeVisible({ timeout: 5000 });
  await expect(endTimeSection).toBeVisible({ timeout: 5000 });

  // Get the full text content
  const startTimeText = await startTimeSection.textContent();
  const endTimeText = await endTimeSection.textContent();

  // Extract timestamp and formatted date from the text
  // Format: "Start Time1771181893774000 (2026-02-16 00:28:13.774 Asia/Calcutta)"
  const startTimeMatch = startTimeText.match(/(\d+)\s*\(([^)]+)\)/);
  const endTimeMatch = endTimeText.match(/(\d+)\s*\(([^)]+)\)/);

  const result = {
    startTime: startTimeMatch ? startTimeMatch[1] : null,
    endTime: endTimeMatch ? endTimeMatch[1] : null,
    startTimeFormatted: startTimeMatch ? startTimeMatch[2].trim() : null,
    endTimeFormatted: endTimeMatch ? endTimeMatch[2].trim() : null,
    startTimeText: startTimeText.trim(),
    endTimeText: endTimeText.trim(),
  };

  testLogger.info('Retrieved date time from query inspector', result);

  return result;
}

/**
 * Verify that query inspector shows time values (not empty)
 * @param {Object} page - Playwright page object
 * @param {number} queryIndex - Query index (default: 0)
 */
export async function assertQueryInspectorHasDateTime(page, queryIndex = 0) {
  testLogger.info('Asserting query inspector has date time', { queryIndex });

  const dateTime = await getQueryInspectorDateTime(page, queryIndex);

  // Verify both start and end times are present
  expect(dateTime.startTime).toBeTruthy();
  expect(dateTime.endTime).toBeTruthy();
  expect(dateTime.startTimeFormatted).toBeTruthy();
  expect(dateTime.endTimeFormatted).toBeTruthy();

  testLogger.info('Query inspector has valid date time');
}

/**
 * Calculate time range duration in milliseconds from timestamps
 * @param {string} startTime - Start time timestamp (microseconds)
 * @param {string} endTime - End time timestamp (microseconds)
 * @returns {number} - Duration in milliseconds
 */
export function calculateTimeRangeDuration(startTime, endTime) {
  const startMs = parseInt(startTime) / 1000; // Convert microseconds to milliseconds
  const endMs = parseInt(endTime) / 1000;
  return endMs - startMs;
}

/**
 * Verify that the time range duration is approximately as expected
 * @param {Object} page - Playwright page object
 * @param {string} expectedRange - Expected range (e.g., "1h", "6d", "1w")
 * @param {number} queryIndex - Query index (default: 0)
 * @param {number} tolerancePercent - Tolerance percentage (default: 10%)
 */
export async function assertQueryInspectorTimeRange(page, expectedRange, queryIndex = 0, tolerancePercent = 10) {
  testLogger.info('Asserting query inspector time range', { expectedRange, queryIndex });

  const dateTime = await getQueryInspectorDateTime(page, queryIndex);
  const durationMs = calculateTimeRangeDuration(dateTime.startTime, dateTime.endTime);

  // Convert expected range to milliseconds
  const expectedDurationMs = parseTimeRangeToMs(expectedRange);

  // Calculate tolerance
  const tolerance = expectedDurationMs * (tolerancePercent / 100);
  const minDuration = expectedDurationMs - tolerance;
  const maxDuration = expectedDurationMs + tolerance;

  testLogger.info('Time range comparison', {
    durationMs,
    expectedDurationMs,
    minDuration,
    maxDuration,
  });

  // Verify duration is within tolerance
  expect(durationMs).toBeGreaterThanOrEqual(minDuration);
  expect(durationMs).toBeLessThanOrEqual(maxDuration);

  testLogger.info('Query inspector time range verified');
}

/**
 * Parse time range string to milliseconds
 * @param {string} range - Time range (e.g., "1h", "6d", "1w", "15m")
 * @returns {number} - Duration in milliseconds
 */
function parseTimeRangeToMs(range) {
  const match = range.match(/^(\d+)([mhdw])$/);
  if (!match) {
    throw new Error(`Invalid time range format: ${range}`);
  }

  const value = parseInt(match[1]);
  const unit = match[2];

  const multipliers = {
    'm': 60 * 1000,           // minutes
    'h': 60 * 60 * 1000,      // hours
    'd': 24 * 60 * 60 * 1000, // days
    'w': 7 * 24 * 60 * 60 * 1000, // weeks
  };

  return value * multipliers[unit];
}

/**
 * Open query inspector, verify time, and close it
 * This is a convenience function that combines open, assert, and close
 * @param {Object} page - Playwright page object
 * @param {Object} options - Options
 * @param {number} options.queryIndex - Query index (default: 0)
 * @param {string} options.expectedRange - Expected time range (e.g., "1h", "6d")
 */
export async function verifyQueryInspectorDateTime(page, options = {}) {
  const { queryIndex = 0, expectedRange = null } = options;

  testLogger.info('Verifying query inspector date time', { queryIndex, expectedRange });

  // Open query inspector
  await openQueryInspector(page);

  // Verify date time is present
  await assertQueryInspectorHasDateTime(page, queryIndex);

  // If expected range is provided, verify it matches
  if (expectedRange) {
    await assertQueryInspectorTimeRange(page, expectedRange, queryIndex);
  }

  // Get the actual date time for logging
  const dateTime = await getQueryInspectorDateTime(page, queryIndex);
  testLogger.info('Query inspector date time verified', dateTime);

  // Close query inspector
  await closeQueryInspector(page);

  return dateTime;
}

/**
 * Verify that two date times are different (time has changed)
 * @param {Object} dateTime1 - First date time object
 * @param {Object} dateTime2 - Second date time object
 */
export function assertDateTimesAreDifferent(dateTime1, dateTime2) {
  testLogger.info('Asserting date times are different');

  // At least one of start or end time should be different
  const areDifferent =
    dateTime1.startTime !== dateTime2.startTime ||
    dateTime1.endTime !== dateTime2.endTime;

  expect(areDifferent).toBe(true);

  testLogger.info('Date times are different', {
    dateTime1,
    dateTime2,
  });
}

/**
 * Verify that two date times are the same (time has NOT changed)
 * @param {Object} dateTime1 - First date time object
 * @param {Object} dateTime2 - Second date time object
 */
export function assertDateTimesAreSame(dateTime1, dateTime2) {
  testLogger.info('Asserting date times are the same');

  expect(dateTime1.startTime).toBe(dateTime2.startTime);
  expect(dateTime1.endTime).toBe(dateTime2.endTime);

  testLogger.info('Date times are the same');
}

export default {
  openQueryInspector,
  closeQueryInspector,
  getQueryInspectorDateTime,
  assertQueryInspectorHasDateTime,
  assertQueryInspectorTimeRange,
  verifyQueryInspectorDateTime,
  calculateTimeRangeDuration,
  assertDateTimesAreDifferent,
  assertDateTimesAreSame,
};
