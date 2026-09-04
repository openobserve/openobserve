/**
 * Cloud environment detection utility.
 * Single source of truth for determining if tests are running against a cloud environment.
 */
function isCloudEnvironment() {
    return process.env.IS_CLOUD === 'true';
}

module.exports = { isCloudEnvironment };
