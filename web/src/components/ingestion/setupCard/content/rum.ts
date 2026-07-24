// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Real User Monitoring (browser SDK) setup card. Unlike the collector-based
// data-source cards, RUM authenticates with the org's RUM token — not the
// ingestion passcode — so this builder takes its own substitutions and is
// rendered directly by FrontendRumConfig.vue instead of setupCard/registry.
//
// The install + init steps share the "pkg" variant group: picking NPM or CDN
// on either step switches both, so the two read as one coherent path.

import { getImageURL } from "@/utils/zincutils";
import type { RichCardContent, RichCardStepVariant } from "../types";

/**
 * Pinned browser SDK release the CDN URLs point at — bump in one place.
 * Pinning (vs @latest) gives immutable CDN caching and no surprise upgrades.
 */
export const RUM_SDK_VERSION = "0.3.4";

const CDN_HOST = "https://browsersdk.openobserve.ai";
const cdnUrl = (bundle: string) => `${CDN_HOST}/${RUM_SDK_VERSION}/${bundle}`;

/** Per-org values substituted into the RUM snippets. */
export interface RumCardSubs {
  /** SDK `site` option — the ingestion host[:port] WITHOUT protocol. */
  site: string;
  /** Full ingestion origin (with protocol) — preconnect + CSP hints. */
  endpoint: string;
  /** Organization identifier. */
  org: string;
  /** The org's RUM client token (raw — used by copy). */
  rumToken: string;
  /** Masked token shown on screen until the user reveals it. */
  rumTokenMasked: string;
  /** true when the ingestion endpoint is plain http:// (no TLS). */
  insecureHTTP: boolean;
}

// Shared option values, rendered identically into the NPM and CDN init blocks
// so switching tabs never changes behavior — only the delivery mechanism.
const optionsBlock = (subs: RumCardSubs, token: string) => `{
  clientToken: '${token}',
  applicationId: 'web-application-id', // any string identifying your application
  site: '${subs.site}',
  organizationIdentifier: '${subs.org}',
  service: 'my-web-application',
  env: 'production',
  version: '0.0.1',
  insecureHTTP: ${subs.insecureHTTP},
  apiVersion: 'v1',
}`;

// The two init calls, shared verbatim by both variants (indented one level for
// the CDN's onReady wrappers by the caller).
const RUM_INIT_FIELDS = `  applicationId: options.applicationId,
  clientToken: options.clientToken,
  site: options.site,
  organizationIdentifier: options.organizationIdentifier,
  service: options.service,
  env: options.env,
  version: options.version,
  trackResources: true,
  trackLongTasks: true,
  trackUserInteractions: true,
  apiVersion: options.apiVersion,
  insecureHTTP: options.insecureHTTP,
  defaultPrivacyLevel: 'allow', // 'allow' | 'mask-user-input' | 'mask'
  // End-to-end trace correlation: inject tracing headers into matched requests.
  allowedTracingUrls: [
    {
      match: 'https://your-api-domain.com/api', // string, RegExp or (url) => boolean
      propagatorTypes: ['openobserve', 'tracecontext'],
    },
  ],
  sessionSampleRate: 100, // track 100% of sessions
  sessionReplaySampleRate: 50, // record 50% of sessions`;

const LOGS_INIT_FIELDS = `  clientToken: options.clientToken,
  site: options.site,
  organizationIdentifier: options.organizationIdentifier,
  service: options.service,
  env: options.env,
  version: options.version,
  forwardErrorsToLogs: true,
  insecureHTTP: options.insecureHTTP,
  apiVersion: options.apiVersion`;

const indent = (block: string, spaces: number) =>
  block
    .split("\n")
    .map((l) => " ".repeat(spaces) + l)
    .join("\n");

// ── NPM variant ──────────────────────────────────────────────────────────────

const NPM_INSTALL = "npm i @openobserve/browser-rum @openobserve/browser-logs";

const npmInit = (
  subs: RumCardSubs,
  token: string,
) => `import { openobserveRum } from '@openobserve/browser-rum';
import { openobserveLogs } from '@openobserve/browser-logs';

const options = ${optionsBlock(subs, token)};

openobserveRum.init({
${RUM_INIT_FIELDS},
});

openobserveLogs.init({
${LOGS_INIT_FIELDS},
});

// Optionally identify the user for session search
openobserveRum.setUser({
  id: '1',
  name: 'Captain Hook',
  email: 'captainhook@example.com',
});

openobserveRum.startSessionReplayRecording();`;

// ── CDN variant ──────────────────────────────────────────────────────────────

// Datadog-style async loader: creates an OO_RUM / OO_LOGS stub with an onReady
// queue, then injects the bundle with `async` so it downloads in parallel and
// never blocks parsing or first paint. Queued callbacks run when it lands.
const cdnLoader = (globalName: string, src: string) => `  (function (h, o, u, n, d) {
    h = h[d] = h[d] || { q: [], onReady: function (c) { h.q.push(c); } };
    d = o.createElement(u); d.async = 1; d.src = n;
    n = o.getElementsByTagName(u)[0]; n.parentNode.insertBefore(d, n);
  })(window, document, 'script', '${src}', '${globalName}');`;

const cdnInstall = (
  subs: RumCardSubs,
) => `<!-- Performance: resolve DNS + open the TLS connection early for the CDN and
     your OpenObserve endpoint, so neither is on the SDK's critical path. -->
<link rel="preconnect" href="${CDN_HOST}" crossorigin />
<link rel="dns-prefetch" href="${CDN_HOST}" />
<link rel="preconnect" href="${subs.endpoint}" crossorigin />
<link rel="dns-prefetch" href="${subs.endpoint}" />

<!-- Async loaders: both bundles download in parallel without blocking
     rendering. init calls queued via onReady() run as each bundle arrives. -->
<script>
${cdnLoader("OO_RUM", cdnUrl("openobserve-rum.js"))}
${cdnLoader("OO_LOGS", cdnUrl("openobserve-logs.js"))}
</script>`;

const cdnInit = (subs: RumCardSubs, token: string) => `<script>
  var options = ${indent(optionsBlock(subs, token), 2).trimStart()};

  OO_RUM.onReady(function () {
    OO_RUM.init({
${indent(RUM_INIT_FIELDS, 4)},
    });
    OO_RUM.startSessionReplayRecording();
  });

  OO_LOGS.onReady(function () {
    OO_LOGS.init({
${indent(LOGS_INIT_FIELDS, 4)},
    });
  });
</script>`;

// ── card ─────────────────────────────────────────────────────────────────────

export default function rumCard(subs: RumCardSubs): RichCardContent {
  const nodeIcon = getImageURL("images/ingestion/nodejs.svg");

  const installVariants: RichCardStepVariant[] = [
    {
      id: "npm",
      label: "NPM",
      icon: nodeIcon,
      code: { lang: "bash", raw: NPM_INSTALL },
      note: "Prefer NPM when you own the build — the SDK ships inside your bundle, versions move with your lockfile, and your CSP stays first-party.",
    },
    {
      id: "cdn",
      label: "CDN",
      code: {
        lang: "html",
        filename: "index.html",
        raw: cdnInstall(subs),
      },
      note: `Paste at the top of <head>. Pinned to v${RUM_SDK_VERSION} for immutable caching; async + preconnect keep it off the critical rendering path. For strict CSP, self-host the two bundles instead.`,
    },
  ];

  const initVariants: RichCardStepVariant[] = [
    {
      id: "npm",
      label: "NPM",
      icon: nodeIcon,
      code: {
        lang: "javascript",
        filename: "main.js",
        raw: npmInit(subs, subs.rumToken),
        masked: npmInit(subs, subs.rumTokenMasked),
      },
      note: "Run this in your app entry (main.js / index.js) before the app mounts, so early errors and first-paint timings are captured.",
    },
    {
      id: "cdn",
      label: "CDN",
      code: {
        lang: "html",
        filename: "index.html",
        raw: cdnInit(subs, subs.rumToken),
        masked: cdnInit(subs, subs.rumTokenMasked),
      },
      note: "Keep this right after the loader in <head>. onReady() queues init until each bundle arrives — nothing blocks rendering.",
    },
  ];

  return {
    provider: {
      name: "Real User Monitoring",
      tagline:
        "Capture sessions, errors, Web Vitals and session replay from your web application — your RUM token is already filled in below.",
      logo: getImageURL("images/common/monitoring.svg"),
      tone: "#3f7994",
      runtime: "Browser",
      setupTime: "~2 min",
      metaBadges: ["Sessions", "Errors", "Web Vitals", "Session Replay"],
    },
    steps: [
      {
        id: "install",
        title: "Add the SDK to Your App",
        description:
          "Pick how the SDK ships: bundle it with **NPM**, or drop the **CDN** loader into your HTML `<head>` — no build step needed.",
        chip: { kind: "terminal", label: "Install" },
        completeOn: "copy",
        required: true,
        variantGroup: "pkg",
        variants: installVariants,
      },
      {
        id: "init",
        title: "Initialize RUM + Logs",
        description:
          "Both SDKs are initialized with this org's values — copy as-is, then adjust `service`, `env` and `applicationId` to describe your app. The `clientToken` ships to visitors' browsers by design (NPM bundles it, CDN inlines it) — it can only write RUM events, and you can rotate it from this page's header anytime.",
        chip: { kind: "editor", label: "Editor" },
        completeOn: "copy",
        required: true,
        variantGroup: "pkg",
        variants: initVariants,
      },
      {
        id: "verify",
        title: "Verify Data in OpenObserve",
        description:
          "Open your app in a browser, click around for a few seconds, then hit Test — RUM events land in the `_rumdata` stream.",
        chip: { kind: "traces", label: "RUM" },
        completeOn: "detect",
        detectionAnchor: true,
        pills: ["Sessions", "Page Views", "User Actions", "Errors", "Web Vitals", "Session Replay"],
      },
    ],
    // Every session emits `view` events on init, so their presence in _rumdata
    // is the earliest reliable signal that the SDK is wired up.
    detect: {
      streamType: "logs",
      streamName: "_rumdata",
      filter: "type = 'view'",
    },
    extras: {
      fixTitle: "Allow The SDK In Your Content Security Policy",
      fixBody:
        "If your app runs but nothing arrives, the browser most likely blocked the SDK or its requests — usually a Content-Security-Policy or an ad-blocker. Allow the CDN and your OpenObserve endpoint, then reload:",
      fixLang: "yaml",
      fixSnippet: `Content-Security-Policy:
  script-src 'self' ${CDN_HOST};
  connect-src 'self' ${subs.endpoint};
  worker-src 'self' blob:;`,
      troubleshooting: [
        {
          q: "The scripts load but no data arrives",
          a: `Check the browser console and network tab. A Content-Security-Policy must allow \`script-src ${CDN_HOST}\` (CDN setup), \`connect-src ${subs.endpoint}\` and \`worker-src blob:\` — session replay records in a web worker.`,
        },
        {
          q: "Requests are blocked by ad-blockers or privacy extensions",
          a: "Some blockers filter third-party analytics scripts. Self-hosting the two bundles on your own origin (copy them from the CDN at deploy time) keeps everything first-party and avoids this entirely — it also lets you add Subresource Integrity hashes.",
        },
        {
          q: "Is it safe that the token is visible in my page source?",
          a: "Yes — the `clientToken` is a client-side token by design, like every browser RUM product's. NPM setups expose it inside the JS bundle and CDN setups inline it in the HTML; DevTools reveals it either way. It can only **write** RUM events — it grants no read access and is separate from the ingestion passcode. If someone abuses it to send fake events, regenerate it from this page's header and redeploy your app.",
        },
        {
          q: "RUM requests return 401 or 403",
          a: "The `clientToken` is this org's **RUM token** — not the ingestion passcode. If it was rotated, regenerate it from this page's header and update your app.",
        },
        {
          q: "My OpenObserve endpoint is plain HTTP",
          a: `Browsers refuse mixed content and the SDK defaults to HTTPS — keep \`insecureHTTP: ${subs.insecureHTTP}\` (already set from this org's endpoint) so uploads use the right scheme.`,
        },
        {
          q: "Session replays look blank or over-masked",
          a: "`defaultPrivacyLevel` controls what replay captures: `'allow'` records everything, `'mask-user-input'` hides form input, `'mask'` hides all text. Pick the strictest level your privacy policy requires.",
        },
        {
          q: "Will the SDK slow my site down?",
          a: "No — the bundles load with `async` off the critical rendering path, `preconnect` warms DNS/TLS before the first upload, and events are batched before sending. Lower `sessionReplaySampleRate` if you want to bound replay overhead further.",
        },
      ],
    },
    docUrl: "https://openobserve.ai/docs/user-guide/data-exploration/rum/setup/",
  };
}
