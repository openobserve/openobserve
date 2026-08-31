const testLogger = require('./test-logger.js');

/**
 * page.goto that survives a transient DNS/network blip.
 *
 * A single dropped resolution fails the test where it navigates — usually in
 * beforeEach, before any assertion runs — and reads as a product bug rather than
 * the connectivity hiccup it is. Only navigation-transport errors are retried; an
 * HTTP error response is a real answer from the server and is left to the caller.
 */
async function gotoWithRetry(page, url, timeout, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await page.goto(url, { timeout });
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      testLogger.warn('Navigation failed, retrying', {
        url,
        attempt,
        error: error.message,
      });
      await page.waitForTimeout(2000 * attempt);
    }
  }
  throw lastError;
}

module.exports = { gotoWithRetry };
