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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

// All vi.mock() / vi.unmock() calls must be at top — Vitest hoists them before any import

// The global test setup in __mocks__/http.ts registers a vi.mock for "@/services/http.ts"
// that only exports `default`. This spec tests the real implementation, so we unmock it
// here so the actual module (with its named exports) is used instead.
vi.unmock("@/services/http.ts");

vi.mock("../stores", () => ({
  default: {
    state: {
      API_ENDPOINT: "http://localhost:5080",
      zoConfig: { sso_enabled: false },
    },
    dispatch: vi.fn(),
  },
}));

vi.mock("../aws-exports", () => ({
  default: {
    isCloud: "false",
    isEnterprise: "false",
  },
}));

vi.mock("@/utils/zincutils", () => ({
  useLocalCurrentUser: vi.fn(),
  useLocalUserInfo: vi.fn(),
}));

vi.mock("axios");

const { addUnauthorizedError } = vi.hoisted(() => ({ addUnauthorizedError: vi.fn() }));
vi.mock("@/composables/useUnauthorizedErrorGrouper", () => ({ addUnauthorizedError }));

import config from "../aws-exports";
import store from "../stores";
import axios from "axios";
import http, { attemptTokenRefresh, refreshSession } from "./http";
import { clearSessionStorageExcept } from "@/utils/clearSessionStorage";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal axios instance mock with a controllable .get() spy. */
function buildAxiosMock(getImpl: () => Promise<any>) {
  const mockInstance = { get: vi.fn().mockImplementation(getImpl) };
  vi.mocked(axios.create).mockReturnValue(mockInstance as any);
  return mockInstance;
}

describe("attemptTokenRefresh", () => {
  let reloadMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset mutable config properties before every test
    (config as any).isCloud = "false";
    (config as any).isEnterprise = "false";
    (store.state as any).zoConfig.sso_enabled = false;

    // Spy on window.location.reload without touching read-only location
    reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: reloadMock },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Auth-endpoint guard — no logout should occur
  // ---------------------------------------------------------------------------

  it("should reject immediately for dex_login URL", async () => {
    await expect(attemptTokenRefresh("http://localhost:5080/config/dex_login")).rejects.toThrow();

    expect(store.dispatch).not.toHaveBeenCalled();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("should reject immediately for dex_refresh URL", async () => {
    await expect(attemptTokenRefresh("http://localhost:5080/config/dex_refresh")).rejects.toThrow();

    expect(store.dispatch).not.toHaveBeenCalled();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("should reject immediately for auth/login URL", async () => {
    await expect(attemptTokenRefresh("http://localhost:5080/auth/login")).rejects.toThrow();

    expect(store.dispatch).not.toHaveBeenCalled();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Cloud environment — direct logout, no SSO refresh
  // ---------------------------------------------------------------------------

  it("should dispatch logout and reject for cloud environment", async () => {
    (config as any).isCloud = "true";

    await expect(attemptTokenRefresh("http://localhost:5080/api/org/_search")).rejects.toThrow();

    expect(vi.mocked(store.dispatch)).toHaveBeenCalledWith("logout");
    expect(reloadMock).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Enterprise SSO — happy path
  // ---------------------------------------------------------------------------

  it("should call dex_refresh and resolve for enterprise SSO", async () => {
    (config as any).isEnterprise = "true";
    (store.state as any).zoConfig.sso_enabled = true;

    buildAxiosMock(() => Promise.resolve({ status: 200 }));

    await expect(
      attemptTokenRefresh("http://localhost:5080/api/org/_search"),
    ).resolves.toBeUndefined();

    expect(vi.mocked(store.dispatch)).not.toHaveBeenCalled();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Enterprise SSO — dex_refresh fails → logout then reject
  // ---------------------------------------------------------------------------

  it("should call logout and reject when dex_refresh fails", async () => {
    (config as any).isEnterprise = "true";
    (store.state as any).zoConfig.sso_enabled = true;

    // First call (.get("/config/dex_refresh")) rejects;
    // second call (.get("/config/logout")) resolves.
    const mockInstance = {
      get: vi
        .fn()
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({ status: 200 }),
    };
    vi.mocked(axios.create).mockReturnValue(mockInstance as any);

    await expect(attemptTokenRefresh("http://localhost:5080/api/org/_search")).rejects.toThrow();

    expect(vi.mocked(store.dispatch)).toHaveBeenCalledWith("logout");
    expect(reloadMock).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Neither cloud nor enterprise SSO — standard logout
  // ---------------------------------------------------------------------------

  it("should dispatch logout and reject when neither cloud nor enterprise SSO", async () => {
    // Both flags are already "false" from beforeEach
    await expect(attemptTokenRefresh("http://localhost:5080/api/org/_search")).rejects.toThrow();

    expect(vi.mocked(store.dispatch)).toHaveBeenCalledWith("logout");
    expect(reloadMock).toHaveBeenCalled();
  });
});

describe("http 403 interceptor", () => {
  /** Builds an instance and returns the rejection handler it registered. */
  const errorHandler = () => {
    let onError: (error: any) => Promise<unknown> = () => Promise.resolve();
    vi.mocked(axios.create).mockReturnValue({
      interceptors: {
        response: {
          use: (_ok: unknown, err: (error: any) => Promise<unknown>) => {
            onError = err;
          },
        },
      },
    } as any);
    http();
    return onError;
  };

  const forbidden = (config: Record<string, unknown> = {}) => ({
    response: { status: 403, data: {} },
    request: { responseURL: "http://localhost:5080/api/v2/org/folders/alerts" },
    config: { url: "/api/v2/org/folders/alerts", ...config },
  });

  beforeEach(() => {
    (config as any).isEnterprise = "true";
    (config as any).isCloud = "false";
  });

  afterEach(() => {
    vi.clearAllMocks();
    (config as any).isEnterprise = "false";
  });

  it("adds a 403 to the Access Required toast", async () => {
    const error = forbidden();
    await expect(errorHandler()(error)).rejects.toBe(error);
    expect(addUnauthorizedError).toHaveBeenCalledWith(
      "http://localhost:5080/api/v2/org/folders/alerts",
    );
  });

  it("leaves a 403 out of the toast when the request opts out, and still rejects", async () => {
    const error = forbidden({ skipAccessToast: true });
    await expect(errorHandler()(error)).rejects.toBe(error);
    expect(addUnauthorizedError).not.toHaveBeenCalled();
  });
});

describe("403 handling", () => {
  let onRejected: (error: any) => Promise<any>;
  const forbidden = (requestConfig: Record<string, unknown>) => ({
    response: { status: 403, data: {} },
    request: { responseURL: "http://localhost:5080/api/acme/x" },
    config: { url: "/api/acme/x", ...requestConfig },
  });

  beforeEach(() => {
    addUnauthorizedError.mockClear();
    vi.mocked(axios.create).mockReturnValue({
      interceptors: {
        response: { use: (_ok: unknown, rejected: typeof onRejected) => (onRejected = rejected) },
      },
    } as any);
    http();
  });

  afterEach(() => {
    (config as any).isCloud = "false";
    (config as any).isEnterprise = "false";
  });

  it.each([
    ["enterprise", "isEnterprise"],
    ["cloud", "isCloud"],
  ])(
    "on %s, toasts an unflagged 403 and stays silent on a silentForbidden one",
    async (_, flag) => {
      (config as any)[flag] = "true";

      await expect(onRejected(forbidden({}))).rejects.toBeDefined();
      expect(addUnauthorizedError).toHaveBeenCalledWith("http://localhost:5080/api/acme/x");

      addUnauthorizedError.mockClear();
      const silent = forbidden({ silentForbidden: true });
      await expect(onRejected(silent)).rejects.toBe(silent);
      expect(addUnauthorizedError).not.toHaveBeenCalled();
    },
  );
});

describe("401 handling", () => {
  let onRejected: (error: any) => Promise<any>;
  const instance = {
    interceptors: {
      response: { use: (_ok: unknown, rejected: typeof onRejected) => (onRejected = rejected) },
    },
    get: vi.fn(),
    request: vi.fn(),
  };
  const unauthorized = (extra: Record<string, unknown> = {}) => ({
    response: { status: 401, data: {} },
    request: { responseURL: "http://localhost:5080/api/acme/ai/capabilities" },
    config: { url: "/api/acme/ai/capabilities", assistantManaged: true, ...extra },
  });

  beforeEach(() => {
    vi.mocked(store.dispatch).mockClear();
    instance.get.mockReset().mockResolvedValue({ status: 200 });
    instance.request.mockReset().mockResolvedValue({ data: { can_chat: true } });
    vi.mocked(axios.create).mockReturnValue(instance as any);
    http();
  });

  afterEach(() => {
    (config as any).isEnterprise = "false";
    (store.state as any).zoConfig.sso_enabled = false;
  });

  it("refreshes the SSO token and retries an assistant request once, without logging out", async () => {
    (config as any).isEnterprise = "true";
    (store.state as any).zoConfig.sso_enabled = true;
    await expect(onRejected(unauthorized())).resolves.toEqual({ data: { can_chat: true } });
    expect(instance.get).toHaveBeenCalledWith("/config/dex_refresh");
    expect(instance.request).toHaveBeenCalledWith(
      expect.objectContaining({ url: "/api/acme/ai/capabilities", assistantRetried: true }),
    );
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it("hands a failed SSO refresh and a second 401 back to the assistant caller", async () => {
    (config as any).isEnterprise = "true";
    (store.state as any).zoConfig.sso_enabled = true;
    instance.get.mockRejectedValueOnce(new Error("refresh failed"));
    const failed = unauthorized();
    await expect(onRejected(failed)).rejects.toBe(failed);
    const retried = unauthorized({ assistantRetried: true });
    await expect(onRejected(retried)).rejects.toBe(retried);
    expect(instance.get).toHaveBeenCalledTimes(1);
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it("rejects with the retry's own error when the refresh worked but the retry failed", async () => {
    (config as any).isEnterprise = "true";
    (store.state as any).zoConfig.sso_enabled = true;
    const retryError = { response: { status: 403, data: {} }, config: {} };
    instance.request.mockRejectedValueOnce(retryError);
    const first = unauthorized();
    await expect(onRejected(first)).rejects.toBe(retryError);
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it("sends one dex_refresh for concurrent assistant and normal 401s", async () => {
    (config as any).isEnterprise = "true";
    (store.state as any).zoConfig.sso_enabled = true;
    let finish!: (res: { status: number }) => void;
    instance.get.mockReturnValueOnce(new Promise((r) => (finish = r)));
    const capabilities = onRejected(unauthorized());
    const probe = onRejected(unauthorized({ url: "/api/acme/ai/chats/x/cancel" }));
    const normal = attemptTokenRefresh("/api/acme/streams");
    finish({ status: 200 });
    await Promise.all([capabilities, probe, normal]);
    expect(instance.get.mock.calls.filter(([url]) => url === "/config/dex_refresh")).toHaveLength(
      1,
    );
    expect(instance.request).toHaveBeenCalledTimes(2);
  });

  it("logs out only the normal caller when an assistant-started refresh fails", async () => {
    (config as any).isEnterprise = "true";
    (store.state as any).zoConfig.sso_enabled = true;
    let fail!: (err: Error) => void;
    instance.get.mockReturnValueOnce(new Promise((_r, reject) => (fail = reject)));
    const failed = unauthorized();
    const assistantCall = onRejected(failed);
    const normal = attemptTokenRefresh("/api/acme/streams");
    fail(new Error("refresh token rotated"));
    await expect(assistantCall).rejects.toBe(failed);
    await expect(normal).rejects.toThrow("Refresh failed");
    expect(instance.get.mock.calls.filter(([url]) => url === "/config/dex_refresh")).toHaveLength(
      1,
    );
    expect(store.dispatch).toHaveBeenCalledTimes(1);
    expect(store.dispatch).toHaveBeenCalledWith("logout");
  });

  it("hands an assistant-managed 401 back to the caller without logging out", async () => {
    const error = {
      response: { status: 401, data: {} },
      request: { responseURL: "http://localhost:5080/api/acme/ai/capabilities" },
      config: { url: "/api/acme/ai/capabilities", assistantManaged: true },
    };
    await expect(onRejected(error)).rejects.toBe(error);
    expect(store.dispatch).not.toHaveBeenCalled();
  });
});

describe("refreshSession (round 1 E-01)", () => {
  let reloadMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (config as any).isCloud = "false";
    (config as any).isEnterprise = "false";
    (store.state as any).zoConfig.sso_enabled = false;
    vi.mocked(store.dispatch).mockClear();
    reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: reloadMock },
      writable: true,
      configurable: true,
    });
    sessionStorage.setItem("o2.assistant.draft:k1:s1", "draft");
    sessionStorage.setItem("other", "x");
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  const untouched = () => {
    expect(store.dispatch).not.toHaveBeenCalled();
    expect(reloadMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("other")).toBe("x");
  };

  it("answers expired at once on Cloud, without the logout attemptTokenRefresh does", async () => {
    (config as any).isCloud = "true";
    const instance = buildAxiosMock(() => Promise.resolve({ status: 200 }));
    await expect(refreshSession()).resolves.toBe("expired");
    expect(instance.get).not.toHaveBeenCalled();
    untouched();
  });

  it("answers expired at once without SSO", async () => {
    (config as any).isEnterprise = "true";
    await expect(refreshSession()).resolves.toBe("expired");
    untouched();
  });

  it("refreshes through dex_refresh on SSO", async () => {
    (config as any).isEnterprise = "true";
    (store.state as any).zoConfig.sso_enabled = true;
    const instance = buildAxiosMock(() => Promise.resolve({ status: 200 }));
    await expect(refreshSession()).resolves.toBe("refreshed");
    expect(instance.get).toHaveBeenCalledWith("/config/dex_refresh");
    untouched();
  });

  it("answers expired on a failed SSO refresh and never calls /config/logout", async () => {
    (config as any).isEnterprise = "true";
    (store.state as any).zoConfig.sso_enabled = true;
    const instance = buildAxiosMock(() => Promise.reject(new Error("rotated")));
    await expect(refreshSession()).resolves.toBe("expired");
    expect(instance.get).not.toHaveBeenCalledWith("/config/logout");
    untouched();
  });

  it("shares the refresh attemptTokenRefresh already started", async () => {
    (config as any).isEnterprise = "true";
    (store.state as any).zoConfig.sso_enabled = true;
    let finish!: (res: { status: number }) => void;
    const instance = buildAxiosMock(() => new Promise((r) => (finish = r)));
    const normal = attemptTokenRefresh("/api/acme/streams");
    const assistant = refreshSession();
    finish({ status: 200 });
    await expect(Promise.all([normal, assistant])).resolves.toEqual([undefined, "refreshed"]);
    expect(instance.get.mock.calls.filter(([url]) => url === "/config/dex_refresh")).toHaveLength(
      1,
    );
  });
});

describe("clearSessionStorageExcept", () => {
  afterEach(() => sessionStorage.clear());

  it("keeps the assistant drafts and removes everything else", () => {
    sessionStorage.setItem("o2.assistant.draft:k1:s1", "a");
    sessionStorage.setItem("o2.assistant.draft:k2:s2", "b");
    sessionStorage.setItem("o2.assistant.tab:k1", "t");
    sessionStorage.setItem("searchState", "s");
    clearSessionStorageExcept(/^o2\.assistant\.draft:/);
    expect(Object.keys(sessionStorage).sort()).toEqual([
      "o2.assistant.draft:k1:s1",
      "o2.assistant.draft:k2:s2",
    ]);
  });

  it("does nothing when storage is blocked", () => {
    const spy = vi.spyOn(Storage.prototype, "key").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    sessionStorage.setItem("a", "1");
    expect(() => clearSessionStorageExcept(/^x/)).not.toThrow();
    spy.mockRestore();
  });

  it("keeps drafts when a non-assistant 401 still logs out (the logout path stays)", async () => {
    (config as any).isCloud = "false";
    (config as any).isEnterprise = "false";
    (store.state as any).zoConfig.sso_enabled = false;
    sessionStorage.setItem("o2.assistant.draft:k1:s1", "a");
    sessionStorage.setItem("searchState", "s");
    const reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: reloadMock },
      writable: true,
      configurable: true,
    });
    await expect(attemptTokenRefresh("/api/acme/streams")).rejects.toThrow();
    expect(store.dispatch).toHaveBeenCalledWith("logout");
    expect(reloadMock).toHaveBeenCalled();
    expect(Object.keys(sessionStorage)).toEqual(["o2.assistant.draft:k1:s1"]);
  });
});
