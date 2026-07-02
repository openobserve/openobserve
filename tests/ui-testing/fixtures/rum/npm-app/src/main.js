// NPM-package RUM instrumentation entry (bundled by esbuild).
// --------------------------------------------------------------------------
// This is the NPM counterpart to the CDN sample's `oo-rum.js`. It imports the
// published packages, initializes RUM + Logs, and then installs `window.OO_RUM`
// / `window.OO_LOGS` shims so the SHARED sample interactions in
// `fixtures/rum/cdn-sample/app.js` run UNCHANGED (that app.js was written for
// the CDN async-loader stub which exposes an `.onReady()` queue).
//
// Config is injected by the fixture server as `window.__OO_CONFIG__` before this
// bundle executes.

import { openobserveRum } from '@openobserve/browser-rum';
import { openobserveLogs } from '@openobserve/browser-logs';

const cfg = window.__OO_CONFIG__ || {};

openobserveLogs.init({
  clientToken: cfg.clientToken,
  site: cfg.site,
  organizationIdentifier: cfg.org,
  service: cfg.service,
  env: cfg.env,
  version: cfg.version,
  apiVersion: 'v1',
  insecureHTTP: cfg.insecureHTTP,
  forwardErrorsToLogs: true,
});

openobserveRum.init({
  applicationId: cfg.applicationId,
  clientToken: cfg.clientToken,
  site: cfg.site,
  organizationIdentifier: cfg.org,
  service: cfg.service,
  env: cfg.env,
  version: cfg.version,
  apiVersion: 'v1',
  insecureHTTP: cfg.insecureHTTP,
  trackResources: true,
  trackLongTasks: true,
  trackUserInteractions: true,
  actionNameAttribute: 'data-test',
  defaultPrivacyLevel: 'allow',
  sessionSampleRate: 100,
  sessionReplaySampleRate: 100,
});

openobserveRum.startSessionReplayRecording();

// The SDK objects are already initialized synchronously here, so onReady() can
// run its callback immediately. Expose the same globals the sample app expects.
if (typeof openobserveRum.onReady !== 'function') {
  openobserveRum.onReady = (cb) => cb();
}
if (typeof openobserveLogs.onReady !== 'function') {
  openobserveLogs.onReady = (cb) => cb();
}
window.OO_RUM = openobserveRum;
window.OO_LOGS = openobserveLogs;
