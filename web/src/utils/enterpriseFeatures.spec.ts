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

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/aws-exports", () => ({
  default: { isEnterprise: "false", isCloud: "false" },
}));

import config from "@/aws-exports";
import {
  checkFeatureAccess,
  buildFeatureGateContext,
  isFeatureKey,
  withFeatureGate,
} from "@/utils/enterpriseFeatures";

describe("enterpriseFeatures", () => {
  beforeEach(() => {
    config.isEnterprise = "false";
    config.isCloud = "false";
  });

  describe("buildFeatureGateContext", () => {
    it("reads isEnterprise/isCloud from config as strict string comparisons", () => {
      config.isEnterprise = "true";
      expect(buildFeatureGateContext().isEnterprise).toBe(true);
      expect(buildFeatureGateContext().isCloud).toBe(false);
    });

    it("reads rbac from the given zoConfig-shaped object, defaulting open when not yet loaded", () => {
      expect(buildFeatureGateContext({ rbac_enabled: true }).rbac).toBe(true);
      expect(buildFeatureGateContext({ rbac_enabled: false }).rbac).toBe(false);
      expect(buildFeatureGateContext(undefined).rbac).toBe(true);
      expect(buildFeatureGateContext(null).rbac).toBe(true);
      expect(buildFeatureGateContext({}).rbac).toBe(true);
    });
  });

  describe("checkFeatureAccess — isEnterprise-only keys", () => {
    it("locks an enterprise-only feature in OSS, with a message naming it", () => {
      const ctx = buildFeatureGateContext();
      const result = checkFeatureAccess("cipherKeys", ctx);
      expect(result.allowed).toBe(false);
      expect(result.message).toMatch(/Cipher Keys/);
      expect(result.message).toMatch(/Enterprise/);
    });

    it("unlocks an enterprise-only feature in a self-hosted enterprise build", () => {
      config.isEnterprise = "true";
      const result = checkFeatureAccess("cipherKeys", buildFeatureGateContext());
      expect(result.allowed).toBe(true);
      expect(result.message).toBe("");
    });

    it("does NOT unlock an enterprise-only feature in a pure cloud build", () => {
      config.isCloud = "true";
      const result = checkFeatureAccess("cipherKeys", buildFeatureGateContext());
      expect(result.allowed).toBe(false);
    });

    // Cloud never offers this batch at all — a self-hosted admin's own node/
    // cipher-key/license management has no Cloud equivalent to "upgrade"
    // into, so pure Cloud must hide it entirely rather than show a false
    // upsell. Service Graph is the same shape, covered below via `cloudOffers`.
    it.each(["cipherKeys", "enterprise", "nodes", "license"] as const)(
      "hides %s entirely (not locked) on a pure cloud build",
      (key) => {
        config.isCloud = "true";
        const result = checkFeatureAccess(key, buildFeatureGateContext());
        expect(result.allowed).toBe(false);
        expect(result.visible).toBe(false);
        expect(result.message).toBe("");
      },
    );

    it("stays visible-but-locked on OSS (not hidden) — only pure Cloud hides it", () => {
      const result = checkFeatureAccess("cipherKeys", buildFeatureGateContext());
      expect(result.allowed).toBe(false);
      expect(result.visible).toBe(true);
      expect(result.message).not.toBe("");
    });

    it("is visible (not hidden) on an enterprise+cloud hybrid build", () => {
      config.isEnterprise = "true";
      config.isCloud = "true";
      const result = checkFeatureAccess("cipherKeys", buildFeatureGateContext());
      expect(result.allowed).toBe(true);
      expect(result.visible).toBe(true);
    });
  });

  describe("checkFeatureAccess — isEnterprise-or-isCloud keys", () => {
    it.each(["incidents", "workflows", "oncall"] as const)("locks %s in OSS", (key) => {
      expect(checkFeatureAccess(key, buildFeatureGateContext()).allowed).toBe(false);
    });

    it("unlocks workflows in a pure cloud build", () => {
      config.isCloud = "true";
      expect(checkFeatureAccess("workflows", buildFeatureGateContext()).allowed).toBe(true);
    });

    it("unlocks workflows in a self-hosted enterprise build", () => {
      config.isEnterprise = "true";
      expect(checkFeatureAccess("workflows", buildFeatureGateContext()).allowed).toBe(true);
    });

    // Cloud DOES offer these (the predicate includes isCloud), so locked
    // never implies "pure cloud with nothing to offer" here — always
    // visible, unlike the isEnterprise-only batch above.
    it.each(["incidents", "workflows", "oncall", "rbac"] as const)(
      "stays visible when locked in OSS (%s)",
      (key) => {
        const result = checkFeatureAccess(key, buildFeatureGateContext({ rbac_enabled: true }));
        expect(result.allowed).toBe(false);
        expect(result.visible).toBe(true);
      },
    );
  });

  describe("checkFeatureAccess — rbac", () => {
    it("locks rbac in OSS even when the backend flag is on", () => {
      const ctx = buildFeatureGateContext({ rbac_enabled: true });
      expect(checkFeatureAccess("rbac", ctx).allowed).toBe(false);
    });

    it("locks rbac in an enterprise build when the backend flag is off", () => {
      config.isEnterprise = "true";
      const ctx = buildFeatureGateContext({ rbac_enabled: false });
      expect(checkFeatureAccess("rbac", ctx).allowed).toBe(false);
    });

    it("unlocks rbac only when the edition allows it AND the backend flag is on", () => {
      config.isEnterprise = "true";
      const ctx = buildFeatureGateContext({ rbac_enabled: true });
      expect(checkFeatureAccess("rbac", ctx).allowed).toBe(true);
    });

    // N1 regression: zoConfig is still {} on a cold load/refresh — this must
    // NOT bounce a real Enterprise/Cloud user with RBAC on to the locked page.
    it("unlocks rbac in an enterprise build when the backend flag hasn't loaded yet", () => {
      config.isEnterprise = "true";
      expect(checkFeatureAccess("rbac", buildFeatureGateContext({})).allowed).toBe(true);
      expect(checkFeatureAccess("rbac", buildFeatureGateContext(undefined)).allowed).toBe(true);
    });

    it("marks the upgrade CTA irrelevant when the edition already supports RBAC but the toggle is off", () => {
      config.isEnterprise = "true";
      const result = checkFeatureAccess("rbac", buildFeatureGateContext({ rbac_enabled: false }));
      expect(result.allowed).toBe(false);
      expect(result.ctaRelevant).toBe(false);
    });

    it("keeps the upgrade CTA relevant when OSS is the reason rbac is locked", () => {
      const result = checkFeatureAccess("rbac", buildFeatureGateContext({ rbac_enabled: true }));
      expect(result.allowed).toBe(false);
      expect(result.ctaRelevant).toBe(true);
    });
  });

  describe("withFeatureGate", () => {
    it("calls the wrapped guard when the feature is allowed", () => {
      config.isEnterprise = "true";
      const guard = vi.fn();
      const next = vi.fn();
      withFeatureGate("cipherKeys", guard)({ query: {} }, {}, next);
      expect(guard).toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it("redirects to the locked page, preserving org_identifier and the original path", () => {
      const guard = vi.fn();
      const next = vi.fn();
      const to = { query: { org_identifier: "o1" }, fullPath: "/settings/cipher_keys?org_identifier=o1" };
      withFeatureGate("cipherKeys", guard)(to, {}, next);
      expect(guard).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith({
        name: "enterpriseFeatureLocked",
        query: {
          feature: "cipherKeys",
          org_identifier: "o1",
          redirect: "/settings/cipher_keys?org_identifier=o1",
        },
      });
    });
  });

  describe("isFeatureKey", () => {
    it("recognizes every registered key", () => {
      expect(isFeatureKey("cipherKeys")).toBe(true);
      expect(isFeatureKey("oncall")).toBe(true);
    });

    it("rejects an unrelated gate string", () => {
      expect(isFeatureKey("databaseMonitoring")).toBe(false);
      expect(isFeatureKey("streamPipelines")).toBe(false);
      expect(isFeatureKey("not-a-real-key")).toBe(false);
    });
  });
});
