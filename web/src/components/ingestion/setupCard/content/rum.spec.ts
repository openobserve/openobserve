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
 * Unit tests for the pure `rumCard()` builder function.
 * This module has no Vue component — all assertions are on the returned data
 * structure. No mounting, no store, no i18n.
 *
 * rum.ts exports:
 *   - rumCard(subs: RumCardSubs): RichCardContent
 *   - RUM_SDK_VERSION: string
 */

import { describe, it, expect, vi } from "vitest";

// Mock getImageURL before importing rum.ts so the builder can resolve assets
// without a real DOM environment.
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((p: string) => `/mocked-asset/${p}`),
}));

import rumCard, { RUM_SDK_VERSION } from "./rum";
import type { RumCardSubs } from "./rum";
import type { RichCardContent } from "../types";

// ── shared substitutions ──────────────────────────────────────────────────────

const BASE_SUBS: RumCardSubs = {
  site: "ingest.example.com",
  endpoint: "https://ingest.example.com",
  org: "my-org",
  rumToken: "raw-token-abc123",
  rumTokenMasked: "raw-****-abc123",
  insecureHTTP: false,
};

const HTTP_SUBS: RumCardSubs = {
  ...BASE_SUBS,
  insecureHTTP: true,
};

// ── helpers ───────────────────────────────────────────────────────────────────

function buildCard(subs: RumCardSubs = BASE_SUBS): RichCardContent {
  return rumCard(subs);
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("rumCard builder", () => {

  // ── provider metadata ────────────────────────────────────────────────────────

  describe("provider", () => {
    it("sets provider.name to 'Real User Monitoring'", () => {
      const card = buildCard();
      expect(card.provider.name).toBe("Real User Monitoring");
    });

    it("includes a non-empty tagline", () => {
      const card = buildCard();
      expect(card.provider.tagline.length).toBeGreaterThan(0);
    });

    it("sets runtime to 'Browser'", () => {
      const card = buildCard();
      expect(card.provider.runtime).toBe("Browser");
    });

    it("includes Sessions, Errors, Web Vitals and Session Replay in metaBadges", () => {
      const card = buildCard();
      expect(card.provider.metaBadges).toEqual(
        expect.arrayContaining(["Sessions", "Errors", "Web Vitals", "Session Replay"]),
      );
    });

    it("has a non-empty logo URL (resolved via getImageURL)", () => {
      const card = buildCard();
      expect(card.provider.logo).toBeTruthy();
    });
  });

  // ── step structure ───────────────────────────────────────────────────────────

  describe("steps structure", () => {
    it("returns exactly 3 steps", () => {
      const card = buildCard();
      expect(card.steps).toHaveLength(3);
    });

    it("step ids are install, init, verify in order", () => {
      const card = buildCard();
      expect(card.steps.map((s) => s.id)).toEqual(["install", "init", "verify"]);
    });

    it("install step has chip with label 'Install'", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;
      expect(install.chip?.label).toBe("Install");
    });

    it("init step has chip with label 'Editor'", () => {
      const card = buildCard();
      const init = card.steps.find((s) => s.id === "init")!;
      expect(init.chip?.label).toBe("Editor");
    });

    it("verify step has chip with label 'RUM'", () => {
      const card = buildCard();
      const verify = card.steps.find((s) => s.id === "verify")!;
      expect(verify.chip?.label).toBe("RUM");
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

    it("verify completeOn is 'detect'", () => {
      const card = buildCard();
      const verify = card.steps.find((s) => s.id === "verify")!;
      expect(verify.completeOn).toBe("detect");
    });
  });

  // ── variant group ────────────────────────────────────────────────────────────

  describe("variantGroup sharing between install and init", () => {
    it("install and init steps share variantGroup 'pkg'", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;
      const init = card.steps.find((s) => s.id === "init")!;
      expect(install.variantGroup).toBe("pkg");
      expect(init.variantGroup).toBe("pkg");
    });

    it("install and init each have npm and cdn variants", () => {
      const card = buildCard();
      for (const stepId of ["install", "init"]) {
        const step = card.steps.find((s) => s.id === stepId)!;
        expect(step.variants).toBeDefined();
        const ids = step.variants!.map((v) => v.id);
        expect(ids).toContain("npm");
        expect(ids).toContain("cdn");
      }
    });
  });

  // ── NPM install ──────────────────────────────────────────────────────────────

  describe("NPM install variant", () => {
    it("npm install code.raw is exactly the install command", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;
      const npm = install.variants!.find((v) => v.id === "npm")!;
      expect(npm.code.raw).toBe(
        "npm i @openobserve/browser-rum @openobserve/browser-logs",
      );
    });

    it("npm install code.lang is 'bash'", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;
      const npm = install.variants!.find((v) => v.id === "npm")!;
      expect(npm.code.lang).toBe("bash");
    });

    it("npm install variant has no masked code (no token in install step)", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;
      const npm = install.variants!.find((v) => v.id === "npm")!;
      // Install command doesn't contain a token, so masked is not required
      expect(npm.code.masked).toBeUndefined();
    });
  });

  // ── CDN install ──────────────────────────────────────────────────────────────

  describe("CDN install variant", () => {
    it("cdn install code.lang is 'html'", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;
      const cdn = install.variants!.find((v) => v.id === "cdn")!;
      expect(cdn.code.lang).toBe("html");
    });

    it("cdn install code contains preconnect for browsersdk.openobserve.ai", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;
      const cdn = install.variants!.find((v) => v.id === "cdn")!;
      expect(cdn.code.raw).toContain(
        'rel="preconnect" href="https://browsersdk.openobserve.ai"',
      );
    });

    it("cdn install code contains dns-prefetch for browsersdk.openobserve.ai", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;
      const cdn = install.variants!.find((v) => v.id === "cdn")!;
      expect(cdn.code.raw).toContain(
        'rel="dns-prefetch" href="https://browsersdk.openobserve.ai"',
      );
    });

    it("cdn install code contains preconnect for the passed endpoint", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;
      const cdn = install.variants!.find((v) => v.id === "cdn")!;
      expect(cdn.code.raw).toContain(
        `href="${BASE_SUBS.endpoint}"`,
      );
    });

    it("cdn install code contains dns-prefetch for the passed endpoint", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;
      const cdn = install.variants!.find((v) => v.id === "cdn")!;
      expect(cdn.code.raw).toContain(
        `rel="dns-prefetch" href="${BASE_SUBS.endpoint}"`,
      );
    });

    it("cdn install code contains the pinned-version RUM bundle URL", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;
      const cdn = install.variants!.find((v) => v.id === "cdn")!;
      expect(cdn.code.raw).toContain(
        `https://browsersdk.openobserve.ai/${RUM_SDK_VERSION}/openobserve-rum.js`,
      );
    });

    it("cdn install code contains the pinned-version LOGS bundle URL", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;
      const cdn = install.variants!.find((v) => v.id === "cdn")!;
      expect(cdn.code.raw).toContain(
        `https://browsersdk.openobserve.ai/${RUM_SDK_VERSION}/openobserve-logs.js`,
      );
    });

    it("cdn install code contains OO_RUM async loader global name", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;
      const cdn = install.variants!.find((v) => v.id === "cdn")!;
      expect(cdn.code.raw).toContain("OO_RUM");
    });

    it("cdn install code contains OO_LOGS async loader global name", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;
      const cdn = install.variants!.find((v) => v.id === "cdn")!;
      expect(cdn.code.raw).toContain("OO_LOGS");
    });
  });

  // ── NPM init variant ─────────────────────────────────────────────────────────

  describe("NPM init variant — raw vs masked", () => {
    it("raw contains the raw rumToken", () => {
      const card = buildCard();
      const init = card.steps.find((s) => s.id === "init")!;
      const npm = init.variants!.find((v) => v.id === "npm")!;
      expect(npm.code.raw).toContain(BASE_SUBS.rumToken);
    });

    it("masked contains the masked token, not the raw token", () => {
      const subs: RumCardSubs = {
        ...BASE_SUBS,
        rumToken: "super-secret-token",
        rumTokenMasked: "supe-****-oken",
      };
      const card = rumCard(subs);
      const init = card.steps.find((s) => s.id === "init")!;
      const npm = init.variants!.find((v) => v.id === "npm")!;

      expect(npm.code.masked).toContain("supe-****-oken");
      expect(npm.code.masked).not.toContain("super-secret-token");
    });

    it("raw does NOT contain the masked string when they differ", () => {
      const subs: RumCardSubs = {
        ...BASE_SUBS,
        rumToken: "super-secret-token",
        rumTokenMasked: "supe-****-oken",
      };
      const card = rumCard(subs);
      const init = card.steps.find((s) => s.id === "init")!;
      const npm = init.variants!.find((v) => v.id === "npm")!;

      expect(npm.code.raw).not.toContain("supe-****-oken");
    });

    it("npm init code.lang is 'javascript'", () => {
      const card = buildCard();
      const init = card.steps.find((s) => s.id === "init")!;
      const npm = init.variants!.find((v) => v.id === "npm")!;
      expect(npm.code.lang).toBe("javascript");
    });

    it("npm init code has filename 'main.js'", () => {
      const card = buildCard();
      const init = card.steps.find((s) => s.id === "init")!;
      const npm = init.variants!.find((v) => v.id === "npm")!;
      expect(npm.code.filename).toBe("main.js");
    });

    it("raw code contains insecureHTTP: false when subs.insecureHTTP is false", () => {
      const card = rumCard(BASE_SUBS); // insecureHTTP: false
      const init = card.steps.find((s) => s.id === "init")!;
      const npm = init.variants!.find((v) => v.id === "npm")!;
      expect(npm.code.raw).toContain("insecureHTTP: false");
    });

    it("raw code contains insecureHTTP: true when subs.insecureHTTP is true", () => {
      const card = rumCard(HTTP_SUBS); // insecureHTTP: true
      const init = card.steps.find((s) => s.id === "init")!;
      const npm = init.variants!.find((v) => v.id === "npm")!;
      expect(npm.code.raw).toContain("insecureHTTP: true");
    });

    it("raw code contains the org identifier", () => {
      const card = buildCard();
      const init = card.steps.find((s) => s.id === "init")!;
      const npm = init.variants!.find((v) => v.id === "npm")!;
      expect(npm.code.raw).toContain(`organizationIdentifier: '${BASE_SUBS.org}'`);
    });

    it("raw code contains the site (protocol-stripped host)", () => {
      const card = buildCard();
      const init = card.steps.find((s) => s.id === "init")!;
      const npm = init.variants!.find((v) => v.id === "npm")!;
      expect(npm.code.raw).toContain(`site: '${BASE_SUBS.site}'`);
    });

    it("raw includes openobserveRum.init call", () => {
      const card = buildCard();
      const init = card.steps.find((s) => s.id === "init")!;
      const npm = init.variants!.find((v) => v.id === "npm")!;
      expect(npm.code.raw).toContain("openobserveRum.init(");
    });

    it("raw includes openobserveLogs.init call", () => {
      const card = buildCard();
      const init = card.steps.find((s) => s.id === "init")!;
      const npm = init.variants!.find((v) => v.id === "npm")!;
      expect(npm.code.raw).toContain("openobserveLogs.init(");
    });

    it("raw includes startSessionReplayRecording call", () => {
      const card = buildCard();
      const init = card.steps.find((s) => s.id === "init")!;
      const npm = init.variants!.find((v) => v.id === "npm")!;
      expect(npm.code.raw).toContain("startSessionReplayRecording");
    });
  });

  // ── CDN init variant ─────────────────────────────────────────────────────────

  describe("CDN init variant — raw vs masked", () => {
    it("raw contains the raw rumToken", () => {
      const card = buildCard();
      const init = card.steps.find((s) => s.id === "init")!;
      const cdn = init.variants!.find((v) => v.id === "cdn")!;
      expect(cdn.code.raw).toContain(BASE_SUBS.rumToken);
    });

    it("masked contains the masked token, not the raw token", () => {
      const subs: RumCardSubs = {
        ...BASE_SUBS,
        rumToken: "super-secret-token",
        rumTokenMasked: "supe-****-oken",
      };
      const card = rumCard(subs);
      const init = card.steps.find((s) => s.id === "init")!;
      const cdn = init.variants!.find((v) => v.id === "cdn")!;

      expect(cdn.code.masked).toContain("supe-****-oken");
      expect(cdn.code.masked).not.toContain("super-secret-token");
    });

    it("cdn init code.lang is 'html'", () => {
      const card = buildCard();
      const init = card.steps.find((s) => s.id === "init")!;
      const cdn = init.variants!.find((v) => v.id === "cdn")!;
      expect(cdn.code.lang).toBe("html");
    });

    it("cdn init code uses OO_RUM.onReady wrapper", () => {
      const card = buildCard();
      const init = card.steps.find((s) => s.id === "init")!;
      const cdn = init.variants!.find((v) => v.id === "cdn")!;
      expect(cdn.code.raw).toContain("OO_RUM.onReady");
    });

    it("cdn init code uses OO_LOGS.onReady wrapper", () => {
      const card = buildCard();
      const init = card.steps.find((s) => s.id === "init")!;
      const cdn = init.variants!.find((v) => v.id === "cdn")!;
      expect(cdn.code.raw).toContain("OO_LOGS.onReady");
    });

    it("cdn init raw code contains insecureHTTP: true for http subs", () => {
      const card = rumCard(HTTP_SUBS);
      const init = card.steps.find((s) => s.id === "init")!;
      const cdn = init.variants!.find((v) => v.id === "cdn")!;
      expect(cdn.code.raw).toContain("insecureHTTP: true");
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

    it("filter is \"type = 'view'\"", () => {
      const card = buildCard();
      expect(card.detect.filter).toBe("type = 'view'");
    });
  });

  // ── substitution edge cases ──────────────────────────────────────────────────

  describe("substitution edge cases", () => {
    it("empty org string is substituted verbatim", () => {
      const card = rumCard({ ...BASE_SUBS, org: "" });
      const init = card.steps.find((s) => s.id === "init")!;
      const npm = init.variants!.find((v) => v.id === "npm")!;
      expect(npm.code.raw).toContain("organizationIdentifier: ''");
    });

    it("org with special characters is substituted verbatim", () => {
      const card = rumCard({ ...BASE_SUBS, org: "my-org_2024" });
      const init = card.steps.find((s) => s.id === "init")!;
      const npm = init.variants!.find((v) => v.id === "npm")!;
      expect(npm.code.raw).toContain("organizationIdentifier: 'my-org_2024'");
    });

    it("empty rumToken produces empty clientToken in raw code", () => {
      const card = rumCard({ ...BASE_SUBS, rumToken: "", rumTokenMasked: "" });
      const init = card.steps.find((s) => s.id === "init")!;
      const npm = init.variants!.find((v) => v.id === "npm")!;
      expect(npm.code.raw).toContain("clientToken: ''");
    });

    it("endpoint is used in CDN install preconnect regardless of subs.site", () => {
      const card = rumCard({
        ...BASE_SUBS,
        site: "ingest.example.com",
        endpoint: "https://different.endpoint.com",
      });
      const install = card.steps.find((s) => s.id === "install")!;
      const cdn = install.variants!.find((v) => v.id === "cdn")!;
      expect(cdn.code.raw).toContain('href="https://different.endpoint.com"');
    });

    it("site is used in init options, not endpoint", () => {
      const card = rumCard({
        ...BASE_SUBS,
        site: "custom-site.io",
        endpoint: "https://custom-site.io",
      });
      const init = card.steps.find((s) => s.id === "init")!;
      const npm = init.variants!.find((v) => v.id === "npm")!;
      expect(npm.code.raw).toContain("site: 'custom-site.io'");
    });
  });

  // ── extras / troubleshooting ─────────────────────────────────────────────────

  describe("extras", () => {
    it("extras.troubleshooting is a non-empty array", () => {
      const card = buildCard();
      expect(card.extras?.troubleshooting).toBeDefined();
      expect((card.extras!.troubleshooting as any[]).length).toBeGreaterThan(0);
    });

    it("extras.fixSnippet contains the endpoint in the connect-src directive", () => {
      const card = buildCard();
      expect(card.extras?.fixSnippet).toContain(BASE_SUBS.endpoint);
    });

    it("each troubleshooting entry has a q and a string", () => {
      const card = buildCard();
      for (const entry of card.extras!.troubleshooting as any[]) {
        expect(typeof entry.q).toBe("string");
        expect(typeof entry.a).toBe("string");
        expect(entry.q.length).toBeGreaterThan(0);
        expect(entry.a.length).toBeGreaterThan(0);
      }
    });

    it("documents that the client token is visible in page source and how to rotate it", () => {
      const card = buildCard();

      const init = card.steps.find((s) => s.id === "init")!;
      const ts = card.extras!.troubleshooting as any[];
      const exposureEntry = ts.find((e: any) =>
        e.q.toLowerCase().includes("visible"),
      );

      // The init step (both NPM and CDN tabs) states the token ships to
      // visitors' browsers and can be rotated.
      expect(init.description).toContain("ships to visitors' browsers");
      expect(init.description).toContain("rotate");
      // The troubleshooting entry explains it is write-only and rotatable.
      expect(exposureEntry).toBeDefined();
      expect(exposureEntry.a).toContain("write");
      expect(exposureEntry.a).toContain("regenerate");
    });

    it("insecureHTTP value appears in the troubleshooting answer about HTTP", () => {
      const card = rumCard(HTTP_SUBS); // insecureHTTP: true
      const ts = card.extras!.troubleshooting as any[];
      const httpEntry = ts.find((e: any) =>
        e.q.toLowerCase().includes("http"),
      );
      expect(httpEntry).toBeDefined();
      expect(httpEntry.a).toContain("true");
    });
  });

  // ── docUrl ───────────────────────────────────────────────────────────────────

  describe("docUrl", () => {
    it("provides a non-empty docUrl", () => {
      const card = buildCard();
      expect(card.docUrl).toBeTruthy();
      expect(card.docUrl).toContain("openobserve.ai");
    });
  });

  // ── determinism ──────────────────────────────────────────────────────────────

  describe("determinism", () => {
    it("calling rumCard twice with identical subs returns identical output", () => {
      const card1 = rumCard(BASE_SUBS);
      const card2 = rumCard(BASE_SUBS);
      expect(JSON.stringify(card1)).toBe(JSON.stringify(card2));
    });

    it("different rumToken values produce different raw init codes", () => {
      const card1 = rumCard({ ...BASE_SUBS, rumToken: "token-a", rumTokenMasked: "tok-a" });
      const card2 = rumCard({ ...BASE_SUBS, rumToken: "token-b", rumTokenMasked: "tok-b" });
      const raw1 = card1.steps.find((s) => s.id === "init")!.variants!.find((v) => v.id === "npm")!.code.raw;
      const raw2 = card2.steps.find((s) => s.id === "init")!.variants!.find((v) => v.id === "npm")!.code.raw;
      expect(raw1).not.toBe(raw2);
    });
  });

  // ── RUM_SDK_VERSION export ────────────────────────────────────────────────────

  describe("RUM_SDK_VERSION", () => {
    it("is a non-empty semver-like string", () => {
      expect(typeof RUM_SDK_VERSION).toBe("string");
      expect(RUM_SDK_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it("CDN bundle URLs contain the pinned version", () => {
      const card = buildCard();
      const install = card.steps.find((s) => s.id === "install")!;
      const cdn = install.variants!.find((v) => v.id === "cdn")!;
      expect(cdn.code.raw).toContain(
        `https://browsersdk.openobserve.ai/${RUM_SDK_VERSION}/`,
      );
    });
  });
});
