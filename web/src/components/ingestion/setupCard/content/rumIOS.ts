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

// Real User Monitoring — native iOS (Swift) SDK setup card.
//
// Sibling of ./rum.ts (browser), ./rumReactNative.ts (React Native) and
// ./rumAndroid.ts (native Android): same RUM token, same `_rumdata` stream, but a
// native Apple runtime and — critically — a different endpoint story, so it is its
// own card. FrontendRumConfig.vue switches between the platforms.
//
// Endpoint shape (see the backend's rum_routes — src/api/ingest/src/request/rum):
//   POST /rum/v1/{org}/rum      RUM events
//   POST /rum/v1/{org}/logs     logs
//   POST /rum/v1/{org}/replay   session replay segments
//
// UNLIKE the React Native bridge, the NATIVE iOS SDK appends NOTHING to a
// `customEndpoint` — the URL is used verbatim as the full intake URL (the default
// `api/v2/...` path is only added when NO custom endpoint is set). So every feature
// gets its OWN complete URL: RUM `/rum`, Logs `/logs`, Session Replay `/replay`.
// Getting this wrong is the single most common reason one signal arrives while
// another silently does not.
//
// Plain http:// on iOS is governed by App Transport Security in Info.plist, NOT by
// an SDK flag — so the insecure-HTTP path here is an ATS note rather than a config
// option (contrast rumAndroid.ts, which has an SDK cleartext toggle).

import { gt, raw } from "@/types/i18n";
import { getImageURL } from "@/utils/zincutils";
import type { RichCardContent, RichCardStepVariant } from "../types";

/** Published iOS SDK release these snippets are written against. */
export const RUM_IOS_SDK_VERSION = "0.1.0";

/** Swift Package Manager git source for the iOS SDK. */
const SPM_URL = "https://github.com/openobserve/openobserve-sdk-ios.git";

/** Per-org values substituted into the iOS snippets. */
export interface RumIOSCardSubs {
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

/** Base URL every native feature's full endpoint is built from. */
export const rumBaseUrl = (subs: RumIOSCardSubs) => `${subs.endpoint}/rum/v1/${subs.org}`;
/** Full URL the RUM feature posts to (SDK appends nothing to a custom endpoint). */
export const rumEndpoint = (subs: RumIOSCardSubs) => `${rumBaseUrl(subs)}/rum`;
/** Full URL the Logs feature posts to. */
export const logsEndpoint = (subs: RumIOSCardSubs) => `${rumBaseUrl(subs)}/logs`;
/** Full URL Session Replay posts to. */
export const replayEndpoint = (subs: RumIOSCardSubs) => `${rumBaseUrl(subs)}/replay`;

// ── install ──────────────────────────────────────────────────────────────────

const spmCode = `// In Xcode: File ▸ Add Package Dependencies… and paste the URL below,
// or add it to your Package.swift:
dependencies: [
    .package(url: "${SPM_URL}", from: "${RUM_IOS_SDK_VERSION}"),
],
targets: [
    .target(
        name: "MyApp",
        dependencies: [
            .product(name: "OpenObserveCore", package: "openobserve-sdk-ios"),
            .product(name: "OpenObserveRUM", package: "openobserve-sdk-ios"),
            .product(name: "OpenObserveLogs", package: "openobserve-sdk-ios"),
            // Optional — screen recording.
            .product(name: "OpenObserveSessionReplay", package: "openobserve-sdk-ios"),
        ],
    ),
]`;

const podCode = `# Podfile
pod 'OpenObserveCore', '${RUM_IOS_SDK_VERSION}'
pod 'OpenObserveRUM', '${RUM_IOS_SDK_VERSION}'
pod 'OpenObserveLogs', '${RUM_IOS_SDK_VERSION}'
# Optional — screen recording.
pod 'OpenObserveSessionReplay', '${RUM_IOS_SDK_VERSION}'

# then:
pod install`;

// ── initialize ───────────────────────────────────────────────────────────────

const initCode = (subs: RumIOSCardSubs, token: string) =>
  `import OpenObserveCore
import OpenObserveRUM
import OpenObserveLogs
import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        let configuration = OpenObserve.Configuration(
            clientToken: "${token}", // this org's RUM token
            env: "production",
            service: "my-ios-app"
        )
        OpenObserve.initialize(with: configuration, trackingConsent: .granted)

        // The native SDK does NOT append a path to a custom endpoint — give each
        // feature its own FULL intake URL.
        RUM.enable(
            with: RUM.Configuration(
                applicationID: "my-ios-app",
                sessionSampleRate: 100,
                // Automatically track UIKit view controllers as RUM views.
                uiKitViewsPredicate: DefaultUIKitRUMViewsPredicate(),
                customEndpoint: URL(string: "${rumEndpoint(subs)}")
            )
        )

        Logs.enable(
            with: Logs.Configuration(
                customEndpoint: URL(string: "${logsEndpoint(subs)}")
            )
        )

        return true
    }
}`;

// ── session replay ───────────────────────────────────────────────────────────

const replayCode = (subs: RumIOSCardSubs) =>
  `import OpenObserveSessionReplay

// Call once, after OpenObserve.initialize(...) in didFinishLaunchingWithOptions.
SessionReplay.enable(
    with: SessionReplay.Configuration(
        replaySampleRate: 100, // record 100% of sampled sessions
        // Privacy defaults are the strictest .maskAll / .hide. Relax only as far
        // as your policy allows.
        textAndInputPrivacyLevel: .maskSensitiveInputs,
        imagePrivacyLevel: .maskNone,
        touchPrivacyLevel: .show,
        // Session Replay also needs the FULL /replay URL — it does not inherit
        // the RUM endpoint and appends nothing of its own.
        customEndpoint: URL(string: "${replayEndpoint(subs)}")
    )
)`;

// ── card ─────────────────────────────────────────────────────────────────────

export default function rumIOSCard(subs: RumIOSCardSubs): RichCardContent {
  const appleIcon = getImageURL("images/ingestion/nodejs.svg");

  const installVariants: RichCardStepVariant[] = [
    {
      id: "spm",
      label: raw("Swift Package Manager"),
      icon: appleIcon,
      code: { lang: "swift", filename: "Package.swift", raw: spmCode },
      note: gt("ingestion.setupCard.iosInstallSpmNote"),
    },
    {
      id: "cocoapods",
      label: raw("CocoaPods"),
      icon: appleIcon,
      code: { lang: "ruby", filename: "Podfile", raw: podCode },
      note: gt("ingestion.setupCard.iosInstallPodNote"),
    },
  ];

  return {
    provider: {
      // Same title as the other platform cards by design — the platform switch
      // next to it already says which guide you are on, so the heading stays
      // stable across platforms instead of rewriting itself on every click.
      name: "Real User Monitoring",
      tagline: gt("ingestion.setupCard.rumIosTagline"),
      logo: getImageURL("images/common/monitoring.svg"),
      tone: "#3f7994",
      runtime: raw("iOS"),
      setupTime: gt("ingestion.setupCard.setupTime5Min"),
      metaBadges: [
        gt("rum.sessions"),
        gt("ingestion.setupCard.pillViews"),
        gt("rum.errors"),
        gt("ingestion.setupCard.pillCrashes"),
        gt("rum.sessionReplay"),
      ],
    },
    steps: [
      {
        id: "install",
        titleKey: "ingestion.setupCard.installIosSdkTitle",
        descriptionKey: "ingestion.setupCard.installIosSdkDesc",
        chip: { kind: "editor", label: raw("Package.swift") },
        completeOn: "copy",
        required: true,
        variantGroup: "pkg",
        variants: installVariants,
      },
      {
        id: "init",
        titleKey: "ingestion.setupCard.rumInitTitle",
        descriptionKey: "ingestion.setupCard.initRumLogsIosDesc",
        chip: { kind: "editor", label: raw("AppDelegate.swift") },
        completeOn: "copy",
        required: true,
        code: {
          lang: "swift",
          filename: "AppDelegate.swift",
          raw: initCode(subs, subs.rumToken),
          masked: initCode(subs, subs.rumTokenMasked),
        },
        note: subs.insecureHTTP
          ? gt("ingestion.setupCard.iosInitCleartextNote")
          : gt("ingestion.setupCard.iosInitNote"),
      },
      {
        id: "session-replay",
        titleKey: "ingestion.setupCard.enableSessionReplayOptionalTitle",
        descriptionKey: "ingestion.setupCard.enableSessionReplayNativeDesc",
        chip: { kind: "editor", label: raw("AppDelegate.swift") },
        completeOn: "copy",
        code: {
          lang: "swift",
          filename: "AppDelegate.swift",
          raw: replayCode(subs),
        },
        pills: [
          gt("ingestion.setupCard.pillWireframeCapture"),
          gt("ingestion.setupCard.pillPrivacyMasking"),
        ],
        note: gt("ingestion.setupCard.iosSessionReplayNote"),
      },
      {
        id: "verify",
        titleKey: "ingestion.setupCard.verifyDataTitle",
        descriptionKey: "ingestion.setupCard.verifyIosRumDesc",
        chip: { kind: "traces", label: raw("RUM") },
        completeOn: "detect",
        detectionAnchor: true,
        pills: [
          gt("rum.sessions"),
          gt("ingestion.setupCard.pillViews"),
          gt("ingestion.setupCard.pillUserActions"),
          gt("rum.errors"),
          gt("ingestion.setupCard.pillCrashes"),
          gt("rum.sessionReplay"),
        ],
      },
    ],
    // The SDK stamps `source = 'ios'` on every event, so filtering on it confirms
    // the native iOS SDK specifically — not a browser or React Native session on
    // the same org.
    detect: {
      streamType: "logs",
      streamName: "_rumdata",
      filter: "source = 'ios'",
    },
    extras: {
      installs: [
        "OpenObserveCore",
        "OpenObserveRUM",
        "OpenObserveLogs",
        "OpenObserveSessionReplay",
      ],
      fixTitle: gt("ingestion.setupCard.iosFixTitle"),
      fixBody: gt("ingestion.setupCard.iosFixBody"),
      fixLang: "bash",
      fixSnippet: `# RUM
${rumEndpoint(subs)}

# Logs
${logsEndpoint(subs)}

# Session Replay
${replayEndpoint(subs)}`,
      troubleshooting: [
        {
          q: gt("ingestion.setupCard.iosTroubleNoReplayQ"),
          a: gt("ingestion.setupCard.iosTroubleNoReplayA", {
            replayUrl: replayEndpoint(subs),
          }),
        },
        {
          q: gt("ingestion.setupCard.iosTroubleCleartextQ"),
          a: gt("ingestion.setupCard.iosTroubleCleartextA"),
        },
        {
          q: gt("ingestion.setupCard.iosTrouble401Q"),
          a: gt("ingestion.setupCard.iosTrouble401A"),
        },
        {
          q: gt("ingestion.setupCard.iosTroubleScreenNamesQ"),
          a: gt("ingestion.setupCard.iosTroubleScreenNamesA"),
        },
        {
          q: gt("ingestion.setupCard.iosTroublePackageResolveQ"),
          a: gt("ingestion.setupCard.iosTroublePackageResolveA", {
            url: SPM_URL,
            version: RUM_IOS_SDK_VERSION,
          }),
        },
      ],
    },
    docUrl: "https://openobserve.ai/docs/user-guide/data-exploration/rum/setup/",
  };
}
