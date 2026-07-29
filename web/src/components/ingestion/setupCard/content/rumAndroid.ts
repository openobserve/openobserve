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

// Real User Monitoring — native Android (Kotlin) SDK setup card.
//
// Sibling of ./rum.ts (browser) and ./rumReactNative.ts (React Native): same RUM
// token, same `_rumdata` stream, but a native runtime and — critically — a
// different endpoint story, so it is its own card. FrontendRumConfig.vue switches
// between the platforms.
//
// Endpoint shape (see the backend's rum_routes — src/api/ingest/src/request/rum):
//   POST /rum/v1/{org}/rum      RUM events
//   POST /rum/v1/{org}/logs     logs
//   POST /rum/v1/{org}/replay   session replay segments
//
// UNLIKE the React Native bridge, the NATIVE Android SDK appends NOTHING to a
// custom endpoint — `useCustomEndpoint(url)` is used verbatim as the full intake
// URL (the default `/api/v2/...` path is only added when NO custom endpoint is
// set). So every feature gets its OWN complete URL: RUM `/rum`, Logs `/logs`,
// Session Replay `/replay`. Getting this wrong is the single most common reason
// one signal arrives while another silently does not.

import { getImageURL } from "@/utils/zincutils";
import type { RichCardContent, RichCardStepVariant } from "../types";

/** Published Android SDK release these snippets are written against. */
export const RUM_ANDROID_SDK_VERSION = "0.1.0-alpha4";

/** Maven group for every OpenObserve Android artifact. */
const GROUP = "ai.openobserve";
const ART_RUM = `${GROUP}:o2-sdk-android-rum`;
const ART_LOGS = `${GROUP}:o2-sdk-android-logs`;
const ART_REPLAY = `${GROUP}:o2-sdk-android-session-replay`;

/** Per-org values substituted into the Android snippets. */
export interface RumAndroidCardSubs {
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
export const rumBaseUrl = (subs: RumAndroidCardSubs) => `${subs.endpoint}/rum/v1/${subs.org}`;
/** Full URL the RUM feature posts to (SDK appends nothing to a custom endpoint). */
export const rumEndpoint = (subs: RumAndroidCardSubs) => `${rumBaseUrl(subs)}/rum`;
/** Full URL the Logs feature posts to. */
export const logsEndpoint = (subs: RumAndroidCardSubs) => `${rumBaseUrl(subs)}/logs`;
/** Full URL Session Replay posts to. */
export const replayEndpoint = (subs: RumAndroidCardSubs) => `${rumBaseUrl(subs)}/replay`;

// ── install ──────────────────────────────────────────────────────────────────

const gradleKts = `dependencies {
  implementation("${ART_RUM}:${RUM_ANDROID_SDK_VERSION}")
  implementation("${ART_LOGS}:${RUM_ANDROID_SDK_VERSION}")
  // Optional — screen recording.
  implementation("${ART_REPLAY}:${RUM_ANDROID_SDK_VERSION}")
}`;

const gradleGroovy = `dependencies {
  implementation "${ART_RUM}:${RUM_ANDROID_SDK_VERSION}"
  implementation "${ART_LOGS}:${RUM_ANDROID_SDK_VERSION}"
  // Optional — screen recording.
  implementation "${ART_REPLAY}:${RUM_ANDROID_SDK_VERSION}"
}`;

// ── initialize ───────────────────────────────────────────────────────────────

const initCode = (subs: RumAndroidCardSubs, token: string) =>
  `import android.app.Application
import com.openobserve.android.OpenObserve
import com.openobserve.android.core.configuration.Configuration
import com.openobserve.android.log.Logs
import com.openobserve.android.log.LogsConfiguration
import com.openobserve.android.privacy.TrackingConsent
import com.openobserve.android.rum.Rum
import com.openobserve.android.rum.RumConfiguration
import com.openobserve.android.rum.tracking.ActivityViewTrackingStrategy

class SampleApplication : Application() {
    override fun onCreate() {
        super.onCreate()

        val configuration = Configuration.Builder(
            clientToken = "${token}", // this org's RUM token
            env = "production",
            service = "my-android-app",
        )${
          subs.insecureHTTP
            ? `
            // Your endpoint is plain http:// — allow cleartext for the SDK, and
            // also set android:usesCleartextTraffic="true" in the manifest.
            .let { com.openobserve.android._InternalProxy.allowClearTextHttp(it) }`
            : ""
        }
            .build()

        // The native SDK does NOT append a path to a custom endpoint — give each
        // feature its own FULL intake URL.
        OpenObserve.initialize(this, configuration, TrackingConsent.GRANTED)

        Rum.enable(
            RumConfiguration.Builder(applicationId = "my-android-app")
                .useCustomEndpoint("${rumEndpoint(subs)}")
                .trackUserInteractions()
                .trackLongTasks()
                .useViewTrackingStrategy(ActivityViewTrackingStrategy(trackExtras = true))
                .build(),
        )

        Logs.enable(
            LogsConfiguration.Builder()
                .useCustomEndpoint("${logsEndpoint(subs)}")
                .build(),
        )
    }
}`;

// ── session replay ───────────────────────────────────────────────────────────

const replayCode = (subs: RumAndroidCardSubs) =>
  `import com.openobserve.android.sessionreplay.SessionReplay
import com.openobserve.android.sessionreplay.SessionReplayConfiguration
import com.openobserve.android.sessionreplay.ImagePrivacy
import com.openobserve.android.sessionreplay.TextAndInputPrivacy
import com.openobserve.android.sessionreplay.TouchPrivacy

// Call once, after OpenObserve.initialize(...) in onCreate().
SessionReplay.enable(
    SessionReplayConfiguration.Builder(sampleRate = 100f)
        // Session Replay also needs the FULL /replay URL — it does not inherit
        // the RUM endpoint and appends nothing of its own.
        .useCustomEndpoint("${replayEndpoint(subs)}")
        // Privacy defaults are the strictest MASK_ALL. Relax only as far as your
        // policy allows.
        .setTextAndInputPrivacy(TextAndInputPrivacy.MASK_SENSITIVE_INPUTS)
        .setImagePrivacy(ImagePrivacy.MASK_NONE)
        .setTouchPrivacy(TouchPrivacy.SHOW)
        .build(),
)`;

// ── card ─────────────────────────────────────────────────────────────────────

export default function rumAndroidCard(subs: RumAndroidCardSubs): RichCardContent {
  const gradleIcon = getImageURL("images/ingestion/nodejs.svg");

  const installVariants: RichCardStepVariant[] = [
    {
      id: "kotlin",
      label: "Kotlin DSL",
      icon: gradleIcon,
      code: { lang: "kotlin", filename: "build.gradle.kts", raw: gradleKts },
      note: "The session-replay dependency is optional — drop that line if you do not need screen recording.",
    },
    {
      id: "groovy",
      label: "Groovy",
      icon: gradleIcon,
      code: { lang: "groovy", filename: "build.gradle", raw: gradleGroovy },
      note: "The session-replay dependency is optional — drop that line if you do not need screen recording.",
    },
  ];

  return {
    provider: {
      // Same title as the other platform cards by design — the platform switch
      // next to it already says which guide you are on, so the heading stays
      // stable across platforms instead of rewriting itself on every click.
      name: "Real User Monitoring",
      tagline:
        "Capture sessions, views, user actions, crashes and session replay from your native Android app — your RUM token is already filled in below.",
      logo: getImageURL("images/common/monitoring.svg"),
      tone: "#3f7994",
      runtime: "Android",
      setupTime: "~5 min",
      metaBadges: ["Sessions", "Views", "Errors", "Crashes", "Session Replay"],
    },
    steps: [
      {
        id: "install",
        title: "Add the Android SDK",
        description:
          "Add the RUM and Logs dependencies (and optionally session replay) to your app module's Gradle file, then sync. Artifacts are published under the `ai.openobserve` group.",
        chip: { kind: "editor", label: "build.gradle" },
        completeOn: "copy",
        required: true,
        variantGroup: "gradle",
        variants: installVariants,
      },
      {
        id: "init",
        title: "Initialize RUM + Logs",
        description:
          "Initialize the SDK once in your `Application.onCreate()`. The native SDK appends **nothing** to a custom endpoint, so each feature gets its own full URL — RUM `/rum`, Logs `/logs`. Adjust `applicationId`, `service` and `env` to describe your app. The `clientToken` ships inside your APK by design; it can only write RUM events and you can rotate it from this page's header.",
        chip: { kind: "editor", label: "Application.kt" },
        completeOn: "copy",
        required: true,
        code: {
          lang: "kotlin",
          filename: "SampleApplication.kt",
          raw: initCode(subs, subs.rumToken),
          masked: initCode(subs, subs.rumTokenMasked),
        },
        note: "Initialize as early as possible — the SDK must be enabled before the screens you want measured are created.",
      },
      {
        id: "session-replay",
        title: "Enable Session Replay (Optional)",
        description:
          "Session Replay is enabled **separately** and does **not** inherit the RUM endpoint. It also appends nothing, so it needs the full `/replay` URL below. Getting this wrong is the usual reason RUM events arrive but replays never do.",
        chip: { kind: "editor", label: "Application.kt" },
        completeOn: "copy",
        code: {
          lang: "kotlin",
          filename: "SampleApplication.kt",
          raw: replayCode(subs),
        },
        pills: ["Wireframe capture", "Privacy masking"],
        note: "Privacy levels default to their strictest setting. Relax `setTextAndInputPrivacy`, `setImagePrivacy` and `setTouchPrivacy` only as far as your privacy policy allows.",
      },
      {
        id: "verify",
        title: "Verify Data in OpenObserve",
        description:
          "Run the app on an emulator or device, move between a few screens, then hit Test — native Android events land in the `_rumdata` stream.",
        chip: { kind: "traces", label: "RUM" },
        completeOn: "detect",
        detectionAnchor: true,
        pills: ["Sessions", "Views", "User Actions", "Errors", "Crashes", "Session Replay"],
      },
    ],
    // The SDK stamps `source = 'android'` on every event, so filtering on it
    // confirms the native Android SDK specifically — not a browser or React
    // Native session on the same org.
    detect: {
      streamType: "logs",
      streamName: "_rumdata",
      filter: "source = 'android'",
    },
    extras: {
      installs: [ART_RUM, ART_LOGS, ART_REPLAY],
      fixTitle: "Give Each Feature Its FULL Intake URL",
      fixBody:
        "The native Android SDK appends nothing to a custom endpoint — it posts to exactly the URL you pass. A base URL without the `/rum`, `/logs` or `/replay` suffix silently drops that signal. Use the complete per-feature URLs:",
      fixLang: "bash",
      fixSnippet: `# RUM
${rumEndpoint(subs)}

# Logs
${logsEndpoint(subs)}

# Session Replay
${replayEndpoint(subs)}

# Android emulator → your machine is 10.0.2.2, never localhost
${rumEndpoint(subs).replace(/\/\/(localhost|127\.0\.0\.1)/, "//10.0.2.2")}`,
      troubleshooting: [
        {
          q: "RUM events arrive but there is no session replay",
          a: `Almost always the endpoint. Session Replay is enabled separately and does **not** inherit the RUM \`useCustomEndpoint\`. Pass the full URL explicitly: \`useCustomEndpoint("${replayEndpoint(
            subs,
          )}")\` — note the trailing \`/replay\`, which the RUM endpoint does not have.`,
        },
        {
          q: "Nothing arrives at all from an emulator or device",
          a: "Check the host first. `localhost` inside an emulator or on a device is the device itself, not your machine: use `10.0.2.2` on the Android emulator, and your machine's LAN IP on a physical device on the same network.",
        },
        {
          q: "A release/debug build sends nothing over plain HTTP",
          a: "Android blocks cleartext traffic by default. For an `http://` endpoint, allow cleartext on the SDK with `_InternalProxy.allowClearTextHttp(builder)` and set `android:usesCleartextTraffic=\"true\"` (or a network-security-config exception) for your host. Prefer HTTPS outside local development.",
        },
        {
          q: "Requests return 401 or 403",
          a: "The `clientToken` is this org's **RUM token**, not the ingestion passcode. If it was rotated, regenerate it from this page's header and rebuild the app.",
        },
        {
          q: "Sessions appear but screens are all named the same",
          a: "View tracking is not wired up. Pass a `useViewTrackingStrategy(...)` — e.g. `ActivityViewTrackingStrategy(trackExtras = true)` for Activities, or `NavigationViewTrackingStrategy(...)` if you use AndroidX Navigation — when building the `RumConfiguration`.",
        },
      ],
    },
    docUrl: "https://openobserve.ai/docs/user-guide/data-exploration/rum/setup/",
  };
}
