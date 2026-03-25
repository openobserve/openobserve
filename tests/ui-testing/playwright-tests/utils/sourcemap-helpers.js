/**
 * Sourcemap Test Helpers
 *
 * Shared utility functions for sourcemap E2E testing.
 * Handles test app building, sourcemap upload/delete, stacktrace resolution, and user management.
 */

const fs = require('fs').promises;
const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const execAsync = promisify(exec);

const testLogger = require('./test-logger');

/**
 * Build test app with updated RUM SDK configuration
 * @param {string} rumToken - RUM token from API
 * @param {Object} options - Build options
 * @returns {Promise<Object>} Build result with hashes and paths
 */
async function buildTestApp(rumToken, options = {}) {
  const {
    site = 'localhost:5080',
    insecureHTTP = true,
    service = 'o2-sourcemap-test-app',
    env = 'testing',
    version = '1.0.0-automation',
    org = 'default'
  } = options;

  testLogger.info('Building test app with RUM SDK configuration');

  const appDir = path.join(__dirname, '../../../MD_Files/Sourcemaps/o2-sourcemap-test-app');
  const configPath = path.join(appDir, 'src/index.js');

  try {
    // Read current config
    let configContent = await fs.readFile(configPath, 'utf8');

    // Update SDK config
    configContent = configContent.replace(
      /clientToken:\s*['"][^'"]*['"]/,
      `clientToken: '${rumToken}'`
    );
    configContent = configContent.replace(
      /site:\s*['"][^'"]*['"]/,
      `site: '${site}'`
    );
    configContent = configContent.replace(
      /insecureHTTP:\s*(?:true|false)/,
      `insecureHTTP: ${insecureHTTP}`
    );
    configContent = configContent.replace(
      /service:\s*['"][^'"]*['"]/,
      `service: '${service}'`
    );
    configContent = configContent.replace(
      /env:\s*['"][^'"]*['"]/,
      `env: '${env}'`
    );
    configContent = configContent.replace(
      /version:\s*['"][^'"]*['"]/,
      `version: '${version}'`
    );
    configContent = configContent.replace(
      /organizationIdentifier:\s*['"][^'"]*['"]/,
      `organizationIdentifier: '${org}'`
    );

    // Write updated config
    await fs.writeFile(configPath, configContent, 'utf8');
    testLogger.info('Updated SDK configuration');

    // Build app
    testLogger.info('Running npm run build...');
    const { stdout, stderr } = await execAsync('npm run build', {
      cwd: appDir,
      timeout: 60000 // 60 second timeout
    });

    if (stderr && !stderr.includes('webpack')) {
      testLogger.warn(`Build warnings: ${stderr}`);
    }

    testLogger.info('Build completed successfully');

    // Extract content hashes from dist/
    const distPath = path.join(appDir, 'dist');
    const distFiles = await fs.readdir(distPath);

    const hashes = {
      main: extractHash(distFiles, 'main', '.js'),
      lazyModule: extractHash(distFiles, 'lazy-module', '.js'),
      profiler: extractHash(distFiles, 'profiler', '.js'),
      recorder: extractHash(distFiles, 'recorder', '.js')
    };

    testLogger.info(`Extracted hashes: ${JSON.stringify(hashes)}`);

    // Create sourcemaps ZIP
    const sourcemapsZipPath = path.join(distPath, 'sourcemaps.zip');

    // Remove old ZIP if exists
    try {
      await fs.unlink(sourcemapsZipPath);
    } catch (err) {
      // Ignore if doesn't exist
    }

    await execAsync('zip sourcemaps.zip *.map', { cwd: distPath });
    testLogger.info(`Created sourcemaps ZIP at ${sourcemapsZipPath}`);

    return {
      appDir,
      distPath,
      hashes,
      sourcemapsZipPath,
      config: { service, env, version, org }
    };

  } catch (error) {
    testLogger.error(`Failed to build test app: ${error.message}`);
    throw error;
  }
}

/**
 * Extract content hash from filename
 * @param {string[]} files - List of filenames
 * @param {string} prefix - File prefix (e.g., 'main')
 * @param {string} ext - File extension (e.g., '.js')
 * @returns {string} Extracted hash
 */
function extractHash(files, prefix, ext) {
  const pattern = new RegExp(`${prefix}\\.(.*?)\\${ext}`);
  const file = files.find(f => f.startsWith(prefix) && f.endsWith(ext) && !f.endsWith('.map'));

  if (!file) {
    throw new Error(`Could not find file matching ${prefix}*${ext}`);
  }

  const match = file.match(pattern);
  if (!match || !match[1]) {
    throw new Error(`Could not extract hash from ${file}`);
  }

  return match[1];
}

/**
 * Serve test app on specified port
 * @param {string} distPath - Path to dist directory
 * @param {number} port - Port number (default: 8089)
 * @returns {Promise<Object>} Server process info
 */
async function serveTestApp(distPath, port = 8089) {
  testLogger.info(`Starting HTTP server on port ${port}...`);

  const { spawn } = require('child_process');

  const serverProcess = spawn('python3', ['-m', 'http.server', port.toString()], {
    cwd: distPath,
    detached: true,
    stdio: 'ignore'
  });

  serverProcess.unref();

  // Wait for server to be ready
  await new Promise(resolve => setTimeout(resolve, 2000));

  testLogger.info(`HTTP server started (PID: ${serverProcess.pid})`);

  return {
    process: serverProcess,
    pid: serverProcess.pid,
    port,
    url: `http://localhost:${port}`
  };
}

/**
 * Stop test app HTTP server
 * @param {Object} serverInfo - Server info from serveTestApp
 */
async function stopTestAppServer(serverInfo) {
  if (!serverInfo || !serverInfo.pid) {
    testLogger.warn('No server PID provided, skipping stop');
    return;
  }

  testLogger.info(`Stopping HTTP server (PID: ${serverInfo.pid})...`);

  try {
    // Kill process group
    process.kill(-serverInfo.pid, 'SIGTERM');
    testLogger.info('HTTP server stopped');
  } catch (error) {
    testLogger.warn(`Failed to stop server: ${error.message}`);
    // Try direct kill
    try {
      process.kill(serverInfo.pid, 'SIGKILL');
    } catch (err) {
      testLogger.error(`Could not kill server process: ${err.message}`);
    }
  }

  // Also try to kill any python processes on the port
  try {
    await execAsync(`lsof -ti:${serverInfo.port} | xargs kill -9 2>/dev/null || true`);
  } catch (err) {
    // Ignore errors
  }
}

/**
 * Upload sourcemaps to OpenObserve
 * @param {Object} request - Playwright APIRequestContext
 * @param {Object} config - Upload configuration
 * @param {string} zipPath - Path to sourcemaps ZIP
 * @returns {Promise<Object>} Response
 */
async function uploadSourcemaps(request, config, zipPath) {
  const { baseUrl, org, auth, service, env, version } = config;

  testLogger.info(`Uploading sourcemaps: service=${service}, env=${env}, version=${version}`);

  const FormData = require('form-data');
  const form = new FormData();

  // Read ZIP file
  const zipBuffer = await fs.readFile(zipPath);
  form.append('file', zipBuffer, {
    filename: 'sourcemaps.zip',
    contentType: 'application/zip'
  });
  form.append('service', service);
  form.append('env', env);
  form.append('version', version);

  const response = await request.post(`${baseUrl}/api/${org}/sourcemaps`, {
    headers: {
      'Authorization': `Basic ${auth}`,
      ...form.getHeaders()
    },
    data: form.getBuffer()
  });

  const status = response.status();
  testLogger.info(`Upload response: ${status}`);

  if (status !== 201 && status !== 200) {
    const body = await response.text();
    testLogger.error(`Upload failed: ${body}`);
    throw new Error(`Upload failed with status ${status}: ${body}`);
  }

  return response;
}

/**
 * List sourcemaps from OpenObserve
 * @param {Object} request - Playwright APIRequestContext
 * @param {Object} config - List configuration
 * @returns {Promise<Array>} List of sourcemaps
 */
async function listSourcemaps(request, config) {
  const { baseUrl, org, auth, service, env, version } = config;

  const params = new URLSearchParams();
  if (service) params.append('service', service);
  if (env) params.append('env', env);
  if (version) params.append('version', version);

  const url = `${baseUrl}/api/${org}/sourcemaps?${params}`;
  testLogger.info(`Listing sourcemaps: ${url}`);

  const response = await request.get(url, {
    headers: { 'Authorization': `Basic ${auth}` }
  });

  if (response.status() !== 200) {
    const body = await response.text();
    testLogger.error(`List failed: ${body}`);
    throw new Error(`List failed with status ${response.status()}`);
  }

  return await response.json();
}

/**
 * Delete sourcemaps from OpenObserve
 * @param {Object} request - Playwright APIRequestContext
 * @param {Object} config - Delete configuration
 * @returns {Promise<Object>} Response
 */
async function deleteSourcemaps(request, config) {
  const { baseUrl, org, auth, service, env, version } = config;

  const params = new URLSearchParams({ service, env, version });
  const url = `${baseUrl}/api/${org}/sourcemaps?${params}`;

  testLogger.info(`Deleting sourcemaps: ${url}`);

  const response = await request.delete(url, {
    headers: { 'Authorization': `Basic ${auth}` }
  });

  const status = response.status();
  testLogger.info(`Delete response: ${status}`);

  if (status !== 200) {
    const body = await response.text();
    testLogger.warn(`Delete returned non-200: ${body}`);
  }

  return response;
}

/**
 * Resolve stacktrace via sourcemap API
 * @param {Object} request - Playwright APIRequestContext
 * @param {Object} config - Resolution configuration
 * @param {string} stacktrace - Minified stacktrace
 * @returns {Promise<Object>} Resolved stacktrace
 */
async function resolveStacktrace(request, config, stacktrace) {
  const { baseUrl, org, auth, service, env, version } = config;

  testLogger.info(`Resolving stacktrace for ${service}:${version}`);

  const response = await request.post(`${baseUrl}/api/${org}/sourcemaps/stacktrace`, {
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    data: {
      service,
      env,
      version,
      stacktrace
    }
  });

  if (response.status() !== 200) {
    const body = await response.text();
    testLogger.error(`Resolution failed: ${body}`);
    throw new Error(`Resolution failed with status ${response.status()}`);
  }

  return await response.json();
}

/**
 * Get RUM token from OpenObserve
 * @param {Object} request - Playwright APIRequestContext
 * @param {Object} config - Configuration
 * @returns {Promise<string>} RUM token
 */
async function getRumToken(request, config) {
  const { baseUrl, org, auth } = config;

  testLogger.info('Fetching RUM token...');

  const response = await request.get(`${baseUrl}/api/${org}/rumtoken`, {
    headers: { 'Authorization': `Basic ${auth}` }
  });

  if (response.status() !== 200) {
    const body = await response.text();
    testLogger.error(`Failed to get RUM token: ${body}`);
    throw new Error(`Failed to get RUM token: ${response.status()}`);
  }

  const data = await response.json();
  testLogger.info(`RUM token retrieved: ${data.token}`);

  return data.token;
}

/**
 * Generate expected stacktrace with actual content hashes
 * @param {string} errorType - Error type (e.g., 'typeError')
 * @param {Object} hashes - Content hashes from build
 * @returns {string} Stacktrace with actual hashes
 */
function getExpectedStacktrace(errorType, hashes) {
  const templates = {
    typeError: `TypeError: Cannot read properties of undefined (reading 'profile')
    at Ht @ http://localhost:8089/main.${hashes.main}.js:1:186484
    at http://localhost:8089/main.${hashes.main}.js:1:186818`,

    referenceError: `ReferenceError: undeclaredVariableThatDoesNotExist is not defined
    at Zt @ http://localhost:8089/main.${hashes.main}.js:1:186511`,

    rangeError: `RangeError: Invalid array length
    at Kt @ http://localhost:8089/main.${hashes.main}.js:1:186576`,

    customError: `PaymentError: Insufficient funds in account
    at Jt @ http://localhost:8089/main.${hashes.main}.js:1:186730`,

    crossChunk: `TypeError: Cannot read properties of null (reading 'timestamp')
    at u @ http://localhost:8089/lazy-module.${hashes.lazyModule}.js:1:131
    at http://localhost:8089/main.${hashes.main}.js:1:186963`
  };

  if (!templates[errorType]) {
    throw new Error(`Unknown error type: ${errorType}`);
  }

  return templates[errorType];
}

/**
 * Trigger errors in test app via Playwright
 * @param {Object} page - Playwright page
 * @param {string} testAppUrl - Test app URL
 * @returns {Promise<void>}
 */
async function triggerErrors(page, testAppUrl) {
  testLogger.info(`Navigating to test app: ${testAppUrl}`);

  await page.goto(testAppUrl);
  await page.waitForLoadState('networkidle', { timeout: 10000 });

  // Wait for SDK to initialize
  await page.waitForTimeout(2000);

  // Click all error buttons
  const errorButtons = [
    '#btn-type-error',
    '#btn-ref-error',
    '#btn-range-error',
    '#btn-custom-error',
    '#btn-nested-error'
    // Note: promise-error, async-error, and lazy-error are caught by .catch() handlers
  ];

  for (const buttonId of errorButtons) {
    testLogger.info(`Clicking ${buttonId}...`);
    await page.locator(buttonId).click();
    await page.waitForTimeout(500); // Small delay between clicks
  }

  testLogger.info('All errors triggered');

  // Wait for SDK to flush (30 seconds)
  testLogger.info('Waiting 30 seconds for SDK to flush events...');
  await page.waitForTimeout(30000);

  testLogger.info('Error ingestion complete');
}

/**
 * Create test user for RBAC testing
 * @param {Object} request - Playwright APIRequestContext
 * @param {Object} config - Configuration
 * @param {string} role - User role (viewer, editor, admin)
 * @returns {Promise<Object>} User info
 */
async function createTestUser(request, config, role) {
  const { baseUrl, org, auth } = config;

  const email = `test-${role}-${Date.now()}@sourcemap-test.local`;
  const password = 'TestPass123!';

  testLogger.info(`Creating test user: ${email} with role: ${role}`);

  const response = await request.post(`${baseUrl}/api/${org}/users`, {
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    data: {
      email,
      password,
      first_name: 'Test',
      last_name: role.charAt(0).toUpperCase() + role.slice(1),
      role
    }
  });

  const status = response.status();

  if (status !== 200 && status !== 201) {
    const body = await response.text();
    testLogger.error(`Failed to create user: ${body}`);
    throw new Error(`Failed to create user: ${status}`);
  }

  testLogger.info(`User created successfully: ${email}`);

  return {
    email,
    password,
    role,
    auth: Buffer.from(`${email}:${password}`).toString('base64')
  };
}

/**
 * Delete test user
 * @param {Object} request - Playwright APIRequestContext
 * @param {Object} config - Configuration
 * @param {string} email - User email
 * @returns {Promise<void>}
 */
async function deleteTestUser(request, config, email) {
  const { baseUrl, org, auth } = config;

  testLogger.info(`Deleting test user: ${email}`);

  const response = await request.delete(
    `${baseUrl}/api/${org}/users/${encodeURIComponent(email)}`,
    {
      headers: { 'Authorization': `Basic ${auth}` }
    }
  );

  const status = response.status();

  if (status !== 200) {
    const body = await response.text();
    testLogger.warn(`Delete user returned ${status}: ${body}`);
  } else {
    testLogger.info(`User deleted: ${email}`);
  }
}

module.exports = {
  buildTestApp,
  serveTestApp,
  stopTestAppServer,
  uploadSourcemaps,
  listSourcemaps,
  deleteSourcemaps,
  resolveStacktrace,
  getRumToken,
  getExpectedStacktrace,
  triggerErrors,
  createTestUser,
  deleteTestUser
};
