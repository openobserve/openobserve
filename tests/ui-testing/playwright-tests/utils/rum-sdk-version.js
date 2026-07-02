// RUM SDK version resolution
// --------------------------------------------------------------------------
// Decides which browser-SDK version the RUM E2E suite should exercise, so the
// suite always tracks new releases without editing the sample app.
//
// CDN path (script tags served from browsersdk.openobserve.ai):
//   1. Latest version published in the browser-sdk repo README — the source
//      of truth for CDN releases (the CDN itself has no "latest" alias):
//      https://github.com/openobserve/browser-sdk/blob/openobserve/README.md
//   2. RUM_SDK_VERSION env var — manual override / offline fallback.
//   3. null — keep whatever version is pinned in fixtures/rum/cdn-sample.
//
// NPM path (@openobserve/browser-rum + @openobserve/browser-logs):
//   1. `npm view` dist-tag `latest` from the npm registry.
//   2. RUM_SDK_VERSION env var.
//   3. null — reuse the already-built fixture bundle as-is.

const { execSync } = require('child_process');
const testLogger = require('./test-logger.js');

const README_URL =
  'https://raw.githubusercontent.com/openobserve/browser-sdk/openobserve/README.md';

/** Highest x.y.z among the given version strings (numeric compare per part). */
function maxSemver(versions) {
  const parse = (v) => v.split('.').map((n) => parseInt(n, 10));
  return versions.reduce((best, v) => {
    if (!best) return v;
    const [a, b] = [parse(v), parse(best)];
    for (let i = 0; i < 3; i += 1) {
      if (a[i] !== b[i]) return a[i] > b[i] ? v : best;
    }
    return best;
  }, null);
}

/**
 * Resolve the CDN bundle version to test.
 * @param {import('@playwright/test').Page} page any live page (used for HTTP)
 * @returns {Promise<string|null>} version like "0.3.4", or null for "as pinned"
 */
async function resolveCdnSdkVersion(page) {
  try {
    const res = await page.request.get(README_URL, { timeout: 15000 });
    if (res.ok()) {
      const md = await res.text();
      const versions = [...md.matchAll(/browsersdk\.openobserve\.ai\/(\d+\.\d+\.\d+)\//g)]
        .map((m) => m[1]);
      const latest = maxSemver([...new Set(versions)]);
      if (latest) {
        testLogger.info('CDN SDK version resolved from browser-sdk README', { version: latest });
        return latest;
      }
      testLogger.warn('browser-sdk README fetched but no CDN version found in it');
    } else {
      testLogger.warn('browser-sdk README fetch non-OK', { status: res.status() });
    }
  } catch (e) {
    testLogger.warn('browser-sdk README fetch failed', { error: e.message });
  }

  if (process.env.RUM_SDK_VERSION) {
    testLogger.info('CDN SDK version from RUM_SDK_VERSION env fallback', {
      version: process.env.RUM_SDK_VERSION,
    });
    return process.env.RUM_SDK_VERSION;
  }
  testLogger.warn('CDN SDK version unresolved — testing the version pinned in the sample app');
  return null;
}

/**
 * Resolve the npm package version to test (registry dist-tag `latest`).
 * @returns {string|null} version like "0.3.4", or null for "reuse existing"
 */
function resolveNpmSdkVersion() {
  try {
    const out = execSync('npm view @openobserve/browser-rum version', {
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (/^\d+\.\d+\.\d+/.test(out)) {
      testLogger.info('NPM SDK version resolved from registry', { version: out });
      return out;
    }
  } catch (e) {
    testLogger.warn('npm registry version lookup failed', { error: e.message });
  }

  if (process.env.RUM_SDK_VERSION) {
    testLogger.info('NPM SDK version from RUM_SDK_VERSION env fallback', {
      version: process.env.RUM_SDK_VERSION,
    });
    return process.env.RUM_SDK_VERSION;
  }
  testLogger.warn('NPM SDK version unresolved — reusing the existing fixture bundle');
  return null;
}

module.exports = { resolveCdnSdkVersion, resolveNpmSdkVersion, maxSemver };
