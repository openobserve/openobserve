// Sample app interactions — each handler generates a real RUM / Logs signal so
// you can verify data is flowing into OpenObserve. None of this is required for
// RUM to work; the SDK auto-captures page views, resources, long tasks, and
// uncaught errors on its own. These buttons just make signals easy to trigger.

(function () {
  'use strict';

  var statusEl = document.getElementById('status');

  function setStatus(line) {
    var time = new Date().toLocaleTimeString();
    statusEl.textContent = '[' + time + '] ' + line + '\n' + statusEl.textContent;
  }

  // Reflect when the SDK bundles have actually loaded and initialized.
  function reportReady() {
    if (window.OO_RUM && typeof window.OO_RUM.getInternalContext === 'function') {
      setStatus('RUM ready — session active. Interact to generate events.');
    } else {
      // Still queued; the stub exists but the bundle has not parsed yet.
      setStatus('RUM stub queued — waiting for CDN bundle…');
    }
  }
  if (window.OO_RUM) window.OO_RUM.onReady(reportReady);
  if (window.OO_LOGS) window.OO_LOGS.onReady(function () { setStatus('Logs SDK ready.'); });

  window.ooSample = {
    // Clear the OpenObserve session cookie so a brand-new session is created
    // and re-sampled for Session Replay on the next load. Use this if replay
    // isn't recording because an older session was sampled out.
    resetSession: function () {
      document.cookie = '_oo_s=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
      setStatus('Cleared _oo_s session cookie. Reloading for a fresh session…');
      window.location.reload();
    },

    // RUM custom action — shows up as a named action in RUM.
    trackAction: function () {
      window.OO_RUM.onReady(function () {
        window.OO_RUM.addAction('sample_custom_action', { source: 'cdn-sample', clickedAt: Date.now() });
      });
      setStatus('Sent RUM custom action: sample_custom_action');
    },

    // Block the main thread so the Long Tasks API records it (proves
    // trackLongTasks captures slow JS execution).
    runLongTask: function () {
      var start = performance.now();
      var x = 0;
      while (performance.now() - start < 250) { x += Math.sqrt(x + 1); }
      setStatus('Ran a ~250ms long task (check RUM Long Tasks). result=' + Math.round(x));
    },

    // Generate a resource-timing entry (trackResources captures this).
    doFetch: function () {
      setStatus('Fetching https://browsersdk.openobserve.ai/0.3.4/openobserve-rum-slim.js …');
      fetch('https://browsersdk.openobserve.ai/0.3.4/openobserve-rum-slim.js', { cache: 'no-store' })
        .then(function (r) { setStatus('Fetch done: HTTP ' + r.status); })
        .catch(function (e) { setStatus('Fetch failed: ' + e.message); });
    },

    // Uncaught error — captured by RUM error tracking automatically.
    throwError: function () {
      setStatus('Throwing an uncaught error…');
      setTimeout(function () { throw new Error('Sample uncaught error from CDN RUM example'); }, 0);
    },

    // Unhandled promise rejection — also captured automatically.
    rejectPromise: function () {
      setStatus('Triggering an unhandled promise rejection…');
      Promise.reject(new Error('Sample unhandled rejection from CDN RUM example'));
    },

    // Explicit structured logs via the Logs SDK.
    logInfo: function () {
      window.OO_LOGS.onReady(function () {
        window.OO_LOGS.logger.info('Sample info log', { feature: 'cdn-sample', level: 'info' });
      });
      setStatus('Sent info log to OpenObserve Logs.');
    },

    logError: function () {
      window.OO_LOGS.onReady(function () {
        window.OO_LOGS.logger.error('Sample error log', { feature: 'cdn-sample', level: 'error' });
      });
      setStatus('Sent error log to OpenObserve Logs.');
    },

    // Attach user identity to the session.
    setUser: function () {
      var name = document.querySelector('[data-test="rum-sample-user-name-input"]').value || 'Anonymous';
      window.OO_RUM.onReady(function () {
        window.OO_RUM.setUser({ id: '1', name: name, email: 'sample@example.com' });
      });
      setStatus('Set RUM user: ' + name);
    },
  };
})();
