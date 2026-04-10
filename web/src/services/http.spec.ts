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

// All vi.mock() calls must be at top — Vitest hoists them before any import

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

// Quasar Notify is used inside http.ts — stub it to prevent errors
vi.mock("quasar", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    Notify: { create: vi.fn() },
    useQuasar: () => ({ notify: vi.fn(), dialog: vi.fn() }),
  };
});

import config from "../aws-exports";
import store from "../stores";
import axios from "axios";
import { attemptTokenRefresh } from "./http";

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
    await expect(
      attemptTokenRefresh("http://localhost:5080/config/dex_login"),
    ).rejects.toThrow();

    expect(store.dispatch).not.toHaveBeenCalled();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("should reject immediately for dex_refresh URL", async () => {
    await expect(
      attemptTokenRefresh("http://localhost:5080/config/dex_refresh"),
    ).rejects.toThrow();

    expect(store.dispatch).not.toHaveBeenCalled();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("should reject immediately for auth/login URL", async () => {
    await expect(
      attemptTokenRefresh("http://localhost:5080/auth/login"),
    ).rejects.toThrow();

    expect(store.dispatch).not.toHaveBeenCalled();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Cloud environment — direct logout, no SSO refresh
  // ---------------------------------------------------------------------------

  it("should dispatch logout and reject for cloud environment", async () => {
    (config as any).isCloud = "true";

    await expect(
      attemptTokenRefresh("http://localhost:5080/api/org/_search"),
    ).rejects.toThrow();

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

    await expect(
      attemptTokenRefresh("http://localhost:5080/api/org/_search"),
    ).rejects.toThrow();

    expect(vi.mocked(store.dispatch)).toHaveBeenCalledWith("logout");
    expect(reloadMock).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Neither cloud nor enterprise SSO — standard logout
  // ---------------------------------------------------------------------------

  it("should dispatch logout and reject when neither cloud nor enterprise SSO", async () => {
    // Both flags are already "false" from beforeEach
    await expect(
      attemptTokenRefresh("http://localhost:5080/api/org/_search"),
    ).rejects.toThrow();

    expect(vi.mocked(store.dispatch)).toHaveBeenCalledWith("logout");
    expect(reloadMock).toHaveBeenCalled();
  });
});
