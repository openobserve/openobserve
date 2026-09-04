// RUM E2E fixture server
// --------------------------------------------------------------------------
// Serves the committed `fixtures/rum/cdn-sample` app AS-IS so a real browser can
// load the LIVE CDN RUM/Logs bundles and emit genuine SDK beacons. The ONLY
// thing this server rewrites is the OpenObserve config block inside `oo-rum.js`
// (clientToken / site / organizationIdentifier / insecureHTTP / service /
// applicationId) so the SDK ships beacons to the local instance under test.
//
// It deliberately does NOT touch the CDN <script> URLs in the HTML — the app
// keeps loading the latest published bundles from browsersdk.openobserve.ai.
//
// Usage (from a Playwright spec):
//   const { startFixtureServer } = require('../../fixtures/rum/serve.js');
//   const server = await startFixtureServer({ clientToken, org, site, service });
//   // server.url -> http://127.0.0.1:<port>/index.html
//   await server.close();

const http = require('http');
const fs = require('fs');
const path = require('path');

const SAMPLE_DIR = path.resolve(__dirname, 'cdn-sample');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

// Only plain x.y.z versions may be spliced into the sample sources. Anything
// else (URLs, path segments, replacement patterns like `$&`) is rejected up
// front rather than escaped, so no caller-provided string ever reaches a
// string-replacement position unvalidated.
const SDK_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * Rewrite the CDN bundle version segment in browsersdk.openobserve.ai URLs,
 * e.g. .../0.3.3/openobserve-rum.js -> .../<version>/openobserve-rum.js.
 * Lets the suite test any RELEASED SDK version (the CDN has no "latest"
 * alias) without editing the sample app. No-op when version is falsy.
 */
function templateSdkVersion(source, version) {
  if (!version) return source;
  if (!SDK_VERSION_PATTERN.test(version)) {
    throw new Error(`sdkVersion must be x.y.z, got "${version}"`);
  }
  // Replacer FUNCTION form: the version is inserted literally, never
  // interpreted as a $-replacement pattern.
  return source.replace(
    /(browsersdk\.openobserve\.ai\/)[^/'"]+(\/)/g,
    (_match, prefix, suffix) => prefix + version + suffix,
  );
}

/**
 * Rewrite the OO_CONFIG values inside the sample's oo-rum.js. We replace values
 * by key with a targeted regex so the rest of the sample code is untouched.
 */
function templateOoRum(source, cfg) {
  // JSON.stringify produces a fully-escaped double-quoted JS string literal
  // (handles quotes, backslashes and control chars); the replacer FUNCTION
  // form keeps `$` sequences in values from being treated as patterns.
  const set = (src, key, value) =>
    src.replace(
      new RegExp(`(${key}\\s*:\\s*)(['"]).*?\\2`),
      (_match, prefix) => prefix + JSON.stringify(String(value)),
    );

  let out = source;
  out = set(out, 'clientToken', cfg.clientToken);
  out = set(out, 'applicationId', cfg.applicationId);
  out = set(out, 'site', cfg.site);
  out = set(out, 'organizationIdentifier', cfg.org);
  out = set(out, 'service', cfg.service);
  out = set(out, 'env', cfg.env);
  out = set(out, 'version', cfg.version);
  // insecureHTTP is a boolean, not a quoted string. Coerced with Boolean()
  // and inserted via the function form so nothing user-controlled can reach a
  // replacement-pattern position.
  out = out.replace(
    /(insecureHTTP\s*:\s*)(true|false)/,
    (_match, prefix) => prefix + Boolean(cfg.insecureHTTP),
  );
  // Test-only: force-enable profiling (default sample rate is 0) so the e2e
  // suite exercises the lazy profiler chunk download from the CDN.
  out = out.replace(/(\n(\s*)sessionSampleRate\s*:)/, '\n$2profilingSampleRate: 100,$1');
  return out;
}

/**
 * Start the fixture static server.
 * @param {object} opts
 * @param {string} opts.clientToken RUM token
 * @param {string} opts.org organization identifier
 * @param {string} opts.site ingestion host WITHOUT protocol (e.g. "127.0.0.1:5080")
 * @param {boolean} [opts.insecureHTTP=true] true for plain-http ingestion (local dev)
 * @param {string} [opts.service] unique service name for this run
 * @param {string} [opts.env="e2e"]
 * @param {string} [opts.version="1.0.0"]
 * @param {string} [opts.applicationId="e2e-rum-app"]
 * @param {string} [opts.sdkVersion] override the CDN bundle version in the
 *   sample's <script> URLs (must be a released version, e.g. "0.3.4");
 *   omit to test the version pinned in the sample HTML
 * @param {number} [opts.port=0] 0 = random free port
 * @returns {Promise<{url:string, origin:string, port:number, close:()=>Promise<void>}>}
 */
function startFixtureServer(opts) {
  const cfg = {
    clientToken: opts.clientToken,
    org: opts.org,
    site: opts.site,
    insecureHTTP: opts.insecureHTTP !== false,
    service: opts.service || 'e2e-rum-cdn',
    env: opts.env || 'e2e',
    version: opts.version || '1.0.0',
    applicationId: opts.applicationId || 'e2e-rum-app',
    sdkVersion: opts.sdkVersion || null,
  };
  // Fail fast at startup instead of 500-ing per request inside the handler.
  if (cfg.sdkVersion && !SDK_VERSION_PATTERN.test(cfg.sdkVersion)) {
    return Promise.reject(new Error(`sdkVersion must be x.y.z, got "${cfg.sdkVersion}"`));
  }

  const server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const rel = urlPath === '/' ? '/index.html' : urlPath;
      // Prevent path traversal outside the sample dir.
      const filePath = path.normalize(path.join(SAMPLE_DIR, rel));
      if (!filePath.startsWith(SAMPLE_DIR)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404).end('Not found');
        return;
      }

      const ext = path.extname(filePath);
      const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
      // The JS Self-Profiling API (window.Profiler) only exists when the
      // document opts in — without this the SDK never loads the profiler chunk.
      if (ext === '.html') headers['Document-Policy'] = 'js-profiling';

      if (path.basename(filePath) === 'oo-rum.js') {
        const templated = templateOoRum(fs.readFileSync(filePath, 'utf8'), cfg);
        res.writeHead(200, headers).end(templated);
        return;
      }

      // Every sample page carries the CDN async loader, and app.js fetches a
      // CDN bundle in its resource demo — rewrite the version segment on all
      // of them so the whole app exercises the same SDK release.
      if ((ext === '.html' || ext === '.js') && cfg.sdkVersion) {
        const body = templateSdkVersion(fs.readFileSync(filePath, 'utf8'), cfg.sdkVersion);
        res.writeHead(200, headers).end(body);
        return;
      }

      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      res.writeHead(500).end(String(err && err.message));
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(opts.port || 0, '127.0.0.1', () => {
      const { port } = server.address();
      const origin = `http://127.0.0.1:${port}`;
      resolve({
        url: `${origin}/index.html`,
        origin,
        port,
        close: () =>
          new Promise((res) => server.close(() => res())),
      });
    });
  });
}

// ==========================================================================
// NPM variant — reuse the SAME sample DOM/app.js, but deliver the SDK via the
// bundled npm packages instead of the CDN loader.
// ==========================================================================

function publicConfig(cfg) {
  return {
    clientToken: cfg.clientToken,
    applicationId: cfg.applicationId,
    site: cfg.site,
    org: cfg.org,
    service: cfg.service,
    env: cfg.env,
    version: cfg.version,
    insecureHTTP: cfg.insecureHTTP,
  };
}

/**
 * Rewrite the sample HTML for the NPM path: strip the CDN async-loader <script>
 * and the `oo-rum.js` include, and inject the config + bundled entry instead.
 * Everything else (nav, buttons, app.js, styles) is reused unchanged.
 */
function rewriteHtmlForNpm(html, cfg) {
  const inject =
    `  <script>window.__OO_CONFIG__=${JSON.stringify(publicConfig(cfg))};</script>\n` +
    `  <script src="/npm-bundle.js"></script>\n`;
  return html
    // Remove the CDN async loader block (the <script> that installs OO_RUM/OO_LOGS queues).
    .replace(/<script>\s*\(function \(h, o, u, n, g\)[\s\S]*?<\/script>/, '')
    // Replace the CDN init include with the bundled entry + config.
    .replace(/<script src="\.\/oo-rum\.js"><\/script>/, inject);
}

/**
 * Start the NPM fixture server. Requires a prebuilt bundle at `bundlePath`
 * (produced by `npm ci && npm run build` in fixtures/rum/npm-app).
 * Same options as startFixtureServer, plus:
 * @param {string} opts.bundlePath absolute path to dist/bundle.js
 */
function startNpmFixtureServer(opts) {
  const cfg = {
    clientToken: opts.clientToken,
    org: opts.org,
    site: opts.site,
    insecureHTTP: opts.insecureHTTP !== false,
    service: opts.service || 'e2e-rum-npm',
    env: opts.env || 'e2e',
    version: opts.version || '1.0.0',
    applicationId: opts.applicationId || 'e2e-rum-npm-app',
  };
  const bundlePath = opts.bundlePath;

  const server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const rel = urlPath === '/' ? '/index.html' : urlPath;

      if (rel === '/npm-bundle.js') {
        if (!bundlePath || !fs.existsSync(bundlePath)) {
          res.writeHead(500).end('npm bundle not built — run `npm ci && npm run build` in fixtures/rum/npm-app');
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME['.js'] });
        fs.createReadStream(bundlePath).pipe(res);
        return;
      }

      const filePath = path.normalize(path.join(SAMPLE_DIR, rel));
      if (!filePath.startsWith(SAMPLE_DIR)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      // oo-rum.js is not used in the NPM path.
      if (path.basename(filePath) === 'oo-rum.js') {
        res.writeHead(404).end('not used in npm fixture');
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404).end('Not found');
        return;
      }

      const ext = path.extname(filePath);
      if (ext === '.html') {
        const html = rewriteHtmlForNpm(fs.readFileSync(filePath, 'utf8'), cfg);
        res.writeHead(200, { 'Content-Type': MIME['.html'] }).end(html);
        return;
      }

      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      res.writeHead(500).end(String(err && err.message));
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(opts.port || 0, '127.0.0.1', () => {
      const { port } = server.address();
      const origin = `http://127.0.0.1:${port}`;
      resolve({
        url: `${origin}/index.html`,
        origin,
        port,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

module.exports = {
  startFixtureServer,
  startNpmFixtureServer,
  templateOoRum,
  templateSdkVersion,
  rewriteHtmlForNpm,
  SAMPLE_DIR,
};
