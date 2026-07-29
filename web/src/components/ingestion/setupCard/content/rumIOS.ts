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

import { getImageURL } from "@/utils/zincutils";
import type { RichCardContent, RichCardStepVariant } from "../types";

/** Published iOS SDK release these snippets are written against. */
export const RUM_IOS_SDK_VERSION = "0.1.0-alpha.4";

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
      label: "Swift Package Manager",
      icon: appleIcon,
      code: { lang: "swift", filename: "Package.swift", raw: spmCode },
      note: "The session-replay product is optional — drop that line if you do not need screen recording.",
    },
    {
      id: "cocoapods",
      label: "CocoaPods",
      icon: appleIcon,
      code: { lang: "ruby", filename: "Podfile", raw: podCode },
      note: "The session-replay pod is optional — drop that line if you do not need screen recording.",
    },
  ];

  return {
    provider: {
      // Same title as the other platform cards by design — the platform switch
      // next to it already says which guide you are on, so the heading stays
      // stable across platforms instead of rewriting itself on every click.
      name: "Real User Monitoring",
      tagline:
        "Capture sessions, views, user actions, crashes and session replay from your native iOS app — your RUM token is already filled in below.",
      logo: getImageURL("images/common/monitoring.svg"),
      tone: "#3f7994",
      runtime: "iOS",
      setupTime: "~5 min",
      metaBadges: ["Sessions", "Views", "Errors", "Crashes", "Session Replay"],
    },
    steps: [
      {
        id: "install",
        title: "Add the iOS SDK",
        description:
          "Add the RUM and Logs products (and optionally session replay) with Swift Package Manager or CocoaPods.",
        chip: { kind: "editor", label: "Package.swift" },
        completeOn: "copy",
        required: true,
        variantGroup: "pkg",
        variants: installVariants,
      },
      {
        id: "init",
        title: "Initialize RUM + Logs",
        description:
          "Initialize the SDK once in your `AppDelegate`. The native SDK appends **nothing** to a custom endpoint, so each feature gets its own full URL — RUM `/rum`, Logs `/logs`. Adjust `applicationID`, `service` and `env` to describe your app. The `clientToken` ships inside your app bundle by design; it can only write RUM events and you can rotate it from this page's header.",
        chip: { kind: "editor", label: "AppDelegate.swift" },
        completeOn: "copy",
        required: true,
        code: {
          lang: "swift",
          filename: "AppDelegate.swift",
          raw: initCode(subs, subs.rumToken),
          masked: initCode(subs, subs.rumTokenMasked),
        },
        note: subs.insecureHTTP
          ? "Your endpoint is plain http:// — iOS blocks cleartext by default. Add an App Transport Security exception for your host in Info.plist (`NSAppTransportSecurity` → `NSExceptionDomains`). Prefer HTTPS outside local development."
          : "Initialize as early as possible — the SDK must be enabled before the screens you want measured appear.",
      },
      {
        id: "session-replay",
        title: "Enable Session Replay (Optional)",
        description:
          "Session Replay is enabled **separately** and does **not** inherit the RUM endpoint. It also appends nothing, so it needs the full `/replay` URL below. Getting this wrong is the usual reason RUM events arrive but replays never do.",
        chip: { kind: "editor", label: "AppDelegate.swift" },
        completeOn: "copy",
        code: {
          lang: "swift",
          filename: "AppDelegate.swift",
          raw: replayCode(subs),
        },
        pills: ["Wireframe capture", "Privacy masking"],
        note: "Privacy levels default to their strictest setting (`.maskAll` / `.hide`). Relax `textAndInputPrivacyLevel`, `imagePrivacyLevel` and `touchPrivacyLevel` only as far as your privacy policy allows.",
      },
      {
        id: "verify",
        title: "Verify Data in OpenObserve",
        description:
          "Run the app on a simulator or device, move between a few screens, then hit Test — native iOS events land in the `_rumdata` stream.",
        chip: { kind: "traces", label: "RUM" },
        completeOn: "detect",
        detectionAnchor: true,
        pills: ["Sessions", "Views", "User Actions", "Errors", "Crashes", "Session Replay"],
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
      installs: ["OpenObserveCore", "OpenObserveRUM", "OpenObserveLogs", "OpenObserveSessionReplay"],
      fixTitle: "Give Each Feature Its FULL Intake URL",
      fixBody:
        "The native iOS SDK appends nothing to a `customEndpoint` — it posts to exactly the URL you pass. A base URL without the `/rum`, `/logs` or `/replay` suffix silently drops that signal. Use the complete per-feature URLs:",
      fixLang: "bash",
      fixSnippet: `# RUM
${rumEndpoint(subs)}

# Logs
${logsEndpoint(subs)}

# Session Replay
${replayEndpoint(subs)}`,
      troubleshooting: [
        {
          q: "RUM events arrive but there is no session replay",
          a: `Almost always the endpoint. Session Replay is enabled separately and does **not** inherit the RUM \`customEndpoint\`. Pass the full URL explicitly: \`customEndpoint: URL(string: "${replayEndpoint(
            subs,
          )}")\` — note the trailing \`/replay\`, which the RUM endpoint does not have.`,
        },
        {
          q: "Nothing arrives over plain HTTP (http://)",
          a: "iOS blocks cleartext traffic via App Transport Security. There is no SDK flag for this — add an `NSAppTransportSecurity` exception for your host in `Info.plist`. Prefer HTTPS outside local development.",
        },
        {
          q: "Requests return 401 or 403",
          a: "The `clientToken` is this org's **RUM token**, not the ingestion passcode. If it was rotated, regenerate it from this page's header and rebuild the app.",
        },
        {
          q: "Sessions appear but screens are all named the same",
          a: "Automatic view tracking is not wired up. Pass `uiKitViewsPredicate: DefaultUIKitRUMViewsPredicate()` (UIKit) or a `swiftUIViewsPredicate` (SwiftUI) when building `RUM.Configuration`, or start views manually with `RUMMonitor.shared().startView(...)`.",
        },
        {
          q: "The package fails to resolve in Xcode",
          a: `Confirm the package URL \`${SPM_URL}\` and that the version \`${RUM_IOS_SDK_VERSION}\` exists, then File ▸ Packages ▸ Reset Package Caches and resolve again.`,
        },
      ],
    },
    docUrl: "https://openobserve.ai/docs/user-guide/data-exploration/rum/setup/",
  };
}
