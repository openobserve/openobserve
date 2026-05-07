const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const testLogger = require('./test-logger.js');
const logsdata = require('../../../test-data/logs_data.json');

// Auth storage paths
const AUTH_DIR = path.join(__dirname, 'auth');
const AUTH_FILE = path.join(AUTH_DIR, 'user.json');
const CLOUD_CONFIG_FILE = path.join(AUTH_DIR, 'cloud-config.json');

/**
 * Global setup for Alpha1 cloud tests
 * Handles Dex "Continue with Email" login flow with retry logic:
 *   alpha.o2aks1.internal.zinclabs.dev → Dex → email/password → approval → redirect back
 *
 * Retries up to 3 times with fresh browser per attempt and stagger delay
 * to handle Dex concurrency when 13 parallel shards login simultaneously.
 */
async function globalSetup() {
  testLogger.info('[alpha1] Starting global setup - Dex email login');

  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  const baseUrl = (process.env.ZO_BASE_URL || '').replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('ZO_BASE_URL must be set');
  }
  const userEmail = (process.env.ALPHA1_USER_EMAIL || '').trim();
  const userPassword = (process.env.ALPHA1_USER_PASSWORD || '').trim();
  if (!userEmail || !userPassword) {
    throw new Error('ALPHA1_USER_EMAIL and ALPHA1_USER_PASSWORD must be set');
  }

  // Check if shared auth state exists (downloaded from cleanup job artifact)
  // If valid, skip the entire Dex login flow — just verify and ingest
  if (fs.existsSync(AUTH_FILE) && fs.existsSync(CLOUD_CONFIG_FILE)) {
    testLogger.info('[alpha1] Found shared auth state from cleanup job — skipping Dex login');
    try {
      const valid = await verifySharedAuth(baseUrl);
      if (valid) {
        testLogger.info('[alpha1] Shared auth state is valid');
        // Still need to do ingestion for shard-specific streams
        const specFiles = process.argv.filter(arg => /\.spec\.(js|ts)$/.test(arg));
        const isCleanupOnly = specFiles.length === 1 && /cleanup\.spec\.(js|ts)$/.test(specFiles[0]);
        if (!isCleanupOnly && process.env.SKIP_INGESTION !== 'true') {
          await performGlobalIngestionWithFetch();
        }
        testLogger.info('[alpha1] Global setup completed successfully (shared auth)');
        return;
      }
      testLogger.warn('[alpha1] Shared auth state invalid — falling back to Dex login');
    } catch (e) {
      testLogger.warn(`[alpha1] Shared auth verification failed: ${e.message} — falling back to Dex login`);
    }
  }

  // Fallback: perform Dex login with retries
  const maxAttempts = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const staggerMs = attempt === 1
      ? Math.floor(Math.random() * 15000)
      : 5000 + Math.floor(Math.random() * 10000);
    testLogger.info(`[alpha1] Login attempt ${attempt}/${maxAttempts} (stagger: ${staggerMs}ms)`);
    await new Promise(r => setTimeout(r, staggerMs));

    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1500, height: 1024 },
    });
    const page = await context.newPage();

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        testLogger.debug(`[alpha1] [nav] ${frame.url()}`);
      }
    });

    try {
      await performDexLogin(page, baseUrl, userEmail, userPassword);

      // Switch to target org via UI dropdown — URL ?org_identifier=... alone
      // does NOT update the Pinia store, so API calls keep using the user's
      // default org. The dropdown click triggers the proper store update,
      // and the active org is then persisted in cookies/localStorage which
      // storageState captures below.
      const targetOrg = process.env.ORGNAME;
      if (targetOrg && targetOrg !== 'default') {
        await switchOrgViaDropdown(page, targetOrg);
      }

      await context.storageState({ path: AUTH_FILE });
      testLogger.info(`[alpha1] Auth state saved to ${AUTH_FILE}`);

      await fetchCloudConfig(page);

      const specFiles = process.argv.filter(arg => /\.spec\.(js|ts)$/.test(arg));
      const isCleanupOnly = specFiles.length === 1 && /cleanup\.spec\.(js|ts)$/.test(specFiles[0]);
      if (isCleanupOnly || process.env.SKIP_INGESTION === 'true') {
        testLogger.info('[alpha1] Skipping data ingestion (cleanup-only run or SKIP_INGESTION=true)');
      } else {
        await performGlobalIngestion(page);
      }

      testLogger.info('[alpha1] Global setup completed successfully');
      return;

    } catch (error) {
      lastError = error;

      const debugDir = path.join(__dirname, '..', '..', 'test-results');
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      const screenshotPath = path.join(debugDir, `debug-alpha1-login-attempt${attempt}.png`);
      await page.screenshot({ path: screenshotPath }).catch(() => {});

      if (attempt < maxAttempts) {
        testLogger.warn(`[alpha1] Attempt ${attempt} failed: ${error.message}. Retrying...`);
      } else {
        testLogger.error(`[alpha1] All ${maxAttempts} login attempts failed.`);
        testLogger.error(`[alpha1] Final error: ${error.message}`);
        if (fs.existsSync(AUTH_FILE)) {
          fs.unlinkSync(AUTH_FILE);
        }
      }

    } finally {
      await context.close();
      await browser.close();
    }
  }

  throw lastError;
}

/**
 * Perform Dex OIDC login flow.
 * Navigates to app → Dex → fills credentials → handles approval → verifies login.
 */
async function performDexLogin(page, baseUrl, userEmail, userPassword) {
  // Step 1: Navigate to alpha1 — this redirects to Dex login page
  const loginUrl = `${baseUrl}/web/`;
  testLogger.info(`[alpha1] Navigating to ${loginUrl}`);
  await page.goto(loginUrl, { timeout: 60000 });
  await page.waitForLoadState('domcontentloaded');

  testLogger.info(`[alpha1] Current URL: ${page.url()}`);

  // Check if already logged in (valid session from previous attempt or shared cookies)
  // If the main menu is visible, skip the entire Dex flow
  const menuItem = page.locator('[data-test="menu-link-\\/-item"]');
  const alreadyLoggedIn = await menuItem.isVisible().catch(() => false);
  if (alreadyLoggedIn) {
    testLogger.info('[alpha1] Already logged in — skipping Dex flow');
    return;
  }

  // Step 2: Click "Continue with Email" on the Dex page
  // The page may be at /web/login (app login page with Dex button) or already on Dex
  const continueWithEmail = page.getByText('Continue with Email');
  await continueWithEmail.waitFor({ state: 'visible', timeout: 20000 });
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

  // Step 4: Submit the login form
  await submitDexLoginForm(page);

  // Step 5: Wait for redirect back to alpha1
  // AKS env routes through /config/redirect (OAuth callback) before reaching /web/
  await Promise.race([
    page.waitForURL(/web\/|config\/redirect|dex\/approval|dex\/auth.*error/, { timeout: 60000 }),
    page.locator('.flash-error, .alert, [class*="error"]').first()
      .waitFor({ state: 'visible', timeout: 60000 })
      .then(() => { throw new Error('Dex login error: invalid credentials or server error'); }),
  ]);

  // If landed on OAuth callback URL, wait for SPA to process and redirect to /web/
  if (page.url().includes('config/redirect')) {
    testLogger.info('[alpha1] On OAuth callback URL, waiting for SPA redirect to /web/...');
    await page.waitForURL(/web\//, { timeout: 60000 });
  }

  // Check if login failed (Dex error page)
  if (/dex\/.*error/.test(page.url())) {
    throw new Error(`Login failed — Dex returned error page: ${page.url()}`);
  }
  testLogger.info(`[alpha1] After submit navigation: ${page.url()}`);

  // Step 6: Check if we're on a Dex approval page
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

  // Step 7: Wait for the app to fully load
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
  // the token from the hash before the session is valid.
  if (page.url().includes('/cb#') || page.url().includes('/cb?')) {
    testLogger.info('[alpha1] On callback URL — waiting for SPA token processing...');
    try {
      await page.waitForURL(
        url => !url.toString().includes('/cb'),
        { timeout: 90000 }
      );
      testLogger.info(`[alpha1] Callback processed, now at: ${page.url()}`);
    } catch (e) {
      // Reload the current page (preserves the hash fragment with the id_token)
      // so the SPA gets another chance to process the token.
      // page.goto('/web/') would lose the hash and the session.
      testLogger.warn('[alpha1] Callback did not auto-redirect after 90s, reloading to retry...');
      await page.reload({ waitUntil: 'domcontentloaded' });
      // Give SPA another 30s to process after reload
      try {
        await page.waitForURL(
          url => !url.toString().includes('/cb'),
          { timeout: 30000 }
        );
        testLogger.info(`[alpha1] Callback processed after reload, now at: ${page.url()}`);
      } catch (e2) {
        testLogger.warn('[alpha1] Callback still stuck after reload — session likely lost');
      }
    }
  }

  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch((e) =>
    testLogger.warn('[alpha1] networkidle timeout:', { error: e.message })
  );

  // Step 8: Verify login success
  testLogger.info(`[alpha1] Verifying login at: ${page.url()}`);

  if (page.url().includes('dex')) {
    throw new Error(`Login failed — redirected back to Dex after token exchange: ${page.url()}`);
  }

  await page.locator('[data-test="menu-link-\\/-item"]').waitFor({ state: 'visible', timeout: 15000 });
  testLogger.info('[alpha1] Login successful — main menu visible');
}

/**
 * Submit the Dex login form with multiple strategies.
 * Tries: 1) Enter on password field, 2) force-click submit button, 3) form.submit() via JS
 *
 * Enter on password field is tried first because it's the most reliable —
 * the cursor is already in the password field after fill(), and pressing Enter
 * on a focused input submits the containing form.
 */
async function submitDexLoginForm(page) {
  // Strategy 1: Press Enter on the password field (cursor is there after fill)
  // passwordField.press('Enter') focuses the element first, unlike page.keyboard.press
  try {
    const pwField = page.locator('input[name="password"], input[type="password"]').first();
    await pwField.press('Enter');
    testLogger.info('[alpha1] Form submitted via Enter on password field');
    return;
  } catch (e) {
    testLogger.warn('[alpha1] Enter on password field failed, trying button click...');
  }

  // Strategy 2: Force-click the submit button
  try {
    const submitButton = page.locator(
      'button[type="submit"], form button:has-text("Login"), form button:has-text("Sign In"), form button:has-text("Log In")'
    ).first();
    await submitButton.click({ force: true, timeout: 5000 });
    testLogger.info('[alpha1] Form submitted via button click');
    return;
  } catch (e) {
    testLogger.warn('[alpha1] Button click failed, trying JS form.submit()...');
  }

  // Strategy 3: Submit via JavaScript
  await page.evaluate(() => {
    const form = document.querySelector('form');
    if (!form) throw new Error('No form found on Dex login page');
    form.submit();
  });
  testLogger.info('[alpha1] Form submitted via JS form.submit()');
}

/**
 * Switch the active org via the navbar dropdown — necessary because the
 * Pinia store binds API calls to whatever org was loaded at login. Setting
 * ?org_identifier=... in the URL does NOT update the store; only the
 * dropdown click flow does.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} targetOrgId  org identifier from ORGNAME env (e.g. 3B4JlN…)
 */
async function switchOrgViaDropdown(page, targetOrgId) {
  testLogger.info(`[alpha1] Switching active org to: ${targetOrgId}`);

  // Land on /web/ so the navbar (and its org dropdown) renders
  const baseUrl = (process.env.ZO_BASE_URL || '').replace(/\/$/, '');
  await page.goto(`${baseUrl}/web/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('[data-test="menu-link-\\/-item"]').waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(2000); // navbar dropdown needs SPA hydration

  // Map identifier → org name (dropdown options are by name, not identifier)
  const orgs = await page.evaluate(async () => {
    const r = await fetch('/api/organizations?page_num=0&page_size=100');
    return r.ok ? (await r.json()).data : null;
  });
  if (!orgs || !orgs.length) {
    throw new Error('[alpha1] /api/organizations returned no data — cannot resolve target org');
  }
  const target = orgs.find(o => o.identifier === targetOrgId);
  if (!target) {
    const available = orgs.map(o => `${o.name} (${o.identifier})`).join(', ');
    throw new Error(`[alpha1] Target org ${targetOrgId} not found. Available: ${available}`);
  }
  testLogger.info(`[alpha1] Target org resolved: ${target.name} (${target.identifier})`);

  // Open dropdown → search-filter → click menu item
  // (search-input + menu-item-label is more reliable than role=option matching)
  const dropdown = page.locator('[data-test="navbar-organizations-select"]');
  await dropdown.waitFor({ state: 'visible', timeout: 15000 });
  await dropdown.getByText('arrow_drop_down').click({ force: true });
  await page.waitForTimeout(1500);

  const searchInput = page.locator('[data-test="organization-search-input"]');
  await searchInput.waitFor({ state: 'visible', timeout: 10000 });
  await searchInput.fill(target.name);
  await page.waitForTimeout(1500);

  // Filter menu items by exact org name (regex anchors prevent partial matches
  // — e.g. an org "Foo" would otherwise also match a row containing "Foo Bar")
  const escapedName = target.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const menuItem = page
    .locator('[data-test="organization-menu-item-label-item-label"]')
    .filter({ hasText: new RegExp(`^\\s*${escapedName}\\s*\\|`) })
    .first();
  await menuItem.waitFor({ state: 'visible', timeout: 5000 });
  await menuItem.click();

  // Wait for URL to reflect new org (Vue router updates on store change)
  await page.waitForFunction(
    (orgId) => new URL(location.href).searchParams.get('org_identifier') === orgId,
    targetOrgId,
    { timeout: 15000 },
  ).catch(() => testLogger.warn('[alpha1] URL did not reflect new org after switch'));
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  testLogger.info(`[alpha1] Org switch complete; current URL: ${page.url()}`);
}

/**
 * Fetch org identifier and passcode, save to cloud-config.json.
 */
async function fetchCloudConfig(page) {
  testLogger.info('[alpha1] Fetching org identifier and passcode...');
  try {
    const orgsResponse = await page.evaluate(async () => {
      const r = await fetch('/api/organizations?page_num=0&page_size=100');
      return r.ok ? await r.json() : null;
    });

    if (orgsResponse && orgsResponse.data && orgsResponse.data.length > 0) {
      // Use ORGNAME from env/yml to find the correct org, fall back to first non-_meta
      const envOrgId = process.env.ORGNAME;
      let org;
      if (envOrgId && envOrgId !== 'default') {
        org = orgsResponse.data.find(o => o.identifier === envOrgId);
        if (org) {
          testLogger.info(`[alpha1] Matched org from ORGNAME env: ${org.name} (${org.identifier})`);
        } else {
          testLogger.warn(`[alpha1] ORGNAME "${envOrgId}" not found in user orgs, falling back to first`);
        }
      }
      if (!org) {
        org = orgsResponse.data.find(o => o.identifier !== '_meta') || orgsResponse.data[0];
      }
      const orgIdentifier = org.identifier;
      testLogger.info(`[alpha1] User org: ${org.name} (${orgIdentifier})`);

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

        fs.writeFileSync(CLOUD_CONFIG_FILE, JSON.stringify(cloudConfig, null, 2));
        testLogger.info(`[alpha1] Cloud config saved to ${CLOUD_CONFIG_FILE}`);
      } else {
        testLogger.warn('[alpha1] Could not fetch passcode');
      }
    } else {
      testLogger.warn('[alpha1] Could not fetch organizations');
    }
  } catch (e) {
    testLogger.warn('[alpha1] Failed to fetch cloud config', { error: e.message });
  }
}

/**
 * Ingest test data into streams so they appear in UI dropdowns.
 * Uses cloud auth (email:passcode) from cloud-config.json.
 */
async function performGlobalIngestion(page) {
  let headers;
  let orgId;

  try {
    const cloudConfig = JSON.parse(fs.readFileSync(CLOUD_CONFIG_FILE, 'utf-8'));
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

  const streams = [
    { name: 'e2e_automate', data: logsdata },
    { name: 'auto_playwright_stream', data: [{ level: 'info', job: 'test', log: 'test message for openobserve' }] },
  ];

  for (const stream of streams) {
    try {
      const response = await page.evaluate(async ({ headers, orgId, streamName, data }) => {
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

  // Wait for streams to be indexed
  testLogger.info('[alpha1] Waiting for streams to be indexed...');
  const maxWaitMs = 90000;
  const pollIntervalMs = 3000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const streamsResult = await page.evaluate(async ({ orgId, headers }) => {
        const r = await fetch(`/api/${orgId}/streams?type=logs&page_num=0&page_size=1000`, { headers });
        if (!r.ok) return { ok: false, status: r.status };
        const data = await r.json();
        const names = (data.list || []).map(s => s.name);
        return { ok: true, names };
      }, { orgId, headers });

      if (streamsResult.ok) {
        const hasE2e = streamsResult.names.includes('e2e_automate');
        const hasAuto = streamsResult.names.includes('auto_playwright_stream');
        if (hasE2e && hasAuto) {
          testLogger.info(`[alpha1] Both streams indexed after ${Date.now() - startTime}ms`);
          break;
        }
        testLogger.debug(`[alpha1] Streams not yet indexed (e2e_automate=${hasE2e}, auto_playwright_stream=${hasAuto}), waiting...`);
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

/**
 * Verify that shared auth state (from cleanup job artifact) is still valid.
 * Opens a browser with the storageState and checks if the session works.
 */
async function verifySharedAuth(baseUrl) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    storageState: AUTH_FILE,
    viewport: { width: 1500, height: 1024 },
  });
  const page = await context.newPage();

  try {
    // Navigate with org_identifier so the SPA loads the target org and the
    // URL reflects it — without this, page.url() never has the param and
    // the active-org check below would always trigger a needless re-switch.
    const targetOrg = process.env.ORGNAME;
    const navUrl = (targetOrg && targetOrg !== 'default')
      ? `${baseUrl}/web/?org_identifier=${encodeURIComponent(targetOrg)}`
      : `${baseUrl}/web/`;
    await page.goto(navUrl, { timeout: 60000, waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // If we ended up on Dex or login page, the session is invalid
    const url = page.url();
    if (url.includes('dex') || url.endsWith('/web/login')) {
      testLogger.warn(`[alpha1] Shared auth redirected to login: ${url}`);
      return false;
    }

    // Verify the main menu is visible
    const menuItem = page.locator('[data-test="menu-link-\\/-item"]');
    await menuItem.waitFor({ state: 'visible', timeout: 15000 });
    testLogger.info('[alpha1] Shared auth verified — menu visible');

    // Re-apply org switch + persist if active org doesn't match target
    if (targetOrg && targetOrg !== 'default') {
      const activeOrg = new URL(page.url()).searchParams.get('org_identifier');
      if (activeOrg !== targetOrg) {
        testLogger.info(`[alpha1] Active org (${activeOrg}) != target (${targetOrg}); re-switching`);
        await switchOrgViaDropdown(page, targetOrg);
        await context.storageState({ path: AUTH_FILE });
        testLogger.info(`[alpha1] Auth state re-saved with target org active`);
      }
    }
    return true;
  } catch (e) {
    testLogger.warn(`[alpha1] Shared auth verification error: ${e.message}`);
    return false;
  } finally {
    await context.close();
    await browser.close();
  }
}

/**
 * Perform data ingestion using Node.js fetch (no browser needed).
 * Used when shared auth state is available — avoids opening a browser page.
 */
async function performGlobalIngestionWithFetch() {
  let headers;
  let orgId;
  let baseUrl;

  try {
    const cloudConfig = JSON.parse(fs.readFileSync(CLOUD_CONFIG_FILE, 'utf-8'));
    orgId = cloudConfig.orgIdentifier;
    const basicAuth = Buffer.from(`${cloudConfig.userEmail}:${cloudConfig.passcode}`).toString('base64');
    headers = {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/json',
    };
    baseUrl = (process.env.ZO_BASE_URL || '').replace(/\/$/, '');
  } catch (e) {
    testLogger.warn('[alpha1] Cannot read cloud-config.json for ingestion — skipping', { error: e.message });
    return;
  }

  const streams = [
    { name: 'e2e_automate', data: logsdata },
    { name: 'auto_playwright_stream', data: [{ level: 'info', job: 'test', log: 'test message for openobserve' }] },
  ];

  for (const stream of streams) {
    try {
      const r = await fetch(`${baseUrl}/api/${orgId}/${stream.name}/_json`, {
        method: 'POST',
        headers,
        body: JSON.stringify(stream.data),
      });
      if (r.ok) {
        testLogger.info(`[alpha1] Ingested test data into '${stream.name}'`, { status: r.status });
      } else {
        const text = await r.text();
        testLogger.warn(`[alpha1] Ingestion into '${stream.name}' returned ${r.status}`, { body: text.substring(0, 200) });
      }
    } catch (e) {
      testLogger.warn(`[alpha1] Failed to ingest into '${stream.name}'`, { error: e.message });
    }
  }

  // Wait for streams to be indexed
  testLogger.info('[alpha1] Waiting for streams to be indexed...');
  const maxWaitMs = 90000;
  const pollIntervalMs = 3000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const r = await fetch(`${baseUrl}/api/${orgId}/streams?type=logs&page_num=0&page_size=1000`, { headers });
      if (r.ok) {
        const data = await r.json();
        const names = (data.list || []).map(s => s.name);
        if (names.includes('e2e_automate') && names.includes('auto_playwright_stream')) {
          testLogger.info(`[alpha1] Both streams indexed after ${Date.now() - startTime}ms`);
          return;
        }
      }
    } catch (e) {
      testLogger.debug(`[alpha1] Error checking streams: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  testLogger.warn(`[alpha1] Streams not fully indexed after ${maxWaitMs}ms — tests may fail on stream selection`);
}

module.exports = globalSetup;
