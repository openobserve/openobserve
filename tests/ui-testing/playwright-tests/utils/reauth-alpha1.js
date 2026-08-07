const path = require('path');
const testLogger = require('./test-logger.js');
const { isCloudEnvironment, resetCloudConfigCache } = require('./cloud-auth.js');
// Reuse the proven Dex login / org-switch / passcode-fetch helpers from global setup.
const { performDexLogin, switchOrgViaDropdown, fetchCloudConfig } = require('./global-setup-alpha1.js');

const AUTH_FILE = path.join(__dirname, 'auth', 'user.json');

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

module.exports = { reauthenticateAlpha1 };
