const fs = require('fs');
const path = require('path');
const { isCloudEnvironment } = require('../../pages/cloudPages/cloud-env.js');

let _cloudConfig = null;

/**
 * Reads and caches the cloud config written by global-setup-alpha1.js.
 * Contains: orgIdentifier, orgName, userEmail, passcode
 */
function getCloudConfig() {
    if (_cloudConfig) return _cloudConfig;
    const configFile = path.join(__dirname, 'auth', 'cloud-config.json');
    try {
        if (fs.existsSync(configFile)) {
            _cloudConfig = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
        }
    } catch (e) {
        // Config not available — will fall back to env vars
    }
    return _cloudConfig;
}

/**
 * Returns auth headers appropriate for the current environment.
 * - Cloud: Basic Auth with email:passcode (fetched during global setup)
 * - Self-hosted: Basic Auth with email:password (from env vars)
 */
function getAuthHeaders() {
    if (isCloudEnvironment()) {
        const config = getCloudConfig();
        if (config && config.passcode) {
            const basicAuthCredentials = Buffer.from(
                `${config.userEmail}:${config.passcode}`
            ).toString('base64');
            return {
                'Authorization': `Basic ${basicAuthCredentials}`,
                'Content-Type': 'application/json',
            };
        }
        // Fallback: no passcode available, try without auth (cookies may work for some endpoints)
        const testLogger = require('./test-logger.js');
        testLogger.warn('Cloud environment active but no passcode found in cloud-config.json — ingestion calls may fail with 401');
        return {
            'Content-Type': 'application/json',
        };
    }

    const basicAuthCredentials = Buffer.from(
        `${process.env['ZO_ROOT_USER_EMAIL']}:${process.env['ZO_ROOT_USER_PASSWORD']}`
    ).toString('base64');

    return {
        'Authorization': `Basic ${basicAuthCredentials}`,
        'Content-Type': 'application/json',
    };
}

/**
 * Returns the correct org identifier for the current environment.
 * - Cloud: from cloud-config.json (fetched during global setup)
 * - Self-hosted: from ORGNAME env var
 */
function getOrgIdentifier() {
    if (isCloudEnvironment()) {
        const config = getCloudConfig();
        if (config && config.orgIdentifier) {
            return config.orgIdentifier;
        }
    }
    return process.env['ORGNAME'];
}

/**
 * Drop the in-memory cloud-config cache so the next getCloudConfig()/getAuthHeaders()
 * re-reads cloud-config.json from disk. Call after the file has been rewritten with a
 * fresh passcode (refreshCloudConfig / re-auth).
 */
function resetCloudConfigCache() {
    _cloudConfig = null;
}

/**
 * Re-fetch this org's passcode using the page's LIVE browser session (cookie auth) and
 * rewrite cloud-config.json. Cheap and non-disruptive (a background fetch — no navigation),
 * so it's safe to call mid-test. Recovers the common cloud failure where the per-org passcode
 * was rotated/invalidated by another shard sharing the org while the UI session is still alive.
 * Returns true if a fresh passcode was obtained.
 * @param {import('@playwright/test').Page} page
 */
async function refreshCloudConfig(page) {
    if (!isCloudEnvironment()) return false;
    try {
        const orgId = getOrgIdentifier();
        const pc = await page.evaluate(async (org) => {
            const r = await fetch('/api/' + org + '/passcode');
            return r.ok ? await r.json() : null;
        }, orgId);
        if (pc && pc.data && pc.data.passcode) {
            const next = { ...(getCloudConfig() || {}), orgIdentifier: orgId, userEmail: pc.data.user, passcode: pc.data.passcode };
            const configFile = path.join(__dirname, 'auth', 'cloud-config.json');
            try { fs.writeFileSync(configFile, JSON.stringify(next, null, 2)); } catch (e) { /* fall through with in-memory value */ }
            _cloudConfig = next;
            const testLogger = require('./test-logger.js');
            testLogger.info('[auth] Refreshed cloud passcode after 401');
            return true;
        }
    } catch (e) {
        // session may itself be dead — caller escalates to full re-auth
    }
    return false;
}

/**
 * page.request wrapper that self-heals on 401/403: refreshes the passcode (and, if the
 * session itself is dead, escalates to a full Dex re-login) then retries. Use for
 * authenticated API calls so a transient/rotated-credential 401 doesn't fail the test.
 * @param {import('@playwright/test').Page} page
 * @param {'get'|'post'|'put'|'delete'|'patch'} method
 * @param {string} url
 * @param {object} [options] extra page.request options (data, params, ...). Any options.headers
 *   are MERGED over — not replaced with — the auth headers, so callers can add headers without
 *   clobbering the Authorization header (which would defeat the 401 self-heal).
 * @param {number} [retries] max recovery attempts on 401/403
 */
async function authedRequest(page, method, url, options = {}, retries = 1) {
    const { headers: extraHeaders, ...rest } = options;
    const buildOpts = () => ({ headers: { ...getAuthHeaders(), ...(extraHeaders || {}) }, ...rest });
    let resp = await page.request[method](url, buildOpts());
    for (let i = 0; i < retries && (resp.status() === 401 || resp.status() === 403); i++) {
        let recovered = await refreshCloudConfig(page);
        if (!recovered) {
            // Session itself is likely dead — lazy-require to avoid a circular import.
            try { recovered = await require('./reauth-alpha1.js').reauthenticateAlpha1(page); }
            catch (e) { recovered = false; }
        }
        if (!recovered) break;
        // Rebuild opts so the refreshed passcode (getAuthHeaders) is picked up on retry.
        resp = await page.request[method](url, buildOpts());
    }
    return resp;
}

module.exports = { getAuthHeaders, isCloudEnvironment, getCloudConfig, getOrgIdentifier, resetCloudConfigCache, refreshCloudConfig, authedRequest };
