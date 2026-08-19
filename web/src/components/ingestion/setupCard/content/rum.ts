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

import { raw, type TranslateFn } from "@/types/i18n";

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

// Standard RUM-agent async loader: creates an OO_RUM / OO_LOGS stub with an onReady
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

export default function rumCard(subs: RumCardSubs, t: TranslateFn): RichCardContent {
  const nodeIcon = getImageURL("images/ingestion/nodejs.svg");

  const installVariants: RichCardStepVariant[] = [
    {
      id: "npm",
      label: raw("NPM"),
      icon: nodeIcon,
      code: { lang: "bash", raw: NPM_INSTALL },
      note: t("ingestion.setupCard.rumNpmInstallNote"),
    },
    {
      id: "cdn",
      label: raw("CDN"),
      code: {
        lang: "html",
        filename: "index.html",
        raw: cdnInstall(subs),
      },
      note: t("ingestion.setupCard.rumCdnInstallNote", { version: RUM_SDK_VERSION }),
    },
  ];

  const initVariants: RichCardStepVariant[] = [
    {
      id: "npm",
      label: raw("NPM"),
      icon: nodeIcon,
      code: {
        lang: "javascript",
        filename: "main.js",
        raw: npmInit(subs, subs.rumToken),
        masked: npmInit(subs, subs.rumTokenMasked),
      },
      note: t("ingestion.setupCard.rumNpmInitNote"),
    },
    {
      id: "cdn",
      label: raw("CDN"),
      code: {
        lang: "html",
        filename: "index.html",
        raw: cdnInit(subs, subs.rumToken),
        masked: cdnInit(subs, subs.rumTokenMasked),
      },
      note: t("ingestion.setupCard.rumCdnInitNote"),
    },
  ];

  return {
    provider: {
      name: t("ingestion.setupCard.providerNameRum"),
      tagline: t("ingestion.setupCard.rumTagline"),
      logo: getImageURL("images/common/monitoring.svg"),
      tone: "#3f7994",
      runtime: t("ingestion.setupCard.runtimeBrowser"),
      setupTime: t("ingestion.setupCard.setupTime2Min"),
      metaBadges: [t("rum.sessions"), t("rum.errors"), t("rum.webVitals"), t("rum.sessionReplay")],
    },
    steps: [
      {
        id: "install",
        titleKey: "ingestion.setupCard.rumInstallTitle",
        descriptionKey: "ingestion.setupCard.rumInstallDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipInstall" },
        completeOn: "copy",
        required: true,
        variantGroup: "pkg",
        variants: installVariants,
      },
      {
        id: "init",
        titleKey: "ingestion.setupCard.rumInitTitle",
        descriptionKey: "ingestion.setupCard.rumInitDesc",
        chip: { kind: "editor", labelKey: "ingestion.setupCard.chipEditor" },
        completeOn: "copy",
        required: true,
        variantGroup: "pkg",
        variants: initVariants,
      },
      {
        id: "verify",
        titleKey: "ingestion.setupCard.verifyDataTitle",
        descriptionKey: "ingestion.setupCard.verifyRumDesc",
        chip: { kind: "traces", label: raw("RUM") },
        completeOn: "detect",
        detectionAnchor: true,
        pills: [
          t("rum.sessions"),
          t("ingestion.setupCard.pillPageViews"),
          t("ingestion.setupCard.pillUserActions"),
          t("rum.errors"),
          t("rum.webVitals"),
          t("rum.sessionReplay"),
        ],
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
      fixTitle: t("ingestion.setupCard.rumFixTitle"),
      fixBody: t("ingestion.setupCard.rumFixBody"),
      fixLang: "yaml",
      fixSnippet: `Content-Security-Policy:
  script-src 'self' ${CDN_HOST};
  connect-src 'self' ${subs.endpoint};
  worker-src 'self' blob:;`,
      troubleshooting: [
        {
          q: t("ingestion.setupCard.rumTroubleNoDataQ"),
          a: t("ingestion.setupCard.rumTroubleNoDataA", {
            cdnHost: CDN_HOST,
            endpoint: subs.endpoint,
          }),
        },
        {
          q: t("ingestion.setupCard.rumTroubleBlockersQ"),
          a: t("ingestion.setupCard.rumTroubleBlockersA"),
        },
        {
          q: t("ingestion.setupCard.rumTroubleTokenVisibleQ"),
          a: t("ingestion.setupCard.rumTroubleTokenVisibleA"),
        },
        {
          q: t("ingestion.setupCard.rumTrouble401Q"),
          a: t("ingestion.setupCard.rumTrouble401A"),
        },
        {
          q: t("ingestion.setupCard.rumTroublePlainHttpQ"),
          a: t("ingestion.setupCard.rumTroublePlainHttpA", {
            insecureHTTP: subs.insecureHTTP,
          }),
        },
        {
          q: t("ingestion.setupCard.rumTroubleMaskedQ"),
          a: t("ingestion.setupCard.rumTroubleMaskedA"),
        },
        {
          q: t("ingestion.setupCard.rumTroublePerfQ"),
          a: t("ingestion.setupCard.rumTroublePerfA"),
        },
      ],
    },
    docUrl: "https://openobserve.ai/docs/user-guide/data-exploration/rum/setup/",
  };
}
