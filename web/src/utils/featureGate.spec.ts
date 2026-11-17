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

import { describe, expect, it } from "vitest";

import {
  effectiveLimitGb,
  featureLockedPath,
  featureState,
  forbiddenState,
  licenseDeniedFeatures,
  licenseKeyLosses,
  licenseRequestUrl,
  menuState,
  splitLicenseFeatures,
  streamTypeFeature,
  withLicenseFeature,
} from "./featureGate";

const forbidden = (data: Record<string, unknown>) => ({ response: { status: 403, data } });

describe("featureState", () => {
  it("treats a key the backend did not send as enabled", () => {
    expect(featureState(undefined, "workflows")).toBe("enabled");
    expect(featureState({}, "workflows")).toBe("enabled");
    expect(featureState({ oncall: "locked" }, "workflows")).toBe("enabled");
  });

  it("returns each state the backend sent", () => {
    const features = { workflows: "enabled", oncall: "locked", incidents: "hidden" } as const;
    expect(featureState(features, "workflows")).toBe("enabled");
    expect(featureState(features, "oncall")).toBe("locked");
    expect(featureState(features, "incidents")).toBe("hidden");
  });
});

describe("menuState", () => {
  it("keeps locked and hidden whatever the runtime flag says", () => {
    expect(menuState({ oncall: "locked" }, "oncall", false)).toBe("locked");
    expect(menuState({ oncall: "hidden" }, "oncall", true)).toBe("hidden");
  });

  it("hides an enabled feature whose runtime flag is off, as older backends expect", () => {
    expect(menuState(undefined, "oncall", true)).toBe("enabled");
    expect(menuState(undefined, "oncall", false)).toBe("hidden");
    expect(menuState({ oncall: "enabled" }, "oncall", false)).toBe("hidden");
  });
});

describe("streamTypeFeature", () => {
  it("maps each signal stream type to its own license key", () => {
    expect(streamTypeFeature("logs")).toBe("logs");
    expect(streamTypeFeature("metrics")).toBe("metrics");
    expect(streamTypeFeature("traces")).toBe("traces");
  });

  it("reads a missing stream type as logs, as the backend does", () => {
    expect(streamTypeFeature(undefined)).toBe("logs");
    expect(streamTypeFeature(null)).toBe("logs");
    expect(streamTypeFeature("")).toBe("logs");
  });

  it("gives other stream types no license key", () => {
    expect(streamTypeFeature("enrichment_tables")).toBeNull();
    expect(streamTypeFeature("metadata")).toBeNull();
  });
});

describe("featureLockedPath", () => {
  it("points at the shared upsell route", () => {
    expect(featureLockedPath("ai_assistant")).toBe("/feature-locked/ai_assistant");
  });
});

describe("withLicenseFeature", () => {
  it("tags the route and every child, keeping the meta already there", () => {
    const route = withLicenseFeature("workflows", {
      path: "workflows",
      meta: { titleKey: "menu.workflows" },
      children: [{ path: "add" }, { path: "runs", children: [{ path: "detail" }] }],
    });
    expect(route.meta).toEqual({ titleKey: "menu.workflows", licenseFeature: "workflows" });
    expect(route.children?.[0].meta).toEqual({ licenseFeature: "workflows" });
    expect(route.children?.[1].children?.[0].meta).toEqual({ licenseFeature: "workflows" });
  });

  it("adds no children to a leaf route", () => {
    expect(withLicenseFeature("oncall", { path: "oncall" })).not.toHaveProperty("children");
  });
});

describe("licenseDeniedFeatures", () => {
  it("returns the missing keys of a 403 with code 40001", () => {
    expect(
      licenseDeniedFeatures(forbidden({ code: 40001, error_detail: "oncall, workflows" })),
    ).toEqual(["oncall", "workflows"]);
    expect(licenseDeniedFeatures(forbidden({ code: 40001, error_detail: "incidents" }))).toEqual([
      "incidents",
    ]);
  });

  it("still flags a denial whose detail is missing", () => {
    expect(licenseDeniedFeatures(forbidden({ code: 40001 }))).toEqual([]);
  });

  it("ignores RBAC 403s and other statuses", () => {
    expect(licenseDeniedFeatures(forbidden({}))).toBeNull();
    expect(
      licenseDeniedFeatures(forbidden({ code: 403, message: "Unauthorized Access" })),
    ).toBeNull();
    expect(
      licenseDeniedFeatures({
        response: { status: 400, data: { code: 40001, error_detail: "x" } },
      }),
    ).toBeNull();
    expect(licenseDeniedFeatures(undefined)).toBeNull();
  });
});

describe("forbiddenState", () => {
  it("returns the missing keys for a license 403, true for an RBAC 403, false otherwise", () => {
    expect(forbiddenState(forbidden({ code: 40001, error_detail: "dashboards" }))).toEqual([
      "dashboards",
    ]);
    expect(forbiddenState(forbidden({ code: 403, message: "Unauthorized Access" }))).toBe(true);
    expect(forbiddenState({ response: { status: 500, data: {} } })).toBe(false);
    expect(forbiddenState(undefined)).toBe(false);
  });
});

describe("licenseRequestUrl", () => {
  const definition = {
    features: {
      ai_assistant: { gate: true },
      oncall: { gate: true },
      alerts: { gate: false },
    },
  };
  const zoConfig = {
    license_server_url: "https://license.example.com//",
    version: "v0.70.0",
    feature_revision: 1,
    features: {},
  };
  const base = "http://localhost:3000";
  const query = (url: string) => Object.fromEntries(new URL(url).searchParams);

  it.each([
    ["a list", ["oncall"], "oncall"],
    ["all", ["all"], "ai_assistant,oncall"],
    ["an empty list", [], ""],
  ])("sends the unlocked keys of %s, as the split reports them", (_name, features, expected) => {
    const license = { features, feature_definition: definition };
    const url = licenseRequestUrl(zoConfig, { installation_id: "inst", license }, base);

    expect(query(url)).toEqual({
      base_url: base,
      license_id: "inst",
      o2_version: "v0.70.0",
      feature_revision: "1",
      features: expected,
    });
    expect(query(url).features).toBe(splitLicenseFeatures(license, {})?.unlocked.join(","));
    expect(url.startsWith("https://license.example.com/user/request-license?")).toBe(true);
  });

  it.each([
    ["no license", null],
    ["a license without a list", { feature_definition: definition }],
  ])("omits features for %s", (_name, license) => {
    expect(query(licenseRequestUrl(zoConfig, { license }, base))).toEqual({
      base_url: base,
      license_id: "",
      o2_version: "v0.70.0",
      feature_revision: "1",
    });
  });

  it("omits what the config does not report", () => {
    const bare = { license_server_url: "https://license.example.com" };

    expect(query(licenseRequestUrl(bare, {}, base))).toEqual({ base_url: base, license_id: "" });
  });
});

describe("effectiveLimitGb", () => {
  const limited = { limits: { Ingestion: { typ: "PerDayCount", value: 200 } } };
  const unlimited = { limits: { Ingestion: { typ: "Unlimited", value: 0 } } };
  // A serialized LicenseResponse; evaluated_at 0 carries the backend's synthesised decision.
  const licenseResponse = (
    license: object,
    limit_today_gb: number | null,
    evaluated_at: number,
    expired: boolean,
  ) => {
    const decision = {
      search_allowed: true,
      blocks: [],
      exceeded_days: 0,
      allowed_days: 3,
      limit_today_gb,
      used_today_gb: 0,
      waiver_ids_applied: [],
    };
    return {
      key: "anonymised-key",
      license,
      installation_id: "inst_test",
      expired,
      ingestion_used: 0,
      ingestion_exceeded: 0,
      waivers: [],
      decision,
      base: decision,
      evaluated_at,
      env_key_active: false,
      env_key_in_use: false,
      can_update_license: true,
    };
  };

  it.each([
    ["an evaluated limit over the license's", limited, 50, 1, false, 50],
    ["an evaluated Unlimited", unlimited, null, 1, false, null],
    ["an expired key's evaluated limit", limited, 50, 1, true, 50],
    ["the license's limit before evaluation", limited, null, 0, false, 200],
    ["the license's Unlimited before evaluation", unlimited, null, 0, false, null],
    ["the free limit when a license sets none", { limits: {} }, null, 0, false, 50],
    ["the free limit for an expired key before evaluation", limited, null, 0, true, 50],
    ["the free limit for an expired Unlimited before evaluation", unlimited, null, 0, true, 50],
  ])("reads %s", (_name, license, limit, evaluatedAt, expired, expected) => {
    expect(effectiveLimitGb(licenseResponse(license, limit, evaluatedAt, expired))).toBe(expected);
  });
});

describe("licenseKeyLosses", () => {
  const NOW = 2_000_000;
  const definition = {
    features: {
      ai_assistant: { gate: true },
      oncall: { gate: true },
      workflows: { gate: true },
      metering: { gate: true, plumbing: true },
      alerts: { gate: false },
    },
  };
  const per = (value: number) => ({ Ingestion: { typ: "PerDayCount", value } });
  const key = (overrides: Record<string, unknown> = {}) => ({
    features: ["ai_assistant", "oncall"],
    feature_definition: definition,
    limits: per(100),
    expires_at: 3_000_000,
    ...overrides,
  });
  const losses = (current: unknown, pasted: unknown, states = {}) =>
    licenseKeyLosses(current as never, pasted as never, states, NOW);

  it.each([
    ["an identical key", key(), key()],
    ["a renewal", key(), key({ expires_at: 4_000_000 })],
    ["an upgrade", key(), key({ features: ["all"], limits: per(200) })],
    ["more features on the same terms", key(), key({ features: ["ai_assistant", "oncall", "x"] })],
    ["a first key", null, key()],
    [
      "a free key dropped from the list",
      key({ features: ["ai_assistant", "alerts"] }),
      key({ features: ["ai_assistant"] }),
    ],
    [
      "a renewal of an expired key above the free limit",
      key({ expires_at: 1_000_000, limits: per(200) }),
      key({ limits: per(100) }),
    ],
  ])("finds nothing worse in %s", (_name, current, pasted) => {
    expect(losses(current, pasted)).toBeNull();
  });

  it.each([
    ["all", ["all"]],
    ["an absent list", undefined],
  ])("treats %s as every gated key, plumbing excluded", (_name, features) => {
    const result = losses(key({ features }), key({ features: ["ai_assistant"] }));

    expect(result?.lost).toEqual(["oncall", "workflows"]);
  });

  it("reads gates from the other key when one has no definition", () => {
    const current = key({ features: ["all"], feature_definition: undefined });

    expect(losses(current, key({ features: ["ai_assistant"] }))?.lost).toEqual([
      "oncall",
      "workflows",
    ]);
  });

  it("counts a listed key as lost without any definition", () => {
    const current = key({ feature_definition: undefined });
    const pasted = key({ features: ["ai_assistant"], feature_definition: undefined });

    expect(losses(current, pasted)?.lost).toEqual(["oncall"]);
  });

  it("reports a lower limit and Unlimited to a number", () => {
    expect(losses(key(), key({ limits: per(50) }))?.limit).toEqual({ from: 100, to: 50 });
    expect(
      losses(key({ limits: { Ingestion: { typ: "Unlimited", value: 0 } } }), key())?.limit,
    ).toEqual({ from: null, to: 100 });
  });

  it("judges a limit from the free one when the current key has expired", () => {
    const current = key({ expires_at: 1_000_000, limits: per(200) });

    expect(losses(current, key({ limits: per(30) }))?.limit).toEqual({ from: 50, to: 30 });
  });

  it("reports an earlier expiry", () => {
    expect(losses(key(), key({ expires_at: 2_500_000 }))?.expiry).toEqual({
      from: 3_000_000,
      to: 2_500_000,
    });
  });

  it("reports an expired paste by date alone, even as a first key", () => {
    const pasted = key({ expires_at: 1_500_000, limits: per(10) });

    expect(losses(null, pasted)).toEqual({ expiredAt: 1_500_000, lost: [] });
    expect(losses(key(), pasted)).toEqual({ expiredAt: 1_500_000, lost: [] });
  });
});

describe("splitLicenseFeatures", () => {
  // Revision 1 as licenses issued before RBAC was ungated embed it (feature-definitions 34d6043).
  const preFlip = {
    features: {
      ai_assistant: { display_name: "AI Assistant", gate: true },
      workflows: { display_name: "Workflows", gate: true },
      rbac: { display_name: "Role-Based Access Control", gate: true },
      logs: { display_name: "Logs" },
      sso: { display_name: "Single Sign-On", plumbing: true },
    },
  };
  const paidOn = { ai_assistant: "enabled", workflows: "locked", logs: "enabled" } as const;

  it("moves an enabled, unlisted gated key out of missing and paid into its own group", () => {
    const split = splitLicenseFeatures(
      { features: ["ai_assistant"], feature_definition: preFlip },
      { ...paidOn, rbac: "enabled" },
    );

    expect(split).toMatchObject({
      unlocked: ["ai_assistant"],
      missing: ["workflows"],
      free: ["logs", "sso"],
      freeNotIncluded: ["rbac"],
      paid: 2,
    });
  });

  it.each([
    ["locked", { ...paidOn, rbac: "locked" }, ["rbac", "workflows"], ["logs", "sso"]],
    ["hidden", { ...paidOn, rbac: "hidden" }, ["rbac", "workflows"], ["logs", "sso"]],
    ["absent", paidOn, ["rbac", "workflows"], ["logs", "sso"]],
    ["an empty states map", {}, ["rbac", "workflows"], ["logs", "sso"]],
  ] as const)("keeps today's split for %s", (_name, states, missing, free) => {
    const split = splitLicenseFeatures(
      { features: ["ai_assistant"], feature_definition: preFlip },
      states,
    );

    expect(split).toMatchObject({ missing, free, freeNotIncluded: [], paid: 3 });
  });

  describe("while the license has not been evaluated", () => {
    const downgraded = { features: ["ai_assistant"], feature_definition: preFlip };
    const oldKeyStates = { ...paidOn, workflows: "enabled", rbac: "enabled" } as const;

    it("keeps enabled, unlisted gated keys under missing and paid at evaluated_at 0", () => {
      expect(splitLicenseFeatures(downgraded, oldKeyStates, 0)).toMatchObject({
        unlocked: ["ai_assistant"],
        missing: ["rbac", "workflows"],
        freeNotIncluded: [],
        paid: 3,
      });
    });

    it.each([
      ["an evaluated license", 1792000000000000],
      ["a caller with no evaluated_at", undefined],
    ])("trusts the config for %s", (_name, evaluatedAt) => {
      expect(splitLicenseFeatures(downgraded, oldKeyStates, evaluatedAt)).toMatchObject({
        missing: [],
        freeNotIncluded: ["rbac", "workflows"],
        paid: 1,
      });
    });
  });

  it('keeps every gated key unlocked on a license listing only "all"', () => {
    const split = splitLicenseFeatures(
      { features: ["all"], feature_definition: preFlip },
      { ...paidOn, rbac: "enabled" },
    );

    expect(split).toMatchObject({
      unlocked: ["ai_assistant", "rbac", "workflows"],
      missing: [],
      freeNotIncluded: [],
      paid: 3,
    });
  });

  it("keeps a listed key unlocked when it is also enabled", () => {
    const split = splitLicenseFeatures(
      { features: ["rbac"], feature_definition: preFlip },
      { rbac: "enabled" },
    );

    expect(split?.unlocked).toEqual(["rbac"]);
    expect(split?.freeNotIncluded).toEqual([]);
  });

  it("has nothing to move without a definition", () => {
    const split = splitLicenseFeatures(
      { features: ["workflows"] },
      { workflows: "enabled", rbac: "locked", logs: "enabled" },
    );

    expect(split).toMatchObject({
      unlocked: ["workflows"],
      missing: ["rbac"],
      free: ["logs"],
      freeNotIncluded: [],
    });
  });
});
