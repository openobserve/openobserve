const testLogger = require('./test-logger.js');

// Adapter blips on long runs surface as these Chromium net errors mid-navigation;
// they are environmental and recover within seconds, unlike a genuine bad URL.
const TRANSIENT_NAV_ERROR =
  /ERR_NAME_NOT_RESOLVED|ERR_NETWORK_IO_SUSPENDED|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_ADDRESS_UNREACHABLE|ERR_CONNECTION_(?:RESET|CLOSED|ABORTED|FAILED|TIMED_OUT)|ERR_EMPTY_RESPONSE|ERR_TIMED_OUT|ERR_SOCKET_NOT_CONNECTED|net::ERR_FAILED|Timeout \d+ms exceeded/;

/**
 * page.goto that retries transient network failures instead of failing the test.
 */
async function gotoWithRetry(page, url, options = {}, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await page.goto(url, options);
    } catch (error) {
      lastError = error;

      // A closed page can never recover, and a non-network error is a real defect —
      // retrying either one only burns the test's remaining timeout budget.
      if (page.isClosed() || !TRANSIENT_NAV_ERROR.test(error.message)) {
        throw error;
      }

      testLogger.warn('Navigation failed, retrying', {
        url,
        attempt,
        attempts,
        error: error.message,
      });

      if (attempt < attempts) {
        await page.waitForTimeout(2000 * attempt);
      }
    }
  }

  throw lastError;
}

module.exports = { gotoWithRetry, TRANSIENT_NAV_ERROR };
