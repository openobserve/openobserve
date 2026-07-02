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
| `vendor/`        | Self-hosted SDK bundles **+ the Session Replay recorder chunk** (see below) |

Every page's `<head>` contains the **same** async loader stub and loads
`oo-rum.js`, so the SDK initializes on each navigation. Navigating between pages
produces a **multi-view session** with a continuous **Session Replay**.

The two SDK bundles expose globals `window.OO_RUM` and `window.OO_LOGS`.

## ⚠️ Why the bundles are self-hosted (`vendor/`) instead of the public CDN

Session Replay's recorder is a **lazily-loaded chunk**, separate from the main
bundle. The public CDN serves the main bundle fine (`200`), but **returns
`403 AccessDenied` for the `chunks/` directory** that holds the recorder:

```
https://browsersdk.openobserve.ai/0.3.1/openobserve-rum.js                 -> 200  ✅
https://browsersdk.openobserve.ai/0.3.1/chunks/recorder-…-openobserve-rum.js -> 403  ❌ AccessDenied
```

Result: RUM metrics work, but the browser console shows
`ChunkLoadError: Loading chunk recorder failed` and **Session Replay never
records**. This is a provisioning issue on the OpenObserve CDN, not a config
error — nothing in `oo-rum.js` can fix it.

The fix used here: **serve the bundle and its `chunks/` together from the same
origin.** `vendor/` was copied from the npm package, which ships the recorder
chunk:

```
vendor/
  openobserve-rum.js                 (main bundle, v0.3.2-beta.3)
  openobserve-logs.js
  chunks/recorder-…-openobserve-rum.js   <- the file the CDN 403s on
  chunks/profiler-…-openobserve-rum.js
```

Because the bundle auto-detects its own URL (`publicPath`) from the loading
script, the recorder chunk loads from `./vendor/chunks/…` — which is present —
and replay starts.

### Re-vendor / update the bundles

```bash
# from repo root, after `npm i` in web/
cp web/node_modules/@openobserve/browser-rum/bundle/openobserve-rum.js   tests/ui-testing/fixtures/rum/cdn-sample/vendor/
cp web/node_modules/@openobserve/browser-rum/bundle/chunks/*.js          tests/ui-testing/fixtures/rum/cdn-sample/vendor/chunks/
cp web/node_modules/@openobserve/browser-logs/bundle/openobserve-logs.js tests/ui-testing/fixtures/rum/cdn-sample/vendor/
```

> Always copy the **main bundle and its `chunks/` together** — the main bundle
> embeds the exact chunk hash it will request, so mismatched versions re-break
> the recorder.
>
> Once the CDN serves `chunks/` publicly, you can point the loader URLs back to
> `https://browsersdk.openobserve.ai/<version>/openobserve-{rum,logs}.js`.

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

- Pin the SDK version (`0.3.1` here) — don't float to "latest".
- Set `defaultPrivacyLevel` to `mask-user-input` or `mask` (this sample uses
  `mask-user-input`) so replays don't record sensitive input values.
- Tune `sessionReplaySampleRate` (replay is heavy); `sessionSampleRate: 100`
  keeps RUM metrics on every session.
- **CSP:** allow `script-src https://browsersdk.openobserve.ai` and add your
  ingestion host to `connect-src`.
- Adjust `allowedTracingUrls[].match` to your real API origin to correlate RUM
  with backend traces.
