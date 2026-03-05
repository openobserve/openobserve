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

module.exports = { getAuthHeaders, isCloudEnvironment, getCloudConfig, getOrgIdentifier };
