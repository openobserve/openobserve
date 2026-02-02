/**
 * Test Constants for Regression Tests
 * Centralized configuration for test data, timeouts, and field names
 */

module.exports = {
  // Test Streams
  STREAMS: {
    TEST_STREAM: 'e2e_automate',
    MATCH_ALL: 'e2e_matchall',
  },

  // Field Names
  FIELDS: {
    POD_NAME: 'kubernetes_pod_name',
    CONTAINER_NAME: 'kubernetes_container_name',
    NAMESPACE: 'kubernetes_namespace',
    HOST: 'kubernetes_host',
    LOG_LEVEL: 'level',
    MESSAGE: 'message',
    TIMESTAMP: '_timestamp',
    SOURCE: 'source',
  },

  // Wait Times (in milliseconds)
  // ⚠️ WARNING: Fixed timeouts are an anti-pattern in Playwright!
  // These constants are provided for legacy compatibility only.
  //
  // PREFERRED APPROACHES:
  // 1. await page.waitForLoadState('networkidle')
  // 2. await element.waitFor({ state: 'visible' })
  // 3. await expect(element).toBeVisible()
  // 4. await page.waitForSelector('[data-test="element"]')
  //
  // Only use these constants when:
  // - Waiting for animations/transitions (use TRANSITION)
  // - Working around race conditions that can't be fixed with explicit waits
  // - Dealing with third-party components without proper loading states
  //
  // TODO: Replace all usages of these constants with explicit waits
  TIMEOUTS: {
    // Short waits for UI transitions
    TRANSITION: 300,
    SHORT: 500,

    // Medium waits for API calls and rendering
    MEDIUM: 1000,
    API_RESPONSE: 1500,

    // Long waits for complex operations
    LONG: 2000,
    NETWORK: 3000,

    // Maximum timeouts for operations that should eventually complete
    MAX_WAIT: 10000,
    MAX_NETWORK: 15000,
  },

  // Test Data
  TEST_DATA: {
    ORG_NAME: 'default',
    RELATIVE_TIME: {
      FIFTEEN_MIN: '15m',
      THIRTY_SEC: '30s',
      ONE_HOUR: '1h',
      SIX_WEEKS: '6w',
    },
  },

  // SQL Queries (templates)
  QUERIES: {
    SUBQUERY: (stream, field) =>
      `SELECT * FROM (SELECT * FROM "${stream}" WHERE ${field} IS NOT NULL LIMIT 100)`,
    CTE: (stream, field) =>
      `WITH filtered_logs AS (SELECT * FROM "${stream}" WHERE ${field} IS NOT NULL LIMIT 100) SELECT * FROM filtered_logs`,
    GROUP_BY: (stream, field) =>
      `SELECT ${field}, count(*) as total FROM "${stream}" WHERE ${field} IS NOT NULL GROUP BY ${field} LIMIT 50`,
  },

  // Error Messages
  ERRORS: {
    ERROR_400: '400',
    NO_STREAM_SELECTED: /select.*stream/i,
    NO_VALUES_FOUND: 'No values found',
  },

  // UI Element States
  STATES: {
    VISIBLE: 'visible',
    HIDDEN: 'hidden',
    ATTACHED: 'attached',
    DETACHED: 'detached',
  },

  // Test Priorities
  PRIORITIES: {
    P0: 'P0',
    P1: 'P1',
    P2: 'P2',
  },
};
