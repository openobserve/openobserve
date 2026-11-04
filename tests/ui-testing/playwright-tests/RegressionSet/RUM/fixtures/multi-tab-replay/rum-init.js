(function () {
  'use strict';

  var cfg = window.__O2_CONFIG__;
  window.O2_RUM.init({
    applicationId: cfg.applicationId,
    clientToken: cfg.clientToken,
    site: cfg.site,
    organizationIdentifier: cfg.org,
    service: cfg.service,
    env: 'e2e',
    version: '1.0.0',
    apiVersion: 'v1',
    insecureHTTP: cfg.insecureHTTP,
    trackUserInteractions: true,
    defaultPrivacyLevel: 'allow',
    sessionSampleRate: 100,
    sessionReplaySampleRate: 100,
  });
  // RUM SDK option, not a Playwright click: start recording even if the replay sampler would skip this session.
  window.O2_RUM.startSessionReplayRecording({ force: true });
})();
