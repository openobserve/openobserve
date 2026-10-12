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

vi.mock("@/services/settings", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { getSetting: vi.fn(), setUserSetting: vi.fn() },
  });
});

import settings from "@/services/settings";
import { queryClient } from "@/composables/query/queryClient";
import { settingKeys } from "@/services/settings.querykeys";
import {
  READY_MADE_SETTING_KEY,
  readReadyMadeSettings,
  resetReadyMadeSessionMemory,
  saveReadyMadeStates,
} from "./readyMadeSettings";

const ORG = "org1";
const USER = "me@example.com";
const getSetting = settings.getSetting as unknown as ReturnType<typeof vi.fn>;
const setUserSetting = settings.setUserSetting as unknown as ReturnType<typeof vi.fn>;

const stored = (sources: Record<string, unknown>) => ({
  data: { setting_value: { version: 1, sources } },
});
const notFound = () => Object.assign(new Error("404"), { response: { status: 404 } });

describe("ready-made settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetReadyMadeSessionMemory();
    queryClient.clear();
  });

  describe("read", () => {
    it("reads the user-scoped key", async () => {
      getSetting.mockResolvedValue(stored({ redis: { state: "dismissed", at: "t" } }));
      const value = await readReadyMadeSettings(ORG, USER);
      expect(getSetting).toHaveBeenCalledWith(ORG, READY_MADE_SETTING_KEY, USER);
      expect(value).toEqual({ version: 1, sources: { redis: { state: "dismissed", at: "t" } } });
    });

    it("treats a 404 as empty memory", async () => {
      getSetting.mockRejectedValue(notFound());
      expect(await readReadyMadeSettings(ORG, USER)).toEqual({ version: 1, sources: {} });
    });

    it("throws on any other read failure so the caller shows no banner", async () => {
      getSetting.mockRejectedValue(Object.assign(new Error("boom"), { response: { status: 500 } }));
      await expect(readReadyMadeSettings(ORG, USER)).rejects.toThrow("boom");
    });

    it("drops malformed entries", async () => {
      getSetting.mockResolvedValue(
        stored({ redis: { state: "nope" }, mysql: null, postgresql: { state: "added", at: "a" } }),
      );
      expect((await readReadyMadeSettings(ORG, USER)).sources).toEqual({
        postgresql: { state: "added", at: "a" },
      });
    });

    it("reads the cache on a revisit and the server when forced", async () => {
      getSetting.mockResolvedValue(stored({}));
      await readReadyMadeSettings(ORG, USER);
      await readReadyMadeSettings(ORG, USER);
      expect(getSetting).toHaveBeenCalledTimes(1);
      await readReadyMadeSettings(ORG, USER, { force: true });
      expect(getSetting).toHaveBeenCalledTimes(2);
    });
  });

  describe("write", () => {
    it("merges into a fresh server copy and keeps other sources", async () => {
      getSetting.mockResolvedValue(stored({ redis: { state: "dismissed", at: "old" } }));
      setUserSetting.mockResolvedValue({});
      const { saved, value } = await saveReadyMadeStates(ORG, USER, { postgresql: "added" });
      expect(saved).toBe(true);
      expect(setUserSetting).toHaveBeenCalledWith(
        ORG,
        USER,
        READY_MADE_SETTING_KEY,
        {
          version: 1,
          sources: {
            redis: { state: "dismissed", at: "old" },
            postgresql: { state: "added", at: expect.any(String) },
          },
        },
        "dashboards",
      );
      expect(queryClient.getQueryData(settingKeys.one(ORG, READY_MADE_SETTING_KEY, USER))).toEqual(
        value,
      );
    });

    it("reads the server before writing even when the cache is warm", async () => {
      getSetting.mockResolvedValue(stored({}));
      setUserSetting.mockResolvedValue({});
      await readReadyMadeSettings(ORG, USER);
      getSetting.mockResolvedValue(stored({ mysql: { state: "added", at: "other-device" } }));
      await saveReadyMadeStates(ORG, USER, { redis: "dismissed" });
      expect(getSetting).toHaveBeenCalledTimes(2);
      expect(setUserSetting.mock.calls[0][3].sources).toHaveProperty("mysql");
    });

    it("starts from empty on a 404", async () => {
      getSetting.mockRejectedValue(notFound());
      setUserSetting.mockResolvedValue({});
      await saveReadyMadeStates(ORG, USER, { kubernetes: "dismissed" });
      expect(setUserSetting.mock.calls[0][3]).toEqual({
        version: 1,
        sources: { kubernetes: { state: "dismissed", at: expect.any(String) } },
      });
    });

    it("keeps a failed write in session memory, merged into later reads", async () => {
      getSetting.mockResolvedValue(stored({}));
      setUserSetting.mockRejectedValue(new Error("down"));
      const { saved } = await saveReadyMadeStates(ORG, USER, { redis: "dismissed" });
      expect(saved).toBe(false);
      const value = await readReadyMadeSettings(ORG, USER, { force: true });
      expect(value.sources.redis?.state).toBe("dismissed");
      // Another user in the same tab is unaffected.
      expect((await readReadyMadeSettings(ORG, "other@example.com")).sources).toEqual({});
    });

    it("keeps the update in memory when the pre-write read fails", async () => {
      getSetting.mockRejectedValue(Object.assign(new Error("x"), { response: { status: 500 } }));
      const { saved } = await saveReadyMadeStates(ORG, USER, { mysql: "dismissed" });
      expect(saved).toBe(false);
      expect(setUserSetting).not.toHaveBeenCalled();
      getSetting.mockResolvedValue(stored({}));
      expect((await readReadyMadeSettings(ORG, USER, { force: true })).sources.mysql?.state).toBe(
        "dismissed",
      );
    });

    it("flushes remembered entries with the next successful write", async () => {
      getSetting.mockResolvedValue(stored({}));
      setUserSetting.mockRejectedValueOnce(new Error("down")).mockResolvedValue({});
      await saveReadyMadeStates(ORG, USER, { redis: "dismissed" });
      await saveReadyMadeStates(ORG, USER, { mysql: "added" });
      expect(Object.keys(setUserSetting.mock.calls[1][3].sources).sort()).toEqual([
        "mysql",
        "redis",
      ]);
    });

    it("serializes concurrent writes so neither entry is lost", async () => {
      let server: any = { version: 1, sources: {} };
      getSetting.mockImplementation(async () => ({ data: { setting_value: server } }));
      setUserSetting.mockImplementation(async (_o: string, _u: string, _k: string, v: any) => {
        server = v;
        return {};
      });
      await Promise.all([
        saveReadyMadeStates(ORG, USER, { redis: "dismissed" }),
        saveReadyMadeStates(ORG, USER, { mysql: "added" }),
      ]);
      expect(Object.keys(server.sources).sort()).toEqual(["mysql", "redis"]);
    });
  });
});
