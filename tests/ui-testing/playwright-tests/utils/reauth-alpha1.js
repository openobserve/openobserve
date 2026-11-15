const path = require('path');
const testLogger = require('./test-logger.js');
const { isCloudEnvironment, resetCloudConfigCache } = require('./cloud-auth.js');
// Reuse the proven Dex login / org-switch / passcode-fetch helpers from global setup.
const { performDexLogin, switchOrgViaDropdown, fetchCloudConfig } = require('./global-setup-alpha1.js');

const AUTH_FILE = path.join(__dirname, 'auth', 'user.json');
const LOGIN_URL = /\/dex\/|\/web\/login/;

/**
 * Mid-run recovery for Alpha1 (cloud) when the shared session/passcode has expired or been
 * invalidated by another shard sharing the same org. Performs a fresh Dex login in the CURRENT
 * browser context, re-selects ORGNAME, re-fetches the passcode, and persists the refreshed
 * storageState + cloud-config so the rest of this worker's tests (and getAuthHeaders API calls)
 * use the new credentials.
 *
 * NOTE: this navigates the page (a full login flow), so callers must treat it as a hard reset —
 * it's meant to run at a test boundary (navigateToBase) or as a last-resort escalation after a
 * cheaper passcode refresh has already failed.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<boolean>} true if re-authentication succeeded
 */
async function reauthenticateAlpha1(page) {
    if (!isCloudEnvironment()) return false;

    const baseUrl = (process.env.ZO_BASE_URL || '').replace(/\/$/, '');
    const idx = (process.env.ALPHA1_USER_INDEX || '1').trim();
    const email = (process.env[`ALPHA1_USER_EMAIL_${idx}`] || process.env.ALPHA1_USER_EMAIL || '').trim();
    const password = (process.env.ALPHA1_USER_PASSWORD || '').trim();
    if (!baseUrl || !email || !password) {
        testLogger.warn('[reauth] Missing ZO_BASE_URL / ALPHA1 creds — cannot re-authenticate');
        return false;
    }

    try {
        testLogger.info(`[reauth] Session lost — re-authenticating Dex user ${idx} (${email})`);
        await performDexLogin(page, baseUrl, email, password);

        const targetOrg = process.env.ORGNAME;
        if (targetOrg && targetOrg !== 'default') {
            await switchOrgViaDropdown(page, targetOrg);
        }

        // Persist the refreshed session so later tests in this worker reuse it,
        // and refresh the passcode used by getAuthHeaders() for API calls.
        await page.context().storageState({ path: AUTH_FILE });
        await fetchCloudConfig(page);
        resetCloudConfigCache();

        testLogger.info('[reauth] Re-authentication succeeded');
        return true;
    } catch (e) {
        testLogger.error(`[reauth] Re-authentication failed: ${e.message}`);
        return false;
    }
}

/** Goto `url` and wait for `readyLocator`, re-authenticating once if the Alpha1 session bounced it to Dex. */
async function gotoWithAlpha1Reauth(page, url, readyLocator, options = {}) {
    const { timeout = 30000, ...gotoOptions } = options;
    await page.goto(url, gotoOptions);
    if (!isCloudEnvironment()) {
        await readyLocator.waitFor({ state: 'visible', timeout });
        return;
    }

    // The SPA redirects to login only after it boots, so a one-shot page.url() check misses it.
    const onLogin = page.waitForURL(LOGIN_URL, { timeout, waitUntil: 'commit' })
        .then(() => true, () => new Promise(() => {}));
    const onReady = readyLocator.waitFor({ state: 'visible', timeout }).then(() => false);
    const sessionLost = await Promise.race([onReady, onLogin]);
    if (!sessionLost) return;

    testLogger.warn(`[reauth] ${url} redirected to login (${page.url()}) — re-authenticating`);
    if (!(await reauthenticateAlpha1(page))) {
        throw new Error(`[reauth] re-authentication failed while navigating to ${url}`);
    }
    await page.goto(url, gotoOptions);
    await readyLocator.waitFor({ state: 'visible', timeout });
}

module.exports = { reauthenticateAlpha1, gotoWithAlpha1Reauth };
