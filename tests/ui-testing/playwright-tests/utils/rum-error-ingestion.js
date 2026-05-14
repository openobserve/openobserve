/**
 * RUM Error Ingestion Helper
 *
 * Injects synthetic RUM error events for UI testing.
 * This allows UI tests to run without needing to build and serve the test app.
 */

const testLogger = require('./test-logger.js');

/**
 * Ingest RUM error events to OpenObserve
 * @param {import('@playwright/test').Page} page - Playwright page object for API calls
 * @param {number} errorCount - Number of different error types to ingest (default: 3)
 * @returns {Promise<{success: boolean, ingested: number, errors: Array}>}
 */
async function ingestRumErrors(page, errorCount = 3) {
  testLogger.info('Starting RUM error ingestion', { errorCount });

  const orgId = process.env["ORGNAME"] || 'default';
  const baseUrl = process.env["ZO_BASE_URL"] || 'http://localhost:5080';
  const email = process.env["ZO_ROOT_USER_EMAIL"];
  const password = process.env["ZO_ROOT_USER_PASSWORD"];

  try {
    // Fetch RUM token
    testLogger.debug('Fetching RUM token...');
    const rumToken = await fetchRumToken(page, baseUrl, orgId, email, password);

    if (!rumToken) {
      testLogger.warn('RUM token is empty, ingestion may fail');
    } else {
      testLogger.debug('RUM token fetched successfully');
    }

    // Generate RUM error events
    const rumErrors = generateRumErrors(errorCount);
    testLogger.debug(`Generated ${rumErrors.length} RUM error events`);

    // Ingest errors via API
    const result = await ingestErrors(page, baseUrl, orgId, rumErrors, email, password);

    if (result.success) {
      testLogger.info('RUM error ingestion successful', {
        ingested: result.ingested,
        stream: '_rumdata'
      });
    } else {
      testLogger.error('RUM error ingestion failed', {
        status: result.status,
        error: result.error
      });
    }

    return result;

  } catch (error) {
    testLogger.error('RUM error ingestion failed with exception', {
      error: error.message,
      stack: error.stack
    });
    return {
      success: false,
      ingested: 0,
      errors: [error.message]
    };
  }
}

/**
 * Fetch RUM token from OpenObserve API
 * @private
 */
async function fetchRumToken(page, baseUrl, orgId, email, password) {
  const basicAuth = Buffer.from(`${email}:${password}`).toString('base64');

  let fetchResponse;
  try {
    fetchResponse = await page.request.get(`${baseUrl}/api/${orgId}/rumtoken`, {
      headers: {
        'Authorization': `Basic ${basicAuth}`
      }
    });
  } catch (requestError) {
    testLogger.warn('RUM token fetch request failed', { error: requestError.message });
    return null;
  }

  if (!fetchResponse.ok()) {
    testLogger.warn('Failed to fetch RUM token', { status: fetchResponse.status() });
    return null;
  }

  const data = await fetchResponse.json().catch(() => null);
  if (!data) {
    testLogger.warn('Failed to fetch RUM token - could not parse response body');
    return null;
  }

  const token = data?.data?.rum_token || data?.rum_token;
  if (!token) {
    testLogger.warn('Failed to fetch RUM token - no token in response');
    return null;
  }

  return token;
}

/**
 * Generate synthetic RUM error events
 * @private
 */
function generateRumErrors(count) {
  const now = Date.now();

  const errorTemplates = [
    {
      type: 'TypeError',
      message: 'Cannot read property \'name\' of undefined',
      stack: 'TypeError: Cannot read property \'name\' of undefined\n    at Ht @ http://localhost:8089/assets/main.87e94092.js:1:2345\n    at onClick @ http://localhost:8089/assets/main.87e94092.js:1:3456'
    },
    {
      type: 'ReferenceError',
      message: 'undefinedVariable is not defined',
      stack: 'ReferenceError: undefinedVariable is not defined\n    at triggerReferenceError @ http://localhost:8089/assets/main.87e94092.js:1:4567\n    at onClick @ http://localhost:8089/assets/main.87e94092.js:1:5678'
    },
    {
      type: 'RangeError',
      message: 'Maximum call stack size exceeded',
      stack: 'RangeError: Maximum call stack size exceeded\n    at recursiveFunction @ http://localhost:8089/assets/main.87e94092.js:1:6789\n    at recursiveFunction @ http://localhost:8089/assets/main.87e94092.js:1:6789'
    }
  ];

  const browsers = [
    { name: 'Chrome', version: '120.0.0' },
    { name: 'Firefox', version: '119.0' },
    { name: 'Safari', version: '17.0' }
  ];

  const os = [
    { name: 'Mac OS', version: '14.0' },
    { name: 'Windows', version: '11' },
    { name: 'Linux', version: 'Ubuntu 22.04' }
  ];

  const errors = [];
  for (let i = 0; i < count && i < errorTemplates.length; i++) {
    const template = errorTemplates[i];
    const browser = browsers[i % browsers.length];
    const operatingSystem = os[i % os.length];

    errors.push({
      date: now - ((i + 1) * 60000), // Spread errors 1 min apart
      type: 'error',
      error_id: `error-${template.type.toLowerCase()}-${String(i + 1).padStart(3, '0')}`, // Unique error ID
      error: {
        message: template.message,
        type: template.type,
        stack: template.stack,
        source: 'source',
        is_crash: false,
        resource: {
          url: 'http://localhost:8089/'
        }
      },
      service: 'o2-sourcemap-test-app',
      version: '1.0.0-e2e-test',
      session: {
        id: `test-session-${String(i + 1).padStart(3, '0')}`
      },
      view: {
        id: `test-view-${String(i + 1).padStart(3, '0')}`,
        referrer: '',
        url: 'http://localhost:8089/'
      },
      application: {
        id: 'o2-sourcemap-test-app'
      },
      context: {
        browser: browser,
        os: operatingSystem
      }
    });
  }

  return errors;
}

/**
 * Ingest RUM errors via API
 * @private
 */
async function ingestErrors(page, baseUrl, orgId, rumErrors, email, password) {
  const basicAuth = Buffer.from(`${email}:${password}`).toString('base64');

  let fetchResponse;
  try {
    fetchResponse = await page.request.post(`${baseUrl}/api/${orgId}/_rumdata/_json`, {
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/json'
      },
      data: rumErrors
    });
  } catch (requestError) {
    return {
      success: false,
      ingested: 0,
      status: 'error',
      error: requestError.message,
      errors: [requestError.message]
    };
  }

  const responseStatus = fetchResponse.status();
  const responseOk = fetchResponse.ok();
  let responseData = null;
  try {
    const text = await fetchResponse.text();
    responseData = text ? JSON.parse(text) : null;
  } catch (e) {
    responseData = { error: 'Failed to parse response' };
  }

  const response = {
    status: responseStatus,
    ok: responseOk,
    data: responseData
  };

  if (response.ok) {
    return {
      success: true,
      ingested: rumErrors.length,
      status: response.status,
      errors: []
    };
  } else {
    return {
      success: false,
      ingested: 0,
      status: response.status,
      error: JSON.stringify(response.data),
      errors: [response.data]
    };
  }
}

module.exports = {
  ingestRumErrors
};
