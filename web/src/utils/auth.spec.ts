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
    get_organization_summary: vi
      .fn()
      .mockResolvedValue({ data: { streams: { num_streams: 5 } } }),
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
    compact
      ? "0123456789ab7def8123456789abcdef"
      : "01234567-89ab-7def-8123-456789abcdef",
  ),
}));

// Imports AFTER mocks
import config from "../aws-exports";
import { useStore } from "vuex";
import userService from "@/services/users";
import organizationService from "@/services/organizations";
import {
  b64DecodeUnicode,
  b64EncodeStandard,
  b64DecodeStandard,
} from "@/utils/formatters";
import { useLocalUserInfo } from "@/utils/storage";
import { getUUID, getUUIDv7 } from "@/utils/uuid";

import {
  trialPeriodAllowedPath,
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

describe("trialPeriodAllowedPath", () => {
  it("is an array with exactly 4 elements", () => {
    expect(Array.isArray(trialPeriodAllowedPath)).toBe(true);
    expect(trialPeriodAllowedPath).toHaveLength(4);
  });

  it("contains iam, users, organizations, invitations", () => {
    expect(trialPeriodAllowedPath).toContain("iam");
    expect(trialPeriodAllowedPath).toContain("users");
    expect(trialPeriodAllowedPath).toContain("organizations");
    expect(trialPeriodAllowedPath).toContain("invitations");
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
    const futureMicros =
      (Date.now() + 30 * 24 * 60 * 60 * 1000) * 1000; // 30 days ahead in microseconds
    const result = getDueDays(futureMicros);
    expect(result).toBeGreaterThan(0);
  });

  it("returns a negative number for a past timestamp", () => {
    const pastMicros =
      (Date.now() - 30 * 24 * 60 * 60 * 1000) * 1000; // 30 days ago in microseconds
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

  describe("when isCloud is false", () => {
    it("calls next() directly without trial check", async () => {
      (config as any).isCloud = "false";
      mockStore = buildMockStore();
      vi.mocked(useStore).mockReturnValue(mockStore as any);

      await routeGuard(
        { name: "dashboard", path: "/dashboard" },
        {},
        mockNext,
      );

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

      await routeGuard(
        { name: "dashboard", path: "/dashboard" },
        {},
        mockNext,
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ name: "plans" }),
      );
    });
  });

  describe("restricted_routes_on_empty_data guard", () => {
    it("redirects to /ingestion when num_streams is 0", async () => {
      (config as any).isCloud = "false";
      vi.mocked(organizationService.get_organization_summary).mockResolvedValue(
        { data: { streams: { num_streams: 0 } } },
      );
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

      await routeGuard(
        { name: "logs", path: "/logs" },
        {},
        mockNext,
      );

      expect(mockStore._mockDispatch).toHaveBeenCalledWith(
        "setIsDataIngested",
        false,
      );
      expect(mockNext).toHaveBeenCalledWith({ path: "/ingestion" });
    });

    it("dispatches setIsDataIngested(true) and calls next() when num_streams > 0", async () => {
      (config as any).isCloud = "false";
      vi.mocked(organizationService.get_organization_summary).mockResolvedValue(
        { data: { streams: { num_streams: 5 } } },
      );
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

      await routeGuard(
        { name: "logs", path: "/logs" },
        {},
        mockNext,
      );

      expect(mockStore._mockDispatch).toHaveBeenCalledWith(
        "setIsDataIngested",
        true,
      );
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

      await routeGuard(
        { name: "logs", path: "/logs" },
        {},
        mockNext,
      );

      expect(warnSpy).toHaveBeenCalled();
      expect(mockStore._mockDispatch).toHaveBeenCalledWith(
        "setIsDataIngested",
        true,
      );
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

      await routeGuard(
        { name: "ingestion", path: "/ingestion" },
        {},
        mockNext,
      );

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

      await routeGuard(
        { name: "iam", path: "/iam" },
        {},
        mockNext,
      );

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
      vi.mocked(organizationService.get_organization_summary).mockResolvedValue(
        { data: { streams: { num_streams: 0 } } },
      );
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
      vi.mocked(organizationService.get_organization_summary).mockResolvedValue(
        { data: { streams: { num_streams: 0 } } },
      );
      mockStore = buildEmptyDataStore();
      vi.mocked(useStore).mockReturnValue(mockStore as any);

      await routeGuard({ name, path }, {}, mockNext);

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
    expect(result.traceparent).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/i,
    );
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
