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

/**
 * Unit tests for the pure `rumReactNativeCard()` builder function.
 * This module has no Vue component — all assertions are on the returned data
 * structure. No mounting, no store, no i18n.
 *
 * rumReactNative.ts exports:
 *   - rumReactNativeCard(subs: RumReactNativeCardSubs): RichCardContent
 *   - RUM_RN_SDK_VERSION: string
 *   - rumBaseUrl(subs): string
 *   - replayUrl(subs): string
 */

import { describe, it, expect, vi } from "vitest";

// Mock getImageURL before importing rumReactNative.ts so the builder can
// resolve assets without a real DOM environment.
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((p: string) => `/mocked-asset/${p}`),
}));

import rumReactNativeCard, {
  RUM_RN_SDK_VERSION,
  rumBaseUrl,
  replayUrl,
} from "./rumReactNative";
import type { RumReactNativeCardSubs } from "./rumReactNative";
import type { RichCardContent } from "../types";

// ── shared substitutions ──────────────────────────────────────────────────────

const BASE_SUBS: RumReactNativeCardSubs = {
  endpoint: "https://ingest.example.com",
  org: "my-org",
  rumToken: "raw-token-abc123",
  rumTokenMasked: "raw-****-abc123",
  insecureHTTP: false,
};

const HTTP_SUBS: RumReactNativeCardSubs = {
  ...BASE_SUBS,
  insecureHTTP: true,
};

// ── helpers ───────────────────────────────────────────────────────────────────

function buildCard(subs: RumReactNativeCardSubs = BASE_SUBS): RichCardContent {
  return rumReactNativeCard(subs);
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("rumReactNativeCard builder", () => {
  // ── rumBaseUrl / replayUrl ───────────────────────────────────────────────────

  describe("rumBaseUrl", () => {
    it("builds the base URL from endpoint and org", () => {
      const url = rumBaseUrl(BASE_SUBS);

      expect(url).toBe("https://ingest.example.com/rum/v1/my-org");
    });

    it("does not append a trailing path segment", () => {
      const url = rumBaseUrl(BASE_SUBS);

      expect(url.endsWith("/replay")).toBe(false);
    });
  });

  describe("replayUrl", () => {
    it("builds on top of rumBaseUrl and ends with /replay", () => {
      const url = replayUrl(BASE_SUBS);

      expect(url).toBe("https://ingest.example.com/rum/v1/my-org/replay");
      expect(url.endsWith("/replay")).toBe(true);
    });

    it("reflects a different org and endpoint", () => {
      const url = replayUrl({
        ...BASE_SUBS,
        endpoint: "https://other.example.com",
        org: "other-org",
      });

      expect(url).toBe("https://other.example.com/rum/v1/other-org/replay");
    });
  });

  // ── provider metadata ────────────────────────────────────────────────────────

  describe("provider", () => {
    it("uses the same provider.name as the browser card so the title is stable across platforms", () => {
      const card = buildCard();

      expect(card.provider.name).toBe("Real User Monitoring");
    });

    it("names the React Native runtime rather than the browser one", () => {
      const card = buildCard();

      expect(card.provider.runtime).toBe("iOS / Android");
    });

    it("includes a non-empty tagline", () => {
      const card = buildCard();

      expect(card.provider.tagline.length).toBeGreaterThan(0);
    });

    it("sets runtime to 'iOS / Android'", () => {
      const card = buildCard();

      expect(card.provider.runtime).toBe("iOS / Android");
    });

    it("includes Sessions, Views, Errors, Crashes and Session Replay in metaBadges", () => {
      const card = buildCard();

      expect(card.provider.metaBadges).toEqual([
        "Sessions",
        "Views",
        "Errors",
        "Crashes",
        "Session Replay",
      ]);
    });

    it("has a non-empty logo URL (resolved via getImageURL)", () => {
      const card = buildCard();

      expect(card.provider.logo).toBeTruthy();
    });
  });

  // ── step structure ───────────────────────────────────────────────────────────

  describe("steps structure", () => {
    it("returns exactly 5 steps", () => {
      const card = buildCard();

      expect(card.steps).toHaveLength(5);
    });

    it("step ids are install, init, session-replay, navigation, verify in order", () => {
      const card = buildCard();

      expect(card.steps.map((s) => s.id)).toEqual([
        "install",
        "init",
        "session-replay",
        "navigation",
        "verify",
      ]);
    });

    it("install step is required", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;

      expect(install.required).toBe(true);
    });

    it("init step is required", () => {
      const card = buildCard();
      const init = card.steps.find((s) => s.id === "init")!;

      expect(init.required).toBe(true);
    });

    it("session-replay step is NOT required (optional enhancement)", () => {
      const card = buildCard();
      const replay = card.steps.find((s) => s.id === "session-replay")!;

      expect(replay.required).toBeFalsy();
    });

    it("navigation step is NOT required (optional enhancement)", () => {
      const card = buildCard();
      const nav = card.steps.find((s) => s.id === "navigation")!;

      expect(nav.required).toBeFalsy();
    });

    it("verify step is NOT required (optional detection step)", () => {
      const card = buildCard();
      const verify = card.steps.find((s) => s.id === "verify")!;

      expect(verify.required).toBeFalsy();
    });

    it("verify step has detectionAnchor: true", () => {
      const card = buildCard();
      const verify = card.steps.find((s) => s.id === "verify")!;

      expect(verify.detectionAnchor).toBe(true);
    });

    it("install completeOn is 'copy'", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;

      expect(install.completeOn).toBe("copy");
    });

    it("init completeOn is 'copy'", () => {
      const card = buildCard();
      const init = card.steps.find((s) => s.id === "init")!;

      expect(init.completeOn).toBe("copy");
    });

    it("session-replay completeOn is 'copy'", () => {
      const card = buildCard();
      const replay = card.steps.find((s) => s.id === "session-replay")!;

      expect(replay.completeOn).toBe("copy");
    });

    it("navigation completeOn is 'copy'", () => {
      const card = buildCard();
      const nav = card.steps.find((s) => s.id === "navigation")!;

      expect(nav.completeOn).toBe("copy");
    });

    it("verify completeOn is 'detect'", () => {
      const card = buildCard();
      const verify = card.steps.find((s) => s.id === "verify")!;

      expect(verify.completeOn).toBe("detect");
    });

    it("install step has chip with label 'Install'", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;

      expect(install.chip?.label).toBe("Install");
    });

    it("verify step has chip with label 'RUM'", () => {
      const card = buildCard();
      const verify = card.steps.find((s) => s.id === "verify")!;

      expect(verify.chip?.label).toBe("RUM");
    });
  });

  // ── install step — npm/yarn variants ────────────────────────────────────────

  describe("install step variants", () => {
    it("has variantGroup 'pkg'", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;

      expect(install.variantGroup).toBe("pkg");
    });

    it("has npm and yarn variant ids", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;
      const ids = install.variants!.map((v) => v.id);

      expect(ids).toEqual(["npm", "yarn"]);
    });

    it("npm variant code includes npx pod-install", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;
      const npm = install.variants!.find((v) => v.id === "npm")!;

      expect(npm.code.raw).toContain("npx pod-install");
    });

    it("yarn variant code includes npx pod-install", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;
      const yarn = install.variants!.find((v) => v.id === "yarn")!;

      expect(yarn.code.raw).toContain("npx pod-install");
    });

    it("npm variant uses 'npm install' as the add command", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;
      const npm = install.variants!.find((v) => v.id === "npm")!;

      expect(npm.code.raw).toContain("npm install @openobserve/mobile-react-native");
    });

    it("yarn variant uses 'yarn add' as the add command", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;
      const yarn = install.variants!.find((v) => v.id === "yarn")!;

      expect(yarn.code.raw).toContain("yarn add @openobserve/mobile-react-native");
    });

    it("both variants use the bash language", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;

      for (const variant of install.variants!) {
        expect(variant.code.lang).toBe("bash");
      }
    });
  });

  // ── init step — raw vs masked ───────────────────────────────────────────────

  describe("init step — raw vs masked", () => {
    it("raw code contains the base URL", () => {
      const card = buildCard();
      const init = card.steps.find((s) => s.id === "init")!;

      expect(init.code!.raw).toContain(rumBaseUrl(BASE_SUBS));
    });

    it("raw code contains the raw rumToken", () => {
      const card = buildCard();
      const init = card.steps.find((s) => s.id === "init")!;

      expect(init.code!.raw).toContain(BASE_SUBS.rumToken);
    });

    it("masked code contains the masked token, not the raw token", () => {
      const subs: RumReactNativeCardSubs = {
        ...BASE_SUBS,
        rumToken: "super-secret-token",
        rumTokenMasked: "supe-****-oken",
      };
      const card = rumReactNativeCard(subs);
      const init = card.steps.find((s) => s.id === "init")!;

      expect(init.code!.masked).toContain("supe-****-oken");
      expect(init.code!.masked).not.toContain("super-secret-token");
    });

    it("raw code does not contain the masked string when they differ", () => {
      const subs: RumReactNativeCardSubs = {
        ...BASE_SUBS,
        rumToken: "super-secret-token",
        rumTokenMasked: "supe-****-oken",
      };
      const card = rumReactNativeCard(subs);
      const init = card.steps.find((s) => s.id === "init")!;

      expect(init.code!.raw).not.toContain("supe-****-oken");
    });

    it("init code.lang is 'tsx'", () => {
      const card = buildCard();
      const init = card.steps.find((s) => s.id === "init")!;

      expect(init.code!.lang).toBe("tsx");
    });

    it("init code has filename 'App.tsx'", () => {
      const card = buildCard();
      const init = card.steps.find((s) => s.id === "init")!;

      expect(init.code!.filename).toBe("App.tsx");
    });
  });

  // ── init step — insecureHTTP ─────────────────────────────────────────────────

  describe("init step — insecureHTTP", () => {
    it("adds the _dd.needsClearTextHttp additionalConfiguration when insecureHTTP is true", () => {
      const card = rumReactNativeCard(HTTP_SUBS);
      const init = card.steps.find((s) => s.id === "init")!;

      expect(init.code!.raw).toContain(
        "additionalConfiguration: { '_dd.needsClearTextHttp': true }",
      );
    });

    it("does not add additionalConfiguration when insecureHTTP is false", () => {
      const card = rumReactNativeCard(BASE_SUBS);
      const init = card.steps.find((s) => s.id === "init")!;

      expect(init.code!.raw).not.toContain("additionalConfiguration");
      expect(init.code!.raw).not.toContain("needsClearTextHttp");
    });

    it("masked variant also reflects insecureHTTP: true", () => {
      const card = rumReactNativeCard(HTTP_SUBS);
      const init = card.steps.find((s) => s.id === "init")!;

      expect(init.code!.masked).toContain("needsClearTextHttp");
    });
  });

  // ── session-replay step ──────────────────────────────────────────────────────

  describe("session-replay step", () => {
    it("code contains the full replay URL ending in /replay", () => {
      const card = buildCard();
      const replay = card.steps.find((s) => s.id === "session-replay")!;

      expect(replay.code!.raw).toContain(replayUrl(BASE_SUBS));
      expect(replay.code!.raw).toContain(
        "customEndpoint: '" + replayUrl(BASE_SUBS) + "'",
      );
    });

    it("does not use the bare rumBaseUrl as the SessionReplay customEndpoint", () => {
      const card = buildCard();
      const replay = card.steps.find((s) => s.id === "session-replay")!;

      expect(replay.code!.raw).not.toContain(
        `customEndpoint: '${rumBaseUrl(BASE_SUBS)}'`,
      );
    });

    it("reflects a different org/endpoint in the replay URL", () => {
      const subs: RumReactNativeCardSubs = {
        ...BASE_SUBS,
        endpoint: "https://other.example.com",
        org: "other-org",
      };
      const card = rumReactNativeCard(subs);
      const replay = card.steps.find((s) => s.id === "session-replay")!;

      expect(replay.code!.raw).toContain(
        "https://other.example.com/rum/v1/other-org/replay",
      );
    });

    it("code.lang is 'tsx' with filename 'App.tsx'", () => {
      const card = buildCard();
      const replay = card.steps.find((s) => s.id === "session-replay")!;

      expect(replay.code!.lang).toBe("tsx");
      expect(replay.code!.filename).toBe("App.tsx");
    });

    it("has no variants (single code block, no npm/yarn toggle)", () => {
      const card = buildCard();
      const replay = card.steps.find((s) => s.id === "session-replay")!;

      expect(replay.variants).toBeUndefined();
    });
  });

  // ── navigation step ──────────────────────────────────────────────────────────

  describe("navigation step", () => {
    it("code references OoRumReactNavigationTracking.startTrackingViews", () => {
      const card = buildCard();
      const nav = card.steps.find((s) => s.id === "navigation")!;

      expect(nav.code!.raw).toContain(
        "OoRumReactNavigationTracking.startTrackingViews",
      );
    });

    it("does not depend on subs (identical raw code across orgs)", () => {
      const card1 = buildCard(BASE_SUBS);
      const card2 = rumReactNativeCard({
        ...BASE_SUBS,
        org: "different-org",
        endpoint: "https://different.example.com",
      });

      const nav1 = card1.steps.find((s) => s.id === "navigation")!;
      const nav2 = card2.steps.find((s) => s.id === "navigation")!;

      expect(nav1.code!.raw).toBe(nav2.code!.raw);
    });
  });

  // ── detect config ────────────────────────────────────────────────────────────

  describe("detect config", () => {
    it("streamType is 'logs'", () => {
      const card = buildCard();

      expect(card.detect.streamType).toBe("logs");
    });

    it("streamName is '_rumdata'", () => {
      const card = buildCard();

      expect(card.detect.streamName).toBe("_rumdata");
    });

    it("filter is \"source = 'react-native'\"", () => {
      const card = buildCard();

      expect(card.detect.filter).toBe("source = 'react-native'");
    });
  });

  // ── extras / troubleshooting ─────────────────────────────────────────────────

  describe("extras", () => {
    it("extras.troubleshooting is a non-empty array", () => {
      const card = buildCard();

      expect(card.extras?.troubleshooting).toBeDefined();
      expect((card.extras!.troubleshooting as any[]).length).toBeGreaterThan(0);
    });

    it("each troubleshooting entry has a non-empty q and a string", () => {
      const card = buildCard();

      for (const entry of card.extras!.troubleshooting as any[]) {
        expect(typeof entry.q).toBe("string");
        expect(typeof entry.a).toBe("string");
        expect(entry.q.length).toBeGreaterThan(0);
        expect(entry.a.length).toBeGreaterThan(0);
      }
    });

    it("includes the 'RUM events arrive but there is no session replay' entry, and its answer mentions the replay URL", () => {
      const card = buildCard();
      const ts = card.extras!.troubleshooting as any[];
      const entry = ts.find(
        (e: any) => e.q === "RUM events arrive but there is no session replay",
      );

      expect(entry).toBeDefined();
      expect(entry.a).toContain(replayUrl(BASE_SUBS));
      expect(entry.a).toContain("/replay");
    });

    it("extras.installs lists the core, replay and navigation packages", () => {
      const card = buildCard();

      expect(card.extras?.installs).toEqual([
        "@openobserve/mobile-react-native",
        "@openobserve/mobile-react-native-session-replay",
        "@openobserve/mobile-react-navigation",
      ]);
    });
  });

  // ── docUrl ───────────────────────────────────────────────────────────────────

  describe("docUrl", () => {
    it("provides a non-empty docUrl pointing at openobserve.ai", () => {
      const card = buildCard();

      expect(card.docUrl).toBeTruthy();
      expect(card.docUrl).toContain("openobserve.ai");
    });
  });

  // ── determinism ──────────────────────────────────────────────────────────────

  describe("determinism", () => {
    it("calling rumReactNativeCard twice with identical subs returns identical output", () => {
      const card1 = rumReactNativeCard(BASE_SUBS);
      const card2 = rumReactNativeCard(BASE_SUBS);

      expect(JSON.stringify(card1)).toBe(JSON.stringify(card2));
    });

    it("different rumToken values produce different raw init codes", () => {
      const card1 = rumReactNativeCard({
        ...BASE_SUBS,
        rumToken: "token-a",
        rumTokenMasked: "tok-a",
      });
      const card2 = rumReactNativeCard({
        ...BASE_SUBS,
        rumToken: "token-b",
        rumTokenMasked: "tok-b",
      });

      const raw1 = card1.steps.find((s) => s.id === "init")!.code!.raw;
      const raw2 = card2.steps.find((s) => s.id === "init")!.code!.raw;

      expect(raw1).not.toBe(raw2);
    });
  });

  // ── substitution edge cases ──────────────────────────────────────────────────

  describe("substitution edge cases", () => {
    it("empty org string is substituted verbatim in the base URL", () => {
      const url = rumBaseUrl({ ...BASE_SUBS, org: "" });

      expect(url).toBe("https://ingest.example.com/rum/v1/");
    });

    it("org with special characters is substituted verbatim", () => {
      const url = rumBaseUrl({ ...BASE_SUBS, org: "my-org_2024" });

      expect(url).toBe("https://ingest.example.com/rum/v1/my-org_2024");
    });

    it("empty rumToken produces an empty clientToken string in raw code", () => {
      const card = rumReactNativeCard({
        ...BASE_SUBS,
        rumToken: "",
        rumTokenMasked: "",
      });
      const init = card.steps.find((s) => s.id === "init")!;

      expect(init.code!.raw).toContain("'', // clientToken");
    });
  });

  // ── RUM_RN_SDK_VERSION export ─────────────────────────────────────────────────

  describe("RUM_RN_SDK_VERSION", () => {
    it("is a non-empty string", () => {
      expect(typeof RUM_RN_SDK_VERSION).toBe("string");
      expect(RUM_RN_SDK_VERSION.length).toBeGreaterThan(0);
    });
  });
});
