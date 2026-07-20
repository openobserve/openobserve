// OpenObserve RUM + Logs — initialization (CDN build)
// --------------------------------------------------------------------------
// This file ONLY configures and initializes the SDK. It relies on the async
// stub injected in index.html's <head>, which has already created the
// window.OO_RUM and window.OO_LOGS queue objects. Calls to .onReady() here are
// buffered and run the instant the async bundles finish loading.
//
// Replace the values in OO_CONFIG with your OpenObserve org/RUM settings.
// In OpenObserve UI: Data Sources -> Frontend Monitoring (RUM) -> generate a
// RUM token; that screen also shows your org identifier, site, and app id.

(function () {
  'use strict';

  var OO_CONFIG = {
    // From OpenObserve -> RUM token screen:
    clientToken: 'YOUR_RUM_CLIENT_TOKEN',
    applicationId: 'web-application-id',

    // Ingestion host ONLY — no protocol, no trailing slash.
    //   cloud example:      api.openobserve.ai
    //   self-hosted example: openobserve.mycompany.com
    site: 'api.openobserve.ai',

    organizationIdentifier: 'YOUR_ORG_IDENTIFIER',

    // Identify this app/build. Keep service+env+version stable across deploys
    // so errors map to the right sourcemaps.
    service: 'cdn-rum-sample',
    env: 'production',
    version: '0.1.0',

    apiVersion: 'v1',

    // true ONLY if your ingestion endpoint is plain http:// (e.g. local dev).
    insecureHTTP: false,
  };

  // ---- Logs ---------------------------------------------------------------
  window.OO_LOGS.onReady(function () {
    window.OO_LOGS.init({
      clientToken: OO_CONFIG.clientToken,
      site: OO_CONFIG.site,
      organizationIdentifier: OO_CONFIG.organizationIdentifier,
      service: OO_CONFIG.service,
      env: OO_CONFIG.env,
      version: OO_CONFIG.version,
      apiVersion: OO_CONFIG.apiVersion,
      insecureHTTP: OO_CONFIG.insecureHTTP,
      // Forward uncaught errors and console.error to OpenObserve Logs.
      forwardErrorsToLogs: true,
    });
  });

  // ---- RUM + Session Replay ----------------------------------------------
  window.OO_RUM.onReady(function () {
    window.OO_RUM.init({
      applicationId: OO_CONFIG.applicationId,
      clientToken: OO_CONFIG.clientToken,
      site: OO_CONFIG.site,
      organizationIdentifier: OO_CONFIG.organizationIdentifier,
      service: OO_CONFIG.service,
      env: OO_CONFIG.env,
      version: OO_CONFIG.version,
      apiVersion: OO_CONFIG.apiVersion,
      insecureHTTP: OO_CONFIG.insecureHTTP,

      // Performance signals — these answer "is slow JS being tracked?":
      trackResources: true, // resource timing: slow JS/CSS/image downloads
      trackLongTasks: true, // long tasks: slow JS execution blocking the main thread
      trackUserInteractions: true,

      // Name user actions after data-test attributes instead of raw DOM text.
      actionNameAttribute: 'data-test',

      // 'allow' | 'mask-user-input' | 'mask'. Use 'mask-user-input' or 'mask'
      // in production to avoid recording sensitive field values in replays.
      defaultPrivacyLevel: 'mask-user-input',

      // Correlate frontend RUM with backend traces by injecting trace headers
      // into matching outgoing requests. Adjust the match pattern to your API.
      allowedTracingUrls: [
        {
          match: 'https://' + OO_CONFIG.site,
          propagatorTypes: ['openobserve', 'tracecontext'],
        },
      ],

      sessionSampleRate: 100,        // collect RUM for 100% of sessions
      sessionReplaySampleRate: 100,  // record replay for 100% of sessions (use a lower value in prod — replay is heavy)
    });

    window.OO_RUM.startSessionReplayRecording({ force: true });
  });
})();
