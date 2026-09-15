// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// All vi.mock calls MUST be at the TOP (hoisted by Vitest)

vi.mock("../aws-exports", () => ({
  default: { isCloud: "false" },
}));

vi.mock("vuex", () => ({
  useStore: vi.fn(),
}));

vi.mock("@/services/users", () => ({
  default: {
    logout: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("@/services/organizations", () => ({
  default: {
    get_organization_summary: vi.fn().mockResolvedValue({ data: { streams: { num_streams: 5 } } }),
  },
}));

vi.mock("@/utils/formatters", () => ({
  b64DecodeUnicode: vi.fn(),
  b64EncodeStandard: vi.fn(),
  b64DecodeStandard: vi.fn(),
}));

vi.mock("@/utils/storage", () => ({
  useLocalUserInfo: vi.fn(),
}));

vi.mock("@/utils/uuid", () => ({
  getUUID: vi.fn(() => "aaaabbbb-cccc-dddd-0000-111122223333"),
  getUUIDv7: vi.fn((compact?: boolean) =>
    compact ? "0123456789ab7def8123456789abcdef" : "01234567-89ab-7def-8123-456789abcdef",
  ),
}));

// Imports AFTER mocks
import config from "../aws-exports";
import { useStore } from "vuex";
import userService from "@/services/users";
import organizationService from "@/services/organizations";
import { b64DecodeUnicode, b64EncodeStandard, b64DecodeStandard } from "@/utils/formatters";
import { useLocalUserInfo } from "@/utils/storage";

import {
  trialPeriodAllowedPath,
  trialPaywallAllowedPath,
  isTrialExpired,
  getUserInfo,
  invalidateLoginData,
  getDecodedAccessToken,
  getDecodedUserInfo,
  getBasicAuth,
  getDueDays,
  routeGuard,
  verifyOrganizationStatus,
  generateTraceContext,
  checkCallBackValues,
} from "./auth";

// Buffer-based btoa for jsdom
global.btoa = (str: string) => Buffer.from(str, "binary").toString("base64");
global.atob = (str: string) => Buffer.from(str, "base64").toString("binary");

// Helper to build a mock store
function buildMockStore(overrides: Record<string, any> = {}) {
  const mockDispatch = vi.fn();
  return {
    state: {
      organizationData: {
        organizationSettings: { free_trial_expiry: "" },
        isDataIngested: false,
      },
      selectedOrganization: { identifier: "default" },
      zoConfig: { restricted_routes_on_empty_data: false },
      ...overrides.state,
    },
    dispatch: mockDispatch,
    _mockDispatch: mockDispatch,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  // Reset isCloud to default
  (config as any).isCloud = "false";
});

// ---------------------------------------------------------------------------
// trialPeriodAllowedPath
// ---------------------------------------------------------------------------

describe("isTrialExpired", () => {
  // getDueDays(null) is -20706, so a bare emptiness check misreads null as expired.
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["empty string", ""],
    ["zero", 0],
    ["zero string", "0"],
    ["NaN", NaN],
    ["non-numeric", "abc"],
  ])("treats %s as no trial tracked", (_label, expiry) => {
    expect(isTrialExpired(expiry)).toBe(false);
  });

  it("is true only for a past expiry", () => {
    expect(isTrialExpired((Date.now() - 30 * 24 * 60 * 60 * 1000) * 1000)).toBe(true);
    expect(isTrialExpired((Date.now() + 14 * 24 * 60 * 60 * 1000) * 1000)).toBe(false);
  });

  // getDueDays floors, so a trial ending later today scores 0 — the live boundary.
  it("treats the last day of a trial as expired", () => {
    expect(isTrialExpired((Date.now() + 6 * 60 * 60 * 1000) * 1000)).toBe(true);
    expect(isTrialExpired((Date.now() + 25 * 60 * 60 * 1000) * 1000)).toBe(false);
  });

  it("accepts the numeric string the API sends", () => {
    expect(isTrialExpired(String((Date.now() - 30 * 24 * 60 * 60 * 1000) * 1000))).toBe(true);
  });
});

describe("trialPeriodAllowedPath", () => {
  it("is an array with exactly 4 elements", () => {
    expect(Array.isArray(trialPeriodAllowedPath)).toBe(true);
    expect(trialPeriodAllowedPath).toHaveLength(4);
  });

  // The empty-data guard reads this list, so "general" must stay out of it.
  it("does not contain general", () => {
    expect(trialPeriodAllowedPath).not.toContain("general");
  });

  it("contains iam, users, organizations, invitations", () => {
    expect(trialPeriodAllowedPath).toContain("iam");
    expect(trialPeriodAllowedPath).toContain("users");
    expect(trialPeriodAllowedPath).toContain("organizations");
    expect(trialPeriodAllowedPath).toContain("invitations");
  });

  // The Danger Zone lives on /settings/general, so the paywall must let it through.
  it("trialPaywallAllowedPath adds the settings shell and general", () => {
    expect(trialPaywallAllowedPath).toContain("general");
    expect(trialPaywallAllowedPath).toContain("settings");
    trialPeriodAllowedPath.forEach((p) => expect(trialPaywallAllowedPath).toContain(p));
  });

  // The empty-data guard reads this list, so the shell must stay out of it.
  it("does not contain the settings shell in the empty-data list", () => {
    expect(trialPeriodAllowedPath).not.toContain("settings");
  });
});

// ---------------------------------------------------------------------------
// getUserInfo
// ---------------------------------------------------------------------------

describe("getUserInfo", () => {
  beforeEach(() => {
    vi.mocked(b64DecodeUnicode).mockReset();
    vi.mocked(b64EncodeStandard).mockReset();
    vi.mocked(useLocalUserInfo).mockReset();
  });

  it("returns null when login string has no id_token param", () => {
    const result = getUserInfo("?code=abc&state=xyz");
    expect(result).toBeNull();
  });

  it("parses JWT with 3 parts and returns the payload", () => {
    const fakePayload = { sub: "user-123", name: "Alice" };
    vi.mocked(b64DecodeUnicode).mockReturnValueOnce(JSON.stringify(fakePayload));
    vi.mocked(b64EncodeStandard).mockReturnValue("encoded-session");
    vi.mocked(useLocalUserInfo).mockReturnValue(undefined);

    const loginString = "?id_token=header.payload.signature";
    const result = getUserInfo(loginString);

    expect(result).not.toBeNull();
    expect(result.sub).toBe("user-123");
    expect(b64DecodeUnicode).toHaveBeenCalledTimes(1);
    expect(b64EncodeStandard).toHaveBeenCalled();
    expect(useLocalUserInfo).toHaveBeenCalled();
  });

  it("falls back to getDecodedAccessToken when token has fewer than 3 parts", () => {
    const decodedToken = { sub: "user-456" };
    vi.mocked(b64DecodeStandard).mockReturnValue(JSON.stringify(decodedToken));
    vi.mocked(b64EncodeStandard).mockReturnValue("encoded");
    vi.mocked(useLocalUserInfo).mockReturnValue(undefined);

    const loginString = "?id_token=onlyonepart";
    const result = getUserInfo(loginString);

    expect(result).toEqual(decodedToken);
    expect(b64DecodeStandard).toHaveBeenCalled();
  });

  it("returns null when JWT parsing throws an error", () => {
    // b64DecodeUnicode returns invalid JSON to trigger JSON.parse error
    vi.mocked(b64DecodeUnicode).mockReturnValue("{invalid json}");

    const loginString = "?id_token=header.payload.signature";
    const result = getUserInfo(loginString);

    expect(result).toBeNull();
  });

  it("logs and returns undefined when the whole function throws", () => {
    // Pass something that causes substring to throw
    const result = getUserInfo(null as any);

    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// invalidateLoginData
// ---------------------------------------------------------------------------

describe("invalidateLoginData", () => {
  it("calls userService.logout()", () => {
    invalidateLoginData();
    expect(userService.logout).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// getDecodedAccessToken
// ---------------------------------------------------------------------------

describe("getDecodedAccessToken", () => {
  beforeEach(() => {
    vi.mocked(b64DecodeStandard).mockReset();
  });

  it("returns parsed JSON when b64DecodeStandard returns a string", () => {
    const payload = { sub: "user-1", role: "admin" };
    vi.mocked(b64DecodeStandard).mockReturnValue(JSON.stringify(payload));

    const result = getDecodedAccessToken("header.payload.signature");

    expect(result).toEqual(payload);
    expect(b64DecodeStandard).toHaveBeenCalledWith("payload");
  });

  it("returns empty string when b64DecodeStandard returns non-string", () => {
    vi.mocked(b64DecodeStandard).mockReturnValue(undefined as any);

    const result = getDecodedAccessToken("header.payload.signature");

    expect(result).toBe("");
  });

  it("logs error and returns undefined when decoding throws", () => {
    vi.mocked(b64DecodeStandard).mockImplementation(() => {
      throw new Error("decode error");
    });

    const result = getDecodedAccessToken("bad.token");

    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getDecodedUserInfo
// ---------------------------------------------------------------------------

describe("getDecodedUserInfo", () => {
  beforeEach(() => {
    vi.mocked(useLocalUserInfo).mockReset();
    vi.mocked(b64DecodeStandard).mockReset();
  });

  it("returns decoded user info when localStorage has a value", () => {
    vi.mocked(useLocalUserInfo).mockReturnValue("encoded-data");
    vi.mocked(b64DecodeStandard).mockReturnValue('{"sub":"user-1"}');

    const result = getDecodedUserInfo();

    expect(result).toBe('{"sub":"user-1"}');
    expect(b64DecodeStandard).toHaveBeenCalledWith("encoded-data");
  });

  it("returns null when useLocalUserInfo returns null", () => {
    vi.mocked(useLocalUserInfo).mockReturnValue(null);

    const result = getDecodedUserInfo();

    expect(result).toBeNull();
  });

  it("logs error and returns undefined on exception", () => {
    vi.mocked(useLocalUserInfo).mockImplementation(() => {
      throw new Error("storage error");
    });

    const result = getDecodedUserInfo();

    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getBasicAuth
// ---------------------------------------------------------------------------

describe("getBasicAuth", () => {
  it("returns Basic auth header with base64 encoded credentials", () => {
    const result = getBasicAuth("user", "pass");
    const expected = "Basic " + global.btoa("user:pass");
    expect(result).toBe(expected);
  });

  it("starts with 'Basic '", () => {
    const result = getBasicAuth("admin", "secret");
    expect(result.startsWith("Basic ")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getDueDays
// ---------------------------------------------------------------------------

describe("getDueDays", () => {
  it("returns a positive number for a future timestamp", () => {
    const futureMicros = (Date.now() + 30 * 24 * 60 * 60 * 1000) * 1000; // 30 days ahead in microseconds
    const result = getDueDays(futureMicros);
    expect(result).toBeGreaterThan(0);
  });

  it("returns a negative number for a past timestamp", () => {
    const pastMicros = (Date.now() - 30 * 24 * 60 * 60 * 1000) * 1000; // 30 days ago in microseconds
    const result = getDueDays(pastMicros);
    expect(result).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// routeGuard
// ---------------------------------------------------------------------------

describe("routeGuard", () => {
  let mockStore: ReturnType<typeof buildMockStore>;
  const mockNext = vi.fn();

  beforeEach(() => {
    mockNext.mockReset();
    vi.mocked(organizationService.get_organization_summary).mockReset();
  });

  // Micros, 30 days past; ingested so the empty-data guard stays out of the way.
  const buildExpiredTrialStore = () =>
    buildMockStore({
      state: {
        organizationData: {
          organizationSettings: {
            free_trial_expiry: (Date.now() - 30 * 24 * 60 * 60 * 1000) * 1000,
          },
          isDataIngested: true,
        },
        selectedOrganization: { identifier: "my-org" },
        zoConfig: { restricted_routes_on_empty_data: false },
      },
    });

  describe("when isCloud is false", () => {
    it("calls next() directly without trial check", async () => {
      (config as any).isCloud = "false";
      mockStore = buildMockStore();
      vi.mocked(useStore).mockReturnValue(mockStore as any);

      await routeGuard({ name: "dashboard", path: "/dashboard" }, {}, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
    });
  });

  describe("when isCloud is true and trial is expired", () => {
    it("redirects to plans page when trial expired and route not in allowed list", async () => {
      (config as any).isCloud = "true";
      // Set expiry to past date (microseconds)
      const pastExpiry = (Date.now() - 30 * 24 * 60 * 60 * 1000) * 1000;
      mockStore = buildMockStore({
        state: {
          organizationData: {
            organizationSettings: { free_trial_expiry: pastExpiry },
            isDataIngested: true, // data ingested to avoid second guard
          },
          selectedOrganization: { identifier: "my-org" },
          zoConfig: { restricted_routes_on_empty_data: false },
        },
      });
      vi.mocked(useStore).mockReturnValue(mockStore as any);

      await routeGuard({ name: "dashboard", path: "/dashboard" }, {}, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ name: "plans" }));
    });

    // The nav resolves to name "settings", not "general"; paywalling it hides the feature.
    it("lets the nav settings shell through", async () => {
      (config as any).isCloud = "true";
      mockStore = buildExpiredTrialStore();
      vi.mocked(useStore).mockReturnValue(mockStore as any);

      await routeGuard({ name: "settings", path: "/settings" }, {}, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith();
    });

    // An expired trial must not lock an admin out of deleting the org.
    it("lets the general settings route through", async () => {
      (config as any).isCloud = "true";
      mockStore = buildExpiredTrialStore();
      vi.mocked(useStore).mockReturnValue(mockStore as any);

      await routeGuard({ name: "general", path: "/settings/general" }, {}, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith();
    });

    // Sibling settings sections are named explicitly: the shell is exempt, the paid tree is not.
    it.each([["logs"], ["dashboards"], ["cipherKeys"], ["organizationSettings"]])(
      "still redirects %s to plans",
      async (name) => {
        (config as any).isCloud = "true";
        mockStore = buildExpiredTrialStore();
        vi.mocked(useStore).mockReturnValue(mockStore as any);

        await routeGuard({ name, path: `/${name}` }, {}, mockNext);

        expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ name: "plans" }));
      },
    );
  });

  describe('when isCloud is the string "false" and trial is expired', () => {
    // isCloud is a string, so a truthiness check would fire on self-hosted too.
    it("does not redirect a self-hosted build to plans", async () => {
      (config as any).isCloud = "false";
      mockStore = buildExpiredTrialStore();
      vi.mocked(useStore).mockReturnValue(mockStore as any);

      await routeGuard({ name: "logs", path: "/logs" }, {}, mockNext);

      expect(mockNext).not.toHaveBeenCalledWith(expect.objectContaining({ name: "plans" }));
      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe("when isCloud is true and trial is not expired", () => {
    const buildLiveTrialStore = () =>
      buildMockStore({
        state: {
          organizationData: {
            organizationSettings: {
              free_trial_expiry: (Date.now() + 14 * 24 * 60 * 60 * 1000) * 1000,
            },
            isDataIngested: true,
          },
          selectedOrganization: { identifier: "my-org" },
          zoConfig: { restricted_routes_on_empty_data: false },
        },
      });

    it.each(["logs", "general", "dashboard"])("lets %s through", async (name) => {
      (config as any).isCloud = "true";
      mockStore = buildLiveTrialStore();
      vi.mocked(useStore).mockReturnValue(mockStore as any);

      await routeGuard({ name, path: `/${name}` }, {}, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  // A null expiry means no trial is tracked, so the paywall must not fire.
  it("does not redirect when free_trial_expiry is null", async () => {
    (config as any).isCloud = "true";
    mockStore = buildMockStore({
      state: {
        organizationData: {
          organizationSettings: { free_trial_expiry: null },
          isDataIngested: true,
        },
        selectedOrganization: { identifier: "my-org" },
        zoConfig: { restricted_routes_on_empty_data: false },
      },
    });
    vi.mocked(useStore).mockReturnValue(mockStore as any);

    await routeGuard({ name: "logs", path: "/logs" }, {}, mockNext);

    expect(mockNext).not.toHaveBeenCalledWith(expect.objectContaining({ name: "plans" }));
    expect(mockNext).toHaveBeenCalledWith();
  });

  describe("restricted_routes_on_empty_data guard", () => {
    const buildNoDataStore = () =>
      buildMockStore({
        state: {
          organizationData: {
            organizationSettings: { free_trial_expiry: "" },
            isDataIngested: false,
          },
          selectedOrganization: { identifier: "default" },
          zoConfig: { restricted_routes_on_empty_data: true },
        },
      });

    // emptyDataAllowedPaths is what exempts /settings/general here, not the name list.
    it("lets /settings/general through on a no-data org", async () => {
      (config as any).isCloud = "false";
      vi.mocked(organizationService.get_organization_summary).mockResolvedValue({
        data: { streams: { num_streams: 0 } },
      });
      mockStore = buildNoDataStore();
      vi.mocked(useStore).mockReturnValue(mockStore as any);

      await routeGuard({ name: "general", path: "/settings/general" }, {}, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(mockNext).not.toHaveBeenCalledWith({ path: "/ingestion" });
    });

    // Same name, uncovered path: fails if the name list ever does the exempting.
    it("does not exempt a general-named route at an uncovered path", async () => {
      (config as any).isCloud = "false";
      vi.mocked(organizationService.get_organization_summary).mockResolvedValue({
        data: { streams: { num_streams: 0 } },
      });
      mockStore = buildNoDataStore();
      vi.mocked(useStore).mockReturnValue(mockStore as any);

      await routeGuard({ name: "general", path: "/settings/organization/general" }, {}, mockNext);

      expect(mockNext).toHaveBeenCalledWith({ path: "/ingestion" });
    });

    it("redirects to /ingestion when num_streams is 0", async () => {
      (config as any).isCloud = "false";
      vi.mocked(organizationService.get_organization_summary).mockResolvedValue({
        data: { streams: { num_streams: 0 } },
      });
      mockStore = buildMockStore({
        state: {
          organizationData: {
            organizationSettings: { free_trial_expiry: "" },
            isDataIngested: false,
          },
          selectedOrganization: { identifier: "default" },
          zoConfig: { restricted_routes_on_empty_data: true },
        },
      });
      vi.mocked(useStore).mockReturnValue(mockStore as any);

      await routeGuard({ name: "logs", path: "/logs" }, {}, mockNext);

      expect(mockStore._mockDispatch).toHaveBeenCalledWith("setIsDataIngested", false);
      expect(mockNext).toHaveBeenCalledWith({ path: "/ingestion" });
    });

    it("dispatches setIsDataIngested(true) and calls next() when num_streams > 0", async () => {
      (config as any).isCloud = "false";
      vi.mocked(organizationService.get_organization_summary).mockResolvedValue({
        data: { streams: { num_streams: 5 } },
      });
      mockStore = buildMockStore({
        state: {
          organizationData: {
            organizationSettings: { free_trial_expiry: "" },
            isDataIngested: false,
          },
          selectedOrganization: { identifier: "default" },
          zoConfig: { restricted_routes_on_empty_data: true },
        },
      });
      vi.mocked(useStore).mockReturnValue(mockStore as any);

      await routeGuard({ name: "logs", path: "/logs" }, {}, mockNext);

      expect(mockStore._mockDispatch).toHaveBeenCalledWith("setIsDataIngested", true);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it("logs warning, dispatches setIsDataIngested(true) and calls next() when API throws", async () => {
      (config as any).isCloud = "false";
      vi.mocked(organizationService.get_organization_summary).mockRejectedValue(
        new Error("Network error"),
      );
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockStore = buildMockStore({
        state: {
          organizationData: {
            organizationSettings: { free_trial_expiry: "" },
            isDataIngested: false,
          },
          selectedOrganization: { identifier: "default" },
          zoConfig: { restricted_routes_on_empty_data: true },
        },
      });
      vi.mocked(useStore).mockReturnValue(mockStore as any);

      await routeGuard({ name: "logs", path: "/logs" }, {}, mockNext);

      expect(warnSpy).toHaveBeenCalled();
      expect(mockStore._mockDispatch).toHaveBeenCalledWith("setIsDataIngested", true);
      expect(mockNext).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    it("calls next() directly for /ingestion path", async () => {
      (config as any).isCloud = "false";
      mockStore = buildMockStore({
        state: {
          organizationData: {
            organizationSettings: { free_trial_expiry: "" },
            isDataIngested: false,
          },
          selectedOrganization: { identifier: "default" },
          zoConfig: { restricted_routes_on_empty_data: true },
        },
      });
      vi.mocked(useStore).mockReturnValue(mockStore as any);

      await routeGuard({ name: "ingestion", path: "/ingestion" }, {}, mockNext);

      expect(organizationService.get_organization_summary).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it("calls next() directly for /iam path", async () => {
      (config as any).isCloud = "false";
      mockStore = buildMockStore({
        state: {
          organizationData: {
            organizationSettings: { free_trial_expiry: "" },
            isDataIngested: false,
          },
          selectedOrganization: { identifier: "default" },
          zoConfig: { restricted_routes_on_empty_data: true },
        },
      });
      vi.mocked(useStore).mockReturnValue(mockStore as any);

      await routeGuard({ name: "iam", path: "/iam" }, {}, mockNext);

      expect(organizationService.get_organization_summary).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    const buildEmptyDataStore = () =>
      buildMockStore({
        state: {
          organizationData: {
            organizationSettings: { free_trial_expiry: "" },
            isDataIngested: false,
          },
          selectedOrganization: { identifier: "default" },
          zoConfig: { restricted_routes_on_empty_data: true },
        },
      });

    // /settings/general hosts the Danger Zone, and an org with nothing ingested is
    // the one an admin is most likely to delete — bouncing to /ingestion would
    // leave no way to. "/settings" is the nav's landing path before it redirects
    // to general, so it has to survive the guard too.
    it.each([
      ["settings landing", "settings", "/settings"],
      ["general settings", "general", "/settings/general"],
      ["general settings, trailing slash", "general", "/settings/general/"],
    ])("calls next() directly for %s", async (_label, name, path) => {
      (config as any).isCloud = "false";
      vi.mocked(organizationService.get_organization_summary).mockResolvedValue({
        data: { streams: { num_streams: 0 } },
      });
      mockStore = buildEmptyDataStore();
      vi.mocked(useStore).mockReturnValue(mockStore as any);

      await routeGuard({ name, path }, {}, mockNext);

      expect(organizationService.get_organization_summary).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).not.toHaveBeenCalledWith({ path: "/ingestion" });
    });

    // The exemption is deliberately only the two paths above — the rest of the
    // Settings tree shows no ingested data either, but it is not needed to escape
    // an empty org, so it stays behind the ingestion redirect.
    it.each([
      ["organizationSettings", "/settings/organization"],
      ["license", "/settings/license"],
      ["cipherKeys", "/settings/cipher_keys"],
    ])("still redirects %s to /ingestion", async (name, path) => {
      (config as any).isCloud = "false";
      vi.mocked(organizationService.get_organization_summary).mockResolvedValue({
        data: { streams: { num_streams: 0 } },
      });
      mockStore = buildEmptyDataStore();
      vi.mocked(useStore).mockReturnValue(mockStore as any);

      await routeGuard({ name, path }, {}, mockNext);

      expect(mockNext).toHaveBeenCalledWith({ path: "/ingestion" });
    });

    // I14: on-call is configured BEFORE any data flows — teams, schedules and
    // routing are exactly what a fresh org sets up first. Bouncing those clicks
    // to /ingestion made every on-call screen unreachable by navigation (a
    // direct URL worked only because a cold load races zoConfig). The whole
    // subtree is exempt, including the dynamic-segment routes the exact-match
    // list cannot express.
    it.each([
      ["triage list", "onCallResponses", "/oncall/responses"],
      ["team list", "onCallTeams", "/oncall/teams"],
      ["team detail with params", "onCallTeamDetail", "/oncall/teams/team_1/schedule"],
      ["org routing", "onCallRouting", "/oncall/routing"],
      ["trailing slash", "onCallTeams", "/oncall/teams/"],
    ])("calls next() directly for on-call %s", async (_label, name, path) => {
      (config as any).isCloud = "false";
      vi.mocked(organizationService.get_organization_summary).mockResolvedValue({
        data: { streams: { num_streams: 0 } },
      });
      mockStore = buildEmptyDataStore();
      vi.mocked(useStore).mockReturnValue(mockStore as any);

      await routeGuard({ name, path }, {}, mockNext);

      expect(organizationService.get_organization_summary).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).not.toHaveBeenCalledWith({ path: "/ingestion" });
    });

    // The prefix is a path SEGMENT, not a substring — a route that merely
    // starts with the same letters must not inherit the exemption.
    it("still redirects a near-miss path that only shares the prefix's letters", async () => {
      (config as any).isCloud = "false";
      vi.mocked(organizationService.get_organization_summary).mockResolvedValue({
        data: { streams: { num_streams: 0 } },
      });
      mockStore = buildEmptyDataStore();
      vi.mocked(useStore).mockReturnValue(mockStore as any);

      await routeGuard({ name: "oncallish", path: "/oncallish" }, {}, mockNext);

      expect(mockNext).toHaveBeenCalledWith({ path: "/ingestion" });
    });
  });
});

// ---------------------------------------------------------------------------
// verifyOrganizationStatus
// ---------------------------------------------------------------------------

describe("verifyOrganizationStatus", () => {
  it("is a no-op function that does not throw", () => {
    expect(() => verifyOrganizationStatus({}, {})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// generateTraceContext
// ---------------------------------------------------------------------------

describe("generateTraceContext", () => {
  it("returns traceparent, traceId, and spanId", () => {
    const result = generateTraceContext();

    expect(result).toHaveProperty("traceparent");
    expect(result).toHaveProperty("traceId");
    expect(result).toHaveProperty("spanId");
  });

  it("traceparent matches the format 00-<32hex>-<16hex>-01", () => {
    const result = generateTraceContext();
    // traceparent: "00-{traceId}-{spanId}-01"
    expect(result.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/i);
  });

  it("traceId has no dashes and is 32 hex chars", () => {
    const result = generateTraceContext();
    expect(result.traceId).toMatch(/^[0-9a-f]{32}$/i);
  });

  it("spanId has no dashes and is 16 hex chars", () => {
    const result = generateTraceContext();
    expect(result.spanId).toHaveLength(16);
  });
});

// ---------------------------------------------------------------------------
// checkCallBackValues
// ---------------------------------------------------------------------------

describe("checkCallBackValues", () => {
  it("returns the value for a found key", () => {
    const url = "code=abc123&state=xyz&session=sess1";
    expect(checkCallBackValues(url, "code")).toBe("abc123");
    expect(checkCallBackValues(url, "state")).toBe("xyz");
  });

  it("returns undefined when key is not found", () => {
    const url = "code=abc123&state=xyz";
    expect(checkCallBackValues(url, "missing")).toBeUndefined();
  });

  it("returns undefined for empty url", () => {
    expect(checkCallBackValues("", "key")).toBeUndefined();
  });
});
