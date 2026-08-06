# OpenObserve RUM + Logs — CDN Sample App

A minimal, framework-free static app showing how to load the OpenObserve
**Browser RUM** and **Browser Logs** SDKs from the CDN, the optimized way:
an **async loader stub in `<head>` + `preconnect`**, so the SDK download never
blocks rendering yet still captures early errors, long tasks, and the initial
page render.

## Files

| File             | Purpose                                                                    |
| ---------------- | -------------------------------------------------------------------------- |
| `oo-rum.js`      | SDK configuration & `init()` — **edit `OO_CONFIG` here** (shared by all pages) |
| `styles.css`     | Shared styles + nav                                                         |
| `index.html`     | Home — SDK status, session reset, action/error/log buttons                 |
| `products.html`  | Product list with loading→populated transition; "Add to cart" RUM actions  |
| `checkout.html`  | Form with validation; submit fires a RUM action + log (inputs masked in replay) |
| `about.html`     | Static content + a broken-resource (404) error generator                   |
| `app.js`         | Home-page button handlers                                                   |

Every page's `<head>` contains the **same** async loader stub and loads
`oo-rum.js`, so the SDK initializes on each navigation. Navigating between pages
produces a **multi-view session** with a continuous **Session Replay**.

The two SDK bundles expose globals `window.OO_RUM` and `window.OO_LOGS`.

## Where the SDK bundles come from

Every page loads the bundles **from the live CDN**
(`https://browsersdk.openobserve.ai/<version>/openobserve-{rum,logs}.js`) via
the async-loader stub in `<head>`. A specific released version is pinned in the
HTML; when the app is served by the E2E fixture server
(`tests/ui-testing/fixtures/rum/serve.js`), the version segment can be
rewritten to any *released* version (the CDN has no `latest` alias) and the
`OO_CONFIG` block in `oo-rum.js` is templated with the run's token/site/org.

### ⚠️ Known CDN caveat: the lazy `chunks/` directory

Session Replay's recorder (and the profiler) are **lazily-loaded chunks**,
separate from the main bundle. Historically the public CDN has served the main
bundle fine (`200`) while **returning `403 AccessDenied` for the `chunks/`
directory** of some releases:

```
https://browsersdk.openobserve.ai/<v>/openobserve-rum.js                    -> 200  ✅
https://browsersdk.openobserve.ai/<v>/chunks/recorder-…-openobserve-rum.js -> 403  ❌ AccessDenied
```

When that happens RUM metrics still work, but the browser console shows
`ChunkLoadError: Loading chunk recorder failed` and **Session Replay never
records**. This is a provisioning issue on the OpenObserve CDN, not a config
error — nothing in `oo-rum.js` can fix it. The E2E suite handles it by
resolving the SDK version **best-effort** (probing candidates against the CDN
and falling back to the pin — see
`tests/ui-testing/playwright-tests/utils/rum-sdk-version.js`) and by
**skipping the session-replay assertions with a logged warning** when the
recorder chunk is not served, instead of failing CI on an external outage.

> Need a smaller bundle without Session Replay? Use `openobserve-rum-slim.js`
> (no recorder, no `chunks/` dependency) and remove the
> `startSessionReplayRecording()` call.

## Why the stub in `<head>` (not a tag at end of `<body>`)

- `async` → the bundle download never blocks HTML parsing, other JS, or CSS.
- The inline stub creates `window.OO_RUM` / `window.OO_LOGS` **synchronously**
  as small queue objects, so `init()` / `onReady()` calls made before the
  bundle arrives are buffered and flushed the instant it parses.
- Result: early **uncaught errors**, **long tasks**, and the **initial render**
  (for Session Replay) are captured — the data you'd lose with an end-of-`body`
  script tag.

### Does this track *slow JavaScript*?

Yes — two distinct signals, both enabled in `oo-rum.js`:

- `trackResources: true` → **slow JS/CSS/image downloads** via Resource Timing.
- `trackLongTasks: true` → **slow JS execution** (main-thread blocking ≥ 50ms)
  via the Long Tasks API.

Because the SDK reads *buffered* `PerformanceObserver` entries on init, slow
resources that loaded before the SDK finished downloading are still recorded.

## Configure

Open [`oo-rum.js`](./oo-rum.js) and fill in `OO_CONFIG`:

```js
var OO_CONFIG = {
  clientToken: '<OPENOBSERVE_CLIENT_TOKEN>',          // RUM token
  applicationId: 'web-application-id',
  site: '<OPENOBSERVE_SITE>',                         // host only, no https://, no trailing slash
  organizationIdentifier: '<OPENOBSERVE_ORGANIZATION_IDENTIFIER>',
  service: 'cdn-rum-sample',
  env: 'production',
  version: '0.1.0',
  apiVersion: 'v1',
  insecureHTTP: false,                                // true only for plain http:// endpoints
};
```

Get these from the OpenObserve UI: **Data Sources → Frontend Monitoring (RUM)**,
generate a RUM token; that screen also shows your org identifier, site, and
application id.

- `site` is the **ingestion host only** — strip `https://`/`http://` and any
  trailing slash (e.g. `api.openobserve.ai`).
- `insecureHTTP: true` only when your endpoint is plain `http://` (local dev).

## Run

It's static — serve the folder over HTTP (don't open via `file://`, the CDN
fetch and ingestion need a real origin):

```bash
cd tests/ui-testing/fixtures/rum/cdn-sample

# any static server works, e.g.:
python3 -m http.server 5500
# then open http://localhost:5500
```

Click the buttons to generate signals, then open your OpenObserve org's **RUM**
dashboard (and **Logs**) to see sessions, actions, errors, long tasks, and logs
arrive.

## Production checklist

- Pin the SDK version (see the loader URLs in the HTML) — don't float to "latest".
- Set `defaultPrivacyLevel` to `mask-user-input` or `mask` (this sample uses
  `mask-user-input`) so replays don't record sensitive input values.
- Tune `sessionReplaySampleRate` (replay is heavy); `sessionSampleRate: 100`
  keeps RUM metrics on every session.
- **CSP:** allow `script-src https://browsersdk.openobserve.ai` and add your
  ingestion host to `connect-src`.
- Adjust `allowedTracingUrls[].match` to your real API origin to correlate RUM
  with backend traces.
