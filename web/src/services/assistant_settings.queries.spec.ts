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

import { describe, expect, it, vi } from "vitest";

import { LIVE_STALE_TIME, MEDIUM_STALE_TIME } from "@/composables/query/cachePolicy";

import assistant from "./assistant";
import { assistantKeys } from "./assistant.querykeys";
import { aiToolsetKeys } from "./ai_toolsets.querykeys";
import assistantSettings from "./assistant_settings";
import {
  assistantActivityQuery,
  assistantGrantsQuery,
  assistantSettingsQuery,
  revokeGrantMutation,
  setToolsetEnabledMutation,
  testCapabilitiesMutation,
  undoActivityMutation,
  updateAssistantSettingsMutation,
} from "./assistant_settings.queries";
import { assistantSettingsKeys } from "./assistant_settings.querykeys";

vi.mock("./assistant_settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./assistant_settings")>()),
  default: {
    get: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(null),
    grants: vi.fn().mockResolvedValue(null),
    activity: vi.fn().mockResolvedValue(null),
    revokeGrant: vi.fn(),
    undoActivity: vi.fn(),
    setToolsetEnabled: vi.fn(),
    testToolset: vi.fn(),
  },
}));
vi.mock("./assistant", () => ({ default: { testCapabilities: vi.fn() } }));

const prefix = (key: readonly unknown[], scope: readonly unknown[]) =>
  scope.every((part, i) => key[i] === part);

describe("assistant settings queries", () => {
  it("keeps every read under the settings scope", () => {
    const scope = assistantKeys.settings("acme");
    expect(prefix(assistantSettingsQuery("acme").queryKey, scope)).toBe(true);
    expect(prefix(assistantGrantsQuery("acme").queryKey, scope)).toBe(true);
    expect(prefix(assistantActivityQuery("acme", {}).queryKey, scope)).toBe(true);
    expect(
      prefix(
        assistantActivityQuery("acme", { q: "x" }).queryKey,
        assistantSettingsKeys.activityAll("acme"),
      ),
    ).toBe(true);
  });

  it("names a cache tier for each read and never retries the degraded 404", () => {
    expect(assistantSettingsQuery("acme").staleTime).toBe(MEDIUM_STALE_TIME);
    expect(assistantGrantsQuery("acme").staleTime).toBe(LIVE_STALE_TIME);
    expect(assistantActivityQuery("acme", {}).staleTime).toBe(LIVE_STALE_TIME);
    expect(assistantSettingsQuery("acme").retry).toBe(false);
  });

  it("does not read without an org", () => {
    expect(assistantSettingsQuery("").enabled).toBe(false);
  });

  it("reads null as the unsupported path", async () => {
    const fn = assistantSettingsQuery("acme").queryFn as () => Promise<unknown>;
    await expect(fn()).resolves.toBeNull();
    expect(assistantSettings.get).toHaveBeenCalledWith("acme");
  });

  it("a settings save refetches the settings and the gate", () => {
    expect(updateAssistantSettingsMutation("acme").meta?.invalidates).toEqual([
      assistantSettingsKeys.org("acme"),
      assistantKeys.capabilities("acme"),
    ]);
  });

  it("a save puts the edited keys on a fresh read, so another admin's change survives", async () => {
    vi.mocked(assistantSettings.get).mockResolvedValueOnce({
      enabled: false,
      permission_tier: "read",
      org_sharing: false,
      public_sharing: false,
      data_sharing_level: "schema",
      updated_by: "b@example.com",
    });
    const fn = updateAssistantSettingsMutation("acme").mutationFn as (
      v: unknown,
    ) => Promise<unknown>;
    await fn({ data_sharing_level: "aggregates" });
    expect(assistantSettings.update).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({
        enabled: false,
        permission_tier: "read",
        org_sharing: false,
        public_sharing: false,
        data_sharing_level: "aggregates",
      }),
    );
  });

  it("a save refuses to write when the server no longer has org settings", async () => {
    vi.mocked(assistantSettings.update).mockClear();
    const fn = updateAssistantSettingsMutation("acme").mutationFn as (
      v: unknown,
    ) => Promise<unknown>;
    await expect(fn({ enabled: false })).rejects.toThrow();
    expect(assistantSettings.update).not.toHaveBeenCalled();
  });

  it("Test invalidates capabilities and checks the answer it composes", async () => {
    const m = testCapabilitiesMutation("acme");
    expect(m.meta).toEqual({
      invalidates: [assistantKeys.capabilities("acme")],
      silentError: true,
    });
    vi.mocked(assistant.testCapabilities).mockResolvedValueOnce({
      ok: false,
      error: { nested: true },
      duration_ms: "slow",
    } as never);
    const res = await (m.mutationFn as () => Promise<unknown>)();
    expect(assistant.testCapabilities).toHaveBeenCalledWith("acme");
    expect(res).toEqual({ ok: false, duration_ms: undefined, error: undefined });
  });

  it("writes declare the scope they refetch", () => {
    expect(setToolsetEnabledMutation("acme").meta?.invalidates).toEqual([
      aiToolsetKeys.all("acme"),
    ]);
    expect(revokeGrantMutation("acme").meta?.invalidates).toEqual([
      assistantSettingsKeys.grants("acme"),
    ]);
    expect(undoActivityMutation("acme").meta?.invalidates).toEqual([
      assistantSettingsKeys.activityAll("acme"),
    ]);
  });
});
