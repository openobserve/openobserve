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
 * Unit tests for the pure `rumIOSCard()` builder function.
 * This module has no Vue component — all assertions are on the returned data
 * structure. No mounting, no store, no i18n.
 *
 * rumIOS.ts exports:
 *   - rumIOSCard(subs: RumIOSCardSubs): RichCardContent
 *   - RUM_IOS_SDK_VERSION: string
 *   - rumBaseUrl(subs): string
 *   - rumEndpoint(subs): string
 *   - logsEndpoint(subs): string
 *   - replayEndpoint(subs): string
 */

import { describe, it, expect, vi } from "vitest";

// Mock getImageURL before importing rumIOS.ts so the builder can resolve
// assets without a real DOM environment.
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((p: string) => `/mocked-asset/${p}`),
}));

import rumIOSCard, {
  RUM_IOS_SDK_VERSION,
  rumBaseUrl,
  rumEndpoint,
  logsEndpoint,
  replayEndpoint,
} from "./rumIOS";
import type { RumIOSCardSubs } from "./rumIOS";
import type { RichCardContent } from "../types";

// ── shared substitutions ──────────────────────────────────────────────────────

const BASE_SUBS: RumIOSCardSubs = {
  endpoint: "https://ingest.example.com",
  org: "my-org",
  rumToken: "rum-secret-token-xyz",
  rumTokenMasked: "****",
  insecureHTTP: false,
};

const HTTP_SUBS: RumIOSCardSubs = {
  ...BASE_SUBS,
  insecureHTTP: true,
};

// ── helpers ───────────────────────────────────────────────────────────────────

function buildCard(subs: RumIOSCardSubs = BASE_SUBS): RichCardContent {
  return rumIOSCard(subs);
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("rumIOSCard builder", () => {
  // ── RUM_IOS_SDK_VERSION ────────────────────────────────────────────────────

  describe("RUM_IOS_SDK_VERSION", () => {
    it("is 0.1.0-alpha.4", () => {
      expect(RUM_IOS_SDK_VERSION).toBe("0.1.0-alpha.4");
    });
  });

  // ── rumBaseUrl / rumEndpoint / logsEndpoint / replayEndpoint ────────────────

  describe("rumBaseUrl", () => {
    it("builds the base URL from endpoint and org", () => {
      const url = rumBaseUrl(BASE_SUBS);

      expect(url).toBe("https://ingest.example.com/rum/v1/my-org");
    });
  });

  describe("rumEndpoint", () => {
    it("appends /rum to the base URL", () => {
      const url = rumEndpoint(BASE_SUBS);

      expect(url).toBe("https://ingest.example.com/rum/v1/my-org/rum");
      expect(url).toBe(`${rumBaseUrl(BASE_SUBS)}/rum`);
    });
  });

  describe("logsEndpoint", () => {
    it("appends /logs to the base URL", () => {
      const url = logsEndpoint(BASE_SUBS);

      expect(url).toBe("https://ingest.example.com/rum/v1/my-org/logs");
      expect(url).toBe(`${rumBaseUrl(BASE_SUBS)}/logs`);
    });
  });

  describe("replayEndpoint", () => {
    it("appends /replay to the base URL", () => {
      const url = replayEndpoint(BASE_SUBS);

      expect(url).toBe("https://ingest.example.com/rum/v1/my-org/replay");
      expect(url).toBe(`${rumBaseUrl(BASE_SUBS)}/replay`);
    });

    it("reflects a different org and endpoint", () => {
      const url = replayEndpoint({
        ...BASE_SUBS,
        endpoint: "https://other.example.com",
        org: "other-org",
      });

      expect(url).toBe("https://other.example.com/rum/v1/other-org/replay");
    });
  });

  // ── provider metadata ────────────────────────────────────────────────────────

  describe("provider", () => {
    it("names the provider 'Real User Monitoring'", () => {
      const card = buildCard();

      expect(card.provider.name).toBe("Real User Monitoring");
    });

    it("sets runtime to 'iOS'", () => {
      const card = buildCard();

      expect(card.provider.runtime).toBe("iOS");
    });

    it("includes a non-empty tagline", () => {
      const card = buildCard();

      expect(card.provider.tagline.length).toBeGreaterThan(0);
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
    it("step ids are install, init, session-replay, verify in order", () => {
      const card = buildCard();

      expect(card.steps.map((s) => s.id)).toEqual([
        "install",
        "init",
        "session-replay",
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

    it("verify completeOn is 'detect'", () => {
      const card = buildCard();
      const verify = card.steps.find((s) => s.id === "verify")!;

      expect(verify.completeOn).toBe("detect");
    });

    it("install and init completeOn is 'copy'", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;
      const init = card.steps.find((s) => s.id === "init")!;

      expect(install.completeOn).toBe("copy");
      expect(init.completeOn).toBe("copy");
    });
  });

  // ── install step — spm/cocoapods variants ───────────────────────────────────

  describe("install step variants", () => {
    it("has spm and cocoapods variant ids", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;
      const ids = install.variants!.map((v) => v.id);

      expect(ids).toEqual(["spm", "cocoapods"]);
    });

    it("spm variant code includes the git source and OpenObserveRUM product", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;
      const spm = install.variants!.find((v) => v.id === "spm")!;

      expect(spm.code.raw).toContain(
        "github.com/openobserve/openobserve-sdk-ios.git",
      );
      expect(spm.code.raw).toContain("OpenObserveRUM");
    });

    it("cocoapods variant code includes the OpenObserveRUM pod", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;
      const cocoapods = install.variants!.find((v) => v.id === "cocoapods")!;

      expect(cocoapods.code.raw).toContain("pod 'OpenObserveRUM'");
    });
  });

  // ── detect config ────────────────────────────────────────────────────────────

  describe("detect config", () => {
    it("has streamType 'logs', streamName '_rumdata' and ios filter", () => {
      const card = buildCard();

      expect(card.detect).toEqual({
        streamType: "logs",
        streamName: "_rumdata",
        filter: "source = 'ios'",
      });
    });
  });

  // ── init step — raw vs masked ───────────────────────────────────────────────

  describe("init step — raw vs masked", () => {
    it("raw code contains the raw rumToken", () => {
      const card = buildCard();
      const init = card.steps.find((s) => s.id === "init")!;

      expect(init.code!.raw).toContain(BASE_SUBS.rumToken);
    });

    it("masked code contains the masked token, not the raw token", () => {
      const subs: RumIOSCardSubs = {
        ...BASE_SUBS,
        rumToken: "super-secret-token",
        rumTokenMasked: "supe-****-oken",
      };
      const card = rumIOSCard(subs);
      const init = card.steps.find((s) => s.id === "init")!;

      expect(init.code!.masked).toContain("supe-****-oken");
      expect(init.code!.masked).not.toContain("super-secret-token");
    });

    it("raw code does not contain the masked string when they differ", () => {
      const subs: RumIOSCardSubs = {
        ...BASE_SUBS,
        rumToken: "super-secret-token",
        rumTokenMasked: "supe-****-oken",
      };
      const card = rumIOSCard(subs);
      const init = card.steps.find((s) => s.id === "init")!;

      expect(init.code!.raw).not.toContain("supe-****-oken");
    });

    it("raw code contains OpenObserve.initialize, RUM.enable, Logs.enable and the full URLs", () => {
      const card = buildCard();
      const init = card.steps.find((s) => s.id === "init")!;

      expect(init.code!.raw).toContain("OpenObserve.initialize");
      expect(init.code!.raw).toContain("RUM.enable");
      expect(init.code!.raw).toContain("Logs.enable");
      expect(init.code!.raw).toContain(rumEndpoint(BASE_SUBS));
      expect(init.code!.raw).toContain(logsEndpoint(BASE_SUBS));
    });
  });

  // ── init step — insecureHTTP note (no SDK flag on iOS) ──────────────────────

  describe("init step — insecureHTTP", () => {
    it("note mentions App Transport Security when insecureHTTP is true", () => {
      const card = rumIOSCard(HTTP_SUBS);
      const init = card.steps.find((s) => s.id === "init")!;

      expect(init.note).toContain("App Transport Security");
    });

    it("note does not mention App Transport Security when insecureHTTP is false", () => {
      const card = rumIOSCard(BASE_SUBS);
      const init = card.steps.find((s) => s.id === "init")!;

      expect(init.note).not.toContain("App Transport Security");
    });

    it("raw code never contains an SDK cleartext flag (ATS is Info.plist-only on iOS)", () => {
      const insecureCard = rumIOSCard(HTTP_SUBS);
      const secureCard = rumIOSCard(BASE_SUBS);
      const insecureInit = insecureCard.steps.find((s) => s.id === "init")!;
      const secureInit = secureCard.steps.find((s) => s.id === "init")!;

      expect(insecureInit.code!.raw).not.toContain("allowClearTextHttp");
      expect(secureInit.code!.raw).not.toContain("allowClearTextHttp");
    });
  });

  // ── session-replay step ──────────────────────────────────────────────────────

  describe("session-replay step", () => {
    it("code contains the full replay URL and SessionReplay.enable", () => {
      const card = buildCard();
      const replay = card.steps.find((s) => s.id === "session-replay")!;

      expect(replay.code!.raw).toContain(replayEndpoint(BASE_SUBS));
      expect(replay.code!.raw).toContain("SessionReplay.enable");
    });
  });

  // ── extras / troubleshooting ─────────────────────────────────────────────────

  describe("extras", () => {
    it("docUrl is set", () => {
      const card = buildCard();

      expect(card.docUrl).toBe(
        "https://openobserve.ai/docs/user-guide/data-exploration/rum/setup/",
      );
    });

    it("extras.troubleshooting is a non-empty array", () => {
      const card = buildCard();

      expect(card.extras?.troubleshooting).toBeDefined();
      expect((card.extras!.troubleshooting as any[]).length).toBeGreaterThan(0);
    });

    it("extras.installs lists the core iOS packages", () => {
      const card = buildCard();

      expect(card.extras?.installs).toEqual([
        "OpenObserveCore",
        "OpenObserveRUM",
        "OpenObserveLogs",
        "OpenObserveSessionReplay",
      ]);
    });
  });

  // ── substitution edge cases ──────────────────────────────────────────────────

  describe("substitution edge cases", () => {
    it("masked and raw differ when rumToken !== rumTokenMasked", () => {
      const card = rumIOSCard(BASE_SUBS);
      const init = card.steps.find((s) => s.id === "init")!;

      expect(init.code!.raw).not.toBe(init.code!.masked);
    });

    it("empty org string is substituted verbatim in the base URL", () => {
      const url = rumBaseUrl({ ...BASE_SUBS, org: "" });

      expect(url).toBe("https://ingest.example.com/rum/v1/");
    });

    it("empty rumToken produces an empty clientToken string in raw code", () => {
      const card = rumIOSCard({
        ...BASE_SUBS,
        rumToken: "",
        rumTokenMasked: "",
      });
      const init = card.steps.find((s) => s.id === "init")!;

      expect(init.code!.raw).toContain('clientToken: "",');
    });
  });

  // ── determinism ──────────────────────────────────────────────────────────────

  describe("determinism", () => {
    it("calling rumIOSCard twice with identical subs returns identical output", () => {
      const card1 = rumIOSCard(BASE_SUBS);
      const card2 = rumIOSCard(BASE_SUBS);

      expect(JSON.stringify(card1)).toBe(JSON.stringify(card2));
    });

    it("different rumToken values produce different raw init codes", () => {
      const card1 = rumIOSCard({
        ...BASE_SUBS,
        rumToken: "token-a",
        rumTokenMasked: "tok-a",
      });
      const card2 = rumIOSCard({
        ...BASE_SUBS,
        rumToken: "token-b",
        rumTokenMasked: "tok-b",
      });

      const raw1 = card1.steps.find((s) => s.id === "init")!.code!.raw;
      const raw2 = card2.steps.find((s) => s.id === "init")!.code!.raw;

      expect(raw1).not.toBe(raw2);
    });
  });
});
