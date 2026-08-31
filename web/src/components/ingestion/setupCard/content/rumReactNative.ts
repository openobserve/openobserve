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

// Real User Monitoring — React Native SDK setup card.
//
// Sibling of ./rum.ts (the browser card): same RUM token, same `_rumdata`
// stream, but a different runtime, different install path and — critically —
// a different endpoint story, so it gets its own card rather than a third code
// tab on the browser one. FrontendRumConfig.vue switches between the two.
//
// Endpoint shape (see the backend's rum_routes):
//   POST /rum/v1/{org}/rum      RUM events
//   POST /rum/v1/{org}/logs     logs
//   POST /rum/v1/{org}/replay   session replay segments
//
// The core SDK appends the feature segment (`/rum`, `/logs`) to its
// customEndpoint, so it takes the BASE `/rum/v1/{org}`. Session Replay does
// NOT — it is configured separately and takes the FULL `/replay` URL. That
// asymmetry is the single most common reason RUM events arrive while session
// replay silently does not, so it gets its own step and its own FAQ entry.

import { raw, type TranslateFn } from "@/types/i18n";

import { getImageURL } from "@/utils/zincutils";
import type { RichCardContent, RichCardStepVariant } from "../types";

/** Published React Native SDK release these snippets are written against. */
export const RUM_RN_SDK_VERSION = "0.1.0";

const PKG_CORE = "@openobserve/mobile-react-native";
const PKG_REPLAY = "@openobserve/mobile-react-native-session-replay";
const PKG_NAV = "@openobserve/mobile-react-navigation";

/** Per-org values substituted into the React Native snippets. */
export interface RumReactNativeCardSubs {
  /** Full ingestion origin (with protocol), no trailing slash. */
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

/** Base URL the core SDK appends `/rum` and `/logs` to. */
export const rumBaseUrl = (subs: RumReactNativeCardSubs) => `${subs.endpoint}/rum/v1/${subs.org}`;

/** Full URL Session Replay posts to verbatim. */
export const replayUrl = (subs: RumReactNativeCardSubs) => `${rumBaseUrl(subs)}/replay`;

// ── install ──────────────────────────────────────────────────────────────────

const installCmd = (add: string) => `${add} ${PKG_CORE} \\
  ${PKG_REPLAY} \\
  ${PKG_NAV}

# iOS only — link the native pods after installing.
npx pod-install`;

// ── initialize ───────────────────────────────────────────────────────────────

const initCode = (subs: RumReactNativeCardSubs, token: string) =>
  `import React from 'react';
import {
  OpenObserveProvider,
  OpenObserveProviderConfiguration,
  TrackingConsent,
} from '${PKG_CORE}';

const config = new OpenObserveProviderConfiguration(
  '${token}', // clientToken — this org's RUM token
  'production', // env
  TrackingConsent.GRANTED,
  {
    // The SDK appends /rum and /logs to these base URLs.
    rumConfiguration: {
      applicationId: 'my-mobile-app', // any string identifying your app
      customEndpoint: '${rumBaseUrl(subs)}',
      sessionSampleRate: 100, // track 100% of sessions
      trackInteractions: true,
      trackResources: true,
      trackErrors: true,
      nativeCrashReportEnabled: true,
    },
    logsConfiguration: {
      customEndpoint: '${rumBaseUrl(subs)}',
    },${
      subs.insecureHTTP
        ? `
    // Your endpoint is plain http:// — Android blocks cleartext by default.
    additionalConfiguration: { '_dd.needsClearTextHttp': true },`
        : ""
    }
  },
);

config.service = 'my-mobile-app';

export default function App() {
  return (
    <OpenObserveProvider configuration={config}>
      {/* your app */}
    </OpenObserveProvider>
  );
}`;

// ── session replay ───────────────────────────────────────────────────────────

const replayCode = (subs: RumReactNativeCardSubs) =>
  `import { OpenObserveProvider } from '${PKG_CORE}';
import {
  SessionReplay,
  TextAndInputPrivacyLevel,
  ImagePrivacyLevel,
  TouchPrivacyLevel,
} from '${PKG_REPLAY}';

<OpenObserveProvider
  configuration={config}
  onInitialization={() => {
    SessionReplay.enable({
      replaySampleRate: 100, // record 100% of sampled sessions
      startRecordingImmediately: true,
      // Session Replay does NOT inherit rumConfiguration.customEndpoint and
      // does NOT append a path — give it the FULL /replay URL or segments
      // never reach OpenObserve.
      customEndpoint: '${replayUrl(subs)}',
      // Privacy defaults are MASK_ALL. Relax only as far as your policy allows.
      textAndInputPrivacyLevel: TextAndInputPrivacyLevel.MASK_SENSITIVE_INPUTS,
      imagePrivacyLevel: ImagePrivacyLevel.MASK_NONE,
      touchPrivacyLevel: TouchPrivacyLevel.SHOW,
    }).catch(() => {});
  }}
>
  {/* your app */}
</OpenObserveProvider>`;

// ── navigation tracking ──────────────────────────────────────────────────────

const navCode = `import { useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { O2RumReactNavigationTracking } from '${PKG_NAV}';

const navigationRef = useRef(null);

<NavigationContainer
  ref={navigationRef}
  onReady={() => {
    // Every route change becomes a RUM view.
    O2RumReactNavigationTracking.startTrackingViews(navigationRef.current);
  }}
>
  {/* your screens */}
</NavigationContainer>`;

// ── card ─────────────────────────────────────────────────────────────────────

export default function rumReactNativeCard(
  subs: RumReactNativeCardSubs,
  t: TranslateFn,
): RichCardContent {
  const nodeIcon = getImageURL("images/ingestion/nodejs.svg");

  const installVariants: RichCardStepVariant[] = [
    {
      id: "npm",
      label: raw("npm"),
      icon: nodeIcon,
      code: { lang: "bash", raw: installCmd("npm install") },
      note: t("ingestion.setupCard.rnInstallNote"),
    },
    {
      id: "yarn",
      label: raw("Yarn"),
      icon: nodeIcon,
      code: { lang: "bash", raw: installCmd("yarn add") },
      note: t("ingestion.setupCard.rnInstallNote"),
    },
  ];

  return {
    provider: {
      // Same title as the browser card by design — the platform switch sitting
      // next to it already says which guide you are on, so the heading stays
      // stable across platforms instead of rewriting itself on every click.
      name: t("ingestion.setupCard.providerNameRum"),
      tagline: t("ingestion.setupCard.rumReactNativeTagline"),
      logo: getImageURL("images/common/monitoring.svg"),
      tone: "#3f7994",
      runtime: raw("iOS / Android"),
      setupTime: t("ingestion.setupCard.setupTime5Min"),
      metaBadges: [
        t("rum.sessions"),
        t("ingestion.setupCard.pillViews"),
        t("rum.errors"),
        t("ingestion.setupCard.pillCrashes"),
        t("rum.sessionReplay"),
      ],
    },
    steps: [
      {
        id: "install",
        titleKey: "ingestion.setupCard.installReactNativeSdkTitle",
        descriptionKey: "ingestion.setupCard.installReactNativeSdkDesc",
        chip: { kind: "terminal", labelKey: "ingestion.setupCard.chipInstall" },
        completeOn: "copy",
        required: true,
        variantGroup: "pkg",
        variants: installVariants,
      },
      {
        id: "init",
        titleKey: "ingestion.setupCard.rumInitTitle",
        descriptionKey: "ingestion.setupCard.initRumLogsDesc",
        chip: { kind: "editor", label: raw("App.tsx") },
        completeOn: "copy",
        required: true,
        code: {
          lang: "tsx",
          filename: "App.tsx",
          raw: initCode(subs, subs.rumToken),
          masked: initCode(subs, subs.rumTokenMasked),
        },
        note: t("ingestion.setupCard.rnInitNote"),
      },
      {
        id: "session-replay",
        titleKey: "ingestion.setupCard.enableSessionReplayTitle",
        descriptionKey: "ingestion.setupCard.enableSessionReplayDesc",
        chip: { kind: "editor", label: raw("App.tsx") },
        completeOn: "copy",
        code: {
          lang: "tsx",
          filename: "App.tsx",
          raw: replayCode(subs),
        },
        pills: [
          t("ingestion.setupCard.pillWireframeCapture"),
          t("ingestion.setupCard.pillPrivacyMasking"),
          t("ingestion.setupCard.pillAndroidVerified"),
        ],
        note: t("ingestion.setupCard.rnSessionReplayNote"),
      },
      {
        id: "navigation",
        titleKey: "ingestion.setupCard.trackScreensTitle",
        descriptionKey: "ingestion.setupCard.trackScreensDesc",
        chip: { kind: "editor", labelKey: "ingestion.setupCard.chipEditor" },
        completeOn: "copy",
        code: {
          lang: "tsx",
          filename: "App.tsx",
          raw: navCode,
        },
        note: t("ingestion.setupCard.rnNavigationNote"),
      },
      {
        id: "verify",
        titleKey: "ingestion.setupCard.verifyDataTitle",
        descriptionKey: "ingestion.setupCard.verifyReactNativeRumDesc",
        chip: { kind: "traces", label: raw("RUM") },
        completeOn: "detect",
        detectionAnchor: true,
        pills: [
          t("rum.sessions"),
          t("ingestion.setupCard.pillViews"),
          t("ingestion.setupCard.pillUserActions"),
          t("rum.errors"),
          t("ingestion.setupCard.pillCrashes"),
          t("rum.sessionReplay"),
        ],
      },
    ],
    // The SDK stamps `source` on every event, so filtering on it confirms the
    // React Native SDK specifically — not a browser session on the same org.
    detect: {
      streamType: "logs",
      streamName: "_rumdata",
      filter: "source = 'react-native'",
    },
    extras: {
      installs: [PKG_CORE, PKG_REPLAY, PKG_NAV],
      fixTitle: t("ingestion.setupCard.rnFixTitle"),
      fixBody: t("ingestion.setupCard.rnFixBody"),
      fixLang: "bash",
      fixSnippet: `# Android emulator  → your machine is 10.0.2.2
${rumBaseUrl(subs).replace(/\/\/(localhost|127\.0\.0\.1)/, "//10.0.2.2")}

# iOS simulator    → localhost works as-is
${rumBaseUrl(subs)}

# Physical device  → your machine's LAN IP, reachable from the same network
http://192.168.1.10:5080/rum/v1/${subs.org}`,
      troubleshooting: [
        {
          q: t("ingestion.setupCard.rnTroubleNoReplayQ"),
          a: t("ingestion.setupCard.rnTroubleNoReplayA", { replayUrl: replayUrl(subs) }),
        },
        {
          q: t("ingestion.setupCard.rnTroubleIosReplayQ"),
          a: t("ingestion.setupCard.rnTroubleIosReplayA"),
        },
        {
          q: t("ingestion.setupCard.rnTroubleNothingArrivesQ"),
          a: t("ingestion.setupCard.rnTroubleNothingArrivesA"),
        },
        {
          q: t("ingestion.setupCard.rnTroubleCleartextQ"),
          a: t("ingestion.setupCard.rnTroubleCleartextA", {
            config: "{ '_dd.needsClearTextHttp': true }",
          }),
        },
        {
          q: t("ingestion.setupCard.rnTroubleIosBuildQ"),
          a: t("ingestion.setupCard.rnTroubleIosBuildA"),
        },
        {
          q: t("ingestion.setupCard.rnTroubleMaskedQ"),
          a: t("ingestion.setupCard.rnTroubleMaskedA"),
        },
        {
          q: t("ingestion.setupCard.rnTrouble401Q"),
          a: t("ingestion.setupCard.rnTrouble401A"),
        },
        {
          q: t("ingestion.setupCard.rnTroubleScreenNamesQ"),
          a: t("ingestion.setupCard.rnTroubleScreenNamesA"),
        },
      ],
    },
    docUrl: "https://openobserve.ai/docs/user-guide/data-exploration/rum/setup/",
  };
}
