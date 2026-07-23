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

import { getImageURL } from "@/utils/zincutils";
import type { RichCardContent, RichCardStepVariant } from "../types";

/** Published React Native SDK release these snippets are written against. */
export const RUM_RN_SDK_VERSION = "0.1.0-alpha.4";

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
export const rumBaseUrl = (subs: RumReactNativeCardSubs) =>
  `${subs.endpoint}/rum/v1/${subs.org}`;

/** Full URL Session Replay posts to verbatim. */
export const replayUrl = (subs: RumReactNativeCardSubs) =>
  `${rumBaseUrl(subs)}/replay`;

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
import { OoRumReactNavigationTracking } from '${PKG_NAV}';

const navigationRef = useRef(null);

<NavigationContainer
  ref={navigationRef}
  onReady={() => {
    // Every route change becomes a RUM view.
    OoRumReactNavigationTracking.startTrackingViews(navigationRef.current);
  }}
>
  {/* your screens */}
</NavigationContainer>`;

// ── card ─────────────────────────────────────────────────────────────────────

export default function rumReactNativeCard(
  subs: RumReactNativeCardSubs,
): RichCardContent {
  const nodeIcon = getImageURL("images/ingestion/nodejs.svg");

  const installVariants: RichCardStepVariant[] = [
    {
      id: "npm",
      label: "npm",
      icon: nodeIcon,
      code: { lang: "bash", raw: installCmd("npm install") },
      note: "The session-replay and navigation packages are optional — drop either line if you do not need screen recording or automatic view tracking.",
    },
    {
      id: "yarn",
      label: "Yarn",
      icon: nodeIcon,
      code: { lang: "bash", raw: installCmd("yarn add") },
      note: "The session-replay and navigation packages are optional — drop either line if you do not need screen recording or automatic view tracking.",
    },
  ];

  return {
    provider: {
      // Same title as the browser card by design — the platform switch sitting
      // next to it already says which guide you are on, so the heading stays
      // stable across platforms instead of rewriting itself on every click.
      name: "Real User Monitoring",
      tagline:
        "Capture sessions, views, user actions, crashes and session replay from your React Native app — your RUM token is already filled in below.",
      logo: getImageURL("images/common/monitoring.svg"),
      tone: "#3f7994",
      runtime: "iOS / Android",
      setupTime: "~5 min",
      metaBadges: ["Sessions", "Views", "Errors", "Crashes", "Session Replay"],
    },
    steps: [
      {
        id: "install",
        title: "Install the React Native SDK",
        description:
          "Add the core SDK plus the optional session-replay and navigation packages. On iOS, run `npx pod-install` afterwards so the native modules are linked.",
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
          "Wrap your app in `OpenObserveProvider`. The endpoints below are this org's — the SDK appends `/rum` and `/logs` to them. Adjust `applicationId`, `service` and `env` to describe your app. The `clientToken` ships inside your app bundle by design; it can only write RUM events and you can rotate it from this page's header.",
        chip: { kind: "editor", label: "App.tsx" },
        completeOn: "copy",
        required: true,
        code: {
          lang: "tsx",
          filename: "App.tsx",
          raw: initCode(subs, subs.rumToken),
          masked: initCode(subs, subs.rumTokenMasked),
        },
        note: "Initialize as early as possible — the provider must mount before the screens you want measured.",
      },
      {
        id: "session-replay",
        title: "Enable Session Replay",
        description:
          "Session Replay is configured **separately** from RUM and does **not** inherit `rumConfiguration.customEndpoint`. It also does not append a path, so it needs the full `/replay` URL below. Getting this wrong is the usual reason RUM events arrive but replays never do.",
        chip: { kind: "editor", label: "App.tsx" },
        completeOn: "copy",
        code: {
          lang: "tsx",
          filename: "App.tsx",
          raw: replayCode(subs),
        },
        pills: ["Wireframe capture", "Privacy masking", "Android verified"],
        note: "Session Replay on React Native is currently verified on Android. On iOS the SDK appends its own path to this URL, so replay uploads do not yet reach OpenObserve — RUM, logs and crashes are unaffected.",
      },
      {
        id: "navigation",
        title: "Track Screens Automatically (Optional)",
        description:
          "If you use React Navigation, hand the SDK your navigation ref and every route change is recorded as a RUM view — no per-screen code.",
        chip: { kind: "editor", label: "Editor" },
        completeOn: "copy",
        code: {
          lang: "tsx",
          filename: "App.tsx",
          raw: navCode,
        },
        note: "Without this you can still record views manually with `OoRum.startView()` / `OoRum.stopView()`.",
      },
      {
        id: "verify",
        title: "Verify Data in OpenObserve",
        description:
          "Run the app on a simulator, emulator or device, move between a few screens, then hit Test — React Native events land in the `_rumdata` stream.",
        chip: { kind: "traces", label: "RUM" },
        completeOn: "detect",
        detectionAnchor: true,
        pills: [
          "Sessions",
          "Views",
          "User Actions",
          "Errors",
          "Crashes",
          "Session Replay",
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
      fixTitle: "Point The SDK At A Host Your Device Can Actually Reach",
      fixBody:
        "`localhost` inside an emulator or on a physical device is the device itself, not your machine — the most common reason nothing arrives at all. Use the right host for where the app runs:",
      fixLang: "bash",
      fixSnippet: `# Android emulator  → your machine is 10.0.2.2
${rumBaseUrl(subs).replace(/\/\/(localhost|127\.0\.0\.1)/, "//10.0.2.2")}

# iOS simulator    → localhost works as-is
${rumBaseUrl(subs)}

# Physical device  → your machine's LAN IP, reachable from the same network
http://192.168.1.10:5080/rum/v1/${subs.org}`,
      troubleshooting: [
        {
          q: "RUM events arrive but there is no session replay",
          a: `Almost always the endpoint. Session Replay is configured separately and does **not** inherit \`rumConfiguration.customEndpoint\`; left unset it defaults to an empty string and uploads go nowhere you can see. Pass the full URL explicitly: \`customEndpoint: '${replayUrl(
            subs,
          )}'\` — note the trailing \`/replay\`, which the core SDK's base URL does not have.`,
        },
        {
          q: "Session replay works on Android but not iOS",
          a: "Known limitation of the current React Native SDK: on iOS it appends its own path to the session-replay `customEndpoint`, so uploads miss OpenObserve's `/replay` route. Android uses the URL verbatim and works. RUM events, logs and crash reporting are unaffected on both platforms.",
        },
        {
          q: "Nothing arrives at all from an emulator or device",
          a: "Check the host first — see the fix box above. `localhost` resolves to the device, not your machine: use `10.0.2.2` on the Android emulator, `localhost` on the iOS simulator, and your machine's LAN IP on a physical device.",
        },
        {
          q: "Android release/debug build sends nothing over plain HTTP",
          a: "Android blocks cleartext traffic by default. For an `http://` endpoint set `additionalConfiguration: { '_dd.needsClearTextHttp': true }` in the SDK config, and allow cleartext for your host in the app's network security config. Prefer HTTPS outside local development.",
        },
        {
          q: "The iOS build fails or the native module is missing",
          a: "Run `npx pod-install` (or `cd ios && pod install`) after adding the packages, then rebuild from Xcode or `npx react-native run-ios`. A Metro-only reload will not pick up new native modules.",
        },
        {
          q: "Replays render but everything is masked",
          a: "That is the default. `textAndInputPrivacyLevel`, `imagePrivacyLevel` and `touchPrivacyLevel` all default to their strictest setting (`MASK_ALL`). Relax them only as far as your privacy policy allows — `MASK_SENSITIVE_INPUTS` keeps passwords and card fields hidden while showing the rest.",
        },
        {
          q: "Requests return 401 or 403",
          a: "The `clientToken` is this org's **RUM token**, not the ingestion passcode. If it was rotated, regenerate it from this page's header and rebuild the app.",
        },
        {
          q: "Sessions appear but screens are all named the same",
          a: "View tracking is not wired up. Either pass your navigation ref to `OoRumReactNavigationTracking.startTrackingViews()` (see the optional step above), or call `OoRum.startView()` / `OoRum.stopView()` yourself on each screen.",
        },
      ],
    },
    docUrl: "https://openobserve.ai/docs/user-guide/data-exploration/rum/setup/",
  };
}
