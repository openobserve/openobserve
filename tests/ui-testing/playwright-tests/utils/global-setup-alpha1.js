const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const testLogger = require('./test-logger.js');
const logsdata = require('../../../test-data/logs_data.json');
const dashboardChartJsonData = require('../../../test-data/dashboard_chart_json.json');

/**
 * Global setup for Alpha1 cloud tests
 * Handles Dex "Continue with Email" login flow:
 *   alpha1.dev.zinclabs.dev → dex-alpha1.dev.zinclabs.dev → email/password → approval → redirect back
 */
async function globalSetup() {
  testLogger.info('[alpha1] Starting global setup - Dex email login');

  // Create auth storage directory
  const authDir = path.join(__dirname, 'auth');
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }
  const authFile = path.join(authDir, 'user.json');

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1500, height: 1024 },
  });
  const page = await context.newPage();

  // Log all navigations for debugging
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      testLogger.debug(`[alpha1] [nav] ${frame.url()}`);
    }
  });

  try {
    const baseUrl = (process.env.ZO_BASE_URL || '').replace(/\/$/, '');
    if (!baseUrl) {
      throw new Error('ZO_BASE_URL must be set');
    }
    const userEmail = (process.env.ALPHA1_USER_EMAIL || '').trim();
    const userPassword = (process.env.ALPHA1_USER_PASSWORD || '').trim();

    if (!userEmail || !userPassword) {
      throw new Error('ALPHA1_USER_EMAIL and ALPHA1_USER_PASSWORD must be set');
    }

    // Step 1: Navigate to alpha1 — this redirects to Dex login page
    const loginUrl = `${baseUrl}/web/`;
    testLogger.info(`[alpha1] Navigating to ${loginUrl}`);
    await page.goto(loginUrl, { timeout: 60000 });
    await page.waitForLoadState('domcontentloaded');

    testLogger.info(`[alpha1] Current URL: ${page.url()}`);

    // Step 2: Click "Continue with Email" on the Dex page
    const continueWithEmail = page.getByText('Continue with Email');
    await continueWithEmail.waitFor({ state: 'visible', timeout: 15000 });
    testLogger.info('[alpha1] Clicking "Continue with Email"...');
    await continueWithEmail.click();
    await page.waitForLoadState('domcontentloaded');

    testLogger.info(`[alpha1] On Dex local login page: ${page.url()}`);

    // Step 3: Fill in the Dex local login form
    const emailField = page.locator(
      'input[name="login"], input[name="email"], input[name="username"], ' +
      'input[type="email"], input[type="text"][id="login"]'
    );
    const passwordField = page.locator(
      'input[name="password"], input[type="password"]'
    );

    await emailField.first().waitFor({ state: 'visible', timeout: 10000 });
    await emailField.first().fill(userEmail);
    testLogger.info('[alpha1] Email entered');

    // Handle multi-step Dex login: if password field not immediately visible,
    // click Continue/Next to advance to the password step
    const passwordVisible = await passwordField.first().isVisible().catch(() => false);
    if (!passwordVisible) {
      const continueBtn = page.locator('button:has-text("Continue"), button:has-text("Next")').first();
      const continueBtnVisible = await continueBtn.isVisible().catch(() => false);
      if (continueBtnVisible) {
        testLogger.info('[alpha1] Clicking Continue to advance to password step...');
        await continueBtn.click();
        await page.waitForLoadState('domcontentloaded');
      }
    }

    await passwordField.first().waitFor({ state: 'visible', timeout: 10000 });
    await passwordField.first().fill(userPassword);
    testLogger.info('[alpha1] Password entered');

    // Step 4: Submit and wait for redirect back to alpha1
    const submitButton = page.locator('form').locator(
      'button:has-text("Login"), button:has-text("Sign In"), button:has-text("Log In")'
    );

    await submitButton.first().waitFor({ state: 'visible', timeout: 10000 });
    await submitButton.first().click();
    await Promise.race([
      page.waitForURL(/web\/|dex\/approval|dex\/auth.*error/, { timeout: 15000 }),
      page.locator('.flash-error, .alert, [class*="error"]').first()
        .waitFor({ state: 'visible', timeout: 15000 })
        .then(() => { throw new Error('Dex login error: invalid credentials or server error'); }),
    ]);

    // Check if login failed (Dex error page)
    if (/dex\/.*error/.test(page.url())) {
      throw new Error(`Login failed — Dex returned error page: ${page.url()}`);
    }
    testLogger.info(`[alpha1] After submit navigation: ${page.url()}`);

    // Step 5: Check if we're on a Dex approval page
    const currentUrl = page.url();
    if (currentUrl.includes('dex/approval') || currentUrl.includes('dex/auth')) {
      testLogger.info('[alpha1] On Dex approval/auth page, looking for grant button...');

      const grantButton = page.locator(
        'button:has-text("Grant Access"), button:has-text("Approve"), button[value="approve"], ' +
        'input[type="submit"][value="Approve"], button[type="submit"]'
      );

      try {
        await grantButton.first().waitFor({ state: 'visible', timeout: 5000 });
        testLogger.info('[alpha1] Found grant/approve button, clicking...');
        await grantButton.first().click();
        await page.waitForURL(
          url => !url.toString().includes('dex'),
          { timeout: 15000 }
        );
        testLogger.info(`[alpha1] After grant approval: ${page.url()}`);
      } catch (e) {
        if (e.name === 'TimeoutError') {
          testLogger.info('[alpha1] No grant button found, continuing...');
        } else {
          throw e;
        }
      }
    }

    // Step 6: Wait for the app to fully load
    await page.waitForLoadState('domcontentloaded');
    testLogger.info(`[alpha1] After settling: ${page.url()}`);

    // If still on Dex, wait longer for the redirect
    if (page.url().includes('dex')) {
      testLogger.info('[alpha1] Still on Dex, waiting for redirect...');
      await page.waitForURL(
        url => !url.toString().includes('dex'),
        { timeout: 30000 }
      );
    }

    // If on callback URL (/web/cb#id_token=...), the SPA needs time to process
    // the token from the hash before the session is valid. Wait for the SPA to
    // complete token processing and auto-redirect, rather than navigating away
    // prematurely (which would lose the session).
    if (page.url().includes('/cb#') || page.url().includes('/cb?')) {
      testLogger.info('[alpha1] On callback URL — waiting for SPA token processing...');
      try {
        // Wait for the SPA to process the token and redirect away from /cb
        await page.waitForURL(
          url => !url.toString().includes('/cb'),
          { timeout: 30000 }
        );
        testLogger.info(`[alpha1] Callback processed, now at: ${page.url()}`);
      } catch (e) {
        // If the SPA didn't auto-redirect, wait for network to settle then navigate
        testLogger.warn('[alpha1] Callback did not auto-redirect, waiting for network idle...');
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        if (page.url().includes('/cb')) {
          testLogger.info('[alpha1] Still on callback, navigating to /web/...');
          await page.goto(`${baseUrl}/web/`, { waitUntil: 'domcontentloaded' });
        }
      }
    }

    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch((e) => testLogger.warn('[alpha1] networkidle timeout:', { error: e.message }));

    // Step 7: Verify login success
    testLogger.info(`[alpha1] Verifying login at: ${page.url()}`);

    // If we ended up back on Dex, the token exchange failed
    if (page.url().includes('dex')) {
      throw new Error(`Login failed — redirected back to Dex after token exchange: ${page.url()}`);
    }

    const menuItem = page.locator('[data-test="menu-link-\\/-item"]');
    await menuItem.waitFor({ state: 'visible', timeout: 15000 });
    testLogger.info('[alpha1] Login successful — main menu visible');

    // Save authentication state for tests to reuse
    await context.storageState({ path: authFile });
    testLogger.info(`[alpha1] Auth state saved to ${authFile}`);

    // Step 8: Fetch org identifier and passcode for API/ingestion auth
    // On cloud, ingestion requires Basic Auth with email:passcode (not email:password)
    testLogger.info('[alpha1] Fetching org identifier and passcode...');
    try {
      const orgsResponse = await page.evaluate(async () => {
        const r = await fetch('/api/organizations?page_num=0&page_size=100');
        return r.ok ? await r.json() : null;
      });

      if (orgsResponse && orgsResponse.data && orgsResponse.data.length > 0) {
        const org = orgsResponse.data.find(o => o.identifier !== '_meta') || orgsResponse.data[0];
        const orgIdentifier = org.identifier;
        testLogger.info(`[alpha1] User org: ${org.name} (${orgIdentifier})`);

        // Fetch passcode for this org
        const passcodeResponse = await page.evaluate(async (orgId) => {
          const r = await fetch('/api/' + orgId + '/passcode');
          return r.ok ? await r.json() : null;
        }, orgIdentifier);

        if (passcodeResponse && passcodeResponse.data) {
          const cloudConfig = {
            orgIdentifier,
            orgName: org.name,
            userEmail: passcodeResponse.data.user,
            passcode: passcodeResponse.data.passcode,
          };

          const cloudConfigFile = path.join(authDir, 'cloud-config.json');
          fs.writeFileSync(cloudConfigFile, JSON.stringify(cloudConfig, null, 2));
          testLogger.info(`[alpha1] Cloud config saved to ${cloudConfigFile}`);
        } else {
          testLogger.warn('[alpha1] Could not fetch passcode');
        }
      } else {
        testLogger.warn('[alpha1] Could not fetch organizations');
      }
    } catch (e) {
      testLogger.warn('[alpha1] Failed to fetch cloud config', { error: e.message });
    }

    // Step 9: Perform global data ingestion (same as self-hosted global-setup.js)
    // This creates streams that tests expect to find in dropdowns
    const specFiles = process.argv.filter(arg => /\.spec\.(js|ts)$/.test(arg));
    const isCleanupOnly = specFiles.length === 1 && /cleanup\.spec\.(js|ts)$/.test(specFiles[0]);
    if (isCleanupOnly || process.env.SKIP_INGESTION === 'true') {
      testLogger.info('[alpha1] Skipping data ingestion (cleanup-only run or SKIP_INGESTION=true)');
    } else {
      await performGlobalIngestion(page);
    }

  } catch (error) {
    const debugDir = path.join(__dirname, '..', '..', 'test-results');
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }
    const screenshotPath = path.join(debugDir, 'debug-alpha1-login.png');
    await page.screenshot({ path: screenshotPath }).catch(() => {});
    testLogger.error(`[alpha1] Login failed. Screenshot: ${screenshotPath}`);
    testLogger.error(`[alpha1] Current URL: ${page.url()}`);
    testLogger.error(`[alpha1] Error: ${error.message}`);
    // Only delete stale auth file on credential/auth failures, not network timeouts.
    // Preserving the file allows tests to reuse the last valid session on transient network issues.
    const isNetworkTimeout = error.name === 'TimeoutError' && error.message.includes('page.goto');
    if (!isNetworkTimeout && fs.existsSync(authFile)) {
      fs.unlinkSync(authFile);
    }
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }

  testLogger.info('[alpha1] Global setup completed successfully');
}

/**
 * Ingest test data into streams so they appear in UI dropdowns.
 * Uses cloud auth (email:passcode) from cloud-config.json.
 */
async function performGlobalIngestion(page) {
  const cloudConfigFile = path.join(__dirname, 'auth', 'cloud-config.json');
  let headers;
  let orgId;

  try {
    const cloudConfig = JSON.parse(fs.readFileSync(cloudConfigFile, 'utf-8'));
    orgId = cloudConfig.orgIdentifier;
    const basicAuth = Buffer.from(`${cloudConfig.userEmail}:${cloudConfig.passcode}`).toString('base64');
    headers = {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/json',
    };
  } catch (e) {
    testLogger.warn('[alpha1] Cannot read cloud-config.json for ingestion — skipping', { error: e.message });
    return;
  }

  // Streams that tests expect to exist in dropdowns
  const streams = [
    { name: 'e2e_automate', data: logsdata },
    { name: 'auto_playwright_stream', data: [{ level: 'info', job: 'test', log: 'test message for openobserve' }] },
    { name: 'kubernetes', data: dashboardChartJsonData },
  ];

  for (const stream of streams) {
    try {
      const response = await page.evaluate(async ({ headers, orgId, streamName, data }) => {
        // Use relative URL to avoid CORS when Dex redirects to a different hostname than ZO_BASE_URL
        const r = await fetch(`/api/${orgId}/${streamName}/_json`, {
          method: 'POST',
          headers,
          body: JSON.stringify(data),
        });
        return { status: r.status, text: await r.text() };
      }, { headers, orgId, streamName: stream.name, data: stream.data });

      if (response.status === 200) {
        testLogger.info(`[alpha1] Ingested test data into '${stream.name}'`, { status: response.status });
      } else {
        testLogger.warn(`[alpha1] Ingestion into '${stream.name}' returned ${response.status}`, { body: response.text.substring(0, 200) });
      }
    } catch (e) {
      testLogger.warn(`[alpha1] Failed to ingest into '${stream.name}'`, { error: e.message });
    }
  }

  // Wait for streams to be indexed and visible in the API
  // Cloud environments need time after ingestion before streams appear in UI dropdowns
  testLogger.info('[alpha1] Waiting for streams to be indexed...');
  const maxWaitMs = 90000; // 90 seconds max
  const pollIntervalMs = 3000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const streamsResult = await page.evaluate(async ({ orgId, headers }) => {
        // Use relative URL to avoid CORS when Dex redirects to a different hostname than ZO_BASE_URL
        const r = await fetch(`/api/${orgId}/streams?type=logs&page_num=0&page_size=1000`, { headers });
        if (!r.ok) return { ok: false, status: r.status };
        const data = await r.json();
        const names = (data.list || []).map(s => s.name);
        return { ok: true, names };
      }, { orgId, headers });

      if (streamsResult.ok) {
        const hasE2e = streamsResult.names.includes('e2e_automate');
        const hasAuto = streamsResult.names.includes('auto_playwright_stream');
        const hasKubernetes = streamsResult.names.includes('kubernetes');
        if (hasE2e && hasAuto && hasKubernetes) {
          testLogger.info(`[alpha1] All streams indexed after ${Date.now() - startTime}ms`);
          break;
        }
        testLogger.debug(`[alpha1] Streams not yet indexed (e2e_automate=${hasE2e}, auto_playwright_stream=${hasAuto}, kubernetes=${hasKubernetes}), waiting...`);
      } else {
        testLogger.debug(`[alpha1] Streams API returned ${streamsResult.status}, retrying...`);
      }
    } catch (e) {
      testLogger.debug(`[alpha1] Error checking streams: ${e.message}`);
    }

    await page.waitForTimeout(pollIntervalMs);
  }

  if (Date.now() - startTime >= maxWaitMs) {
    testLogger.warn(`[alpha1] Streams not fully indexed after ${maxWaitMs}ms — tests may fail on stream selection`);
  }
}

module.exports = globalSetup;
