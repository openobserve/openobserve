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

import { beforeEach, describe, expect, it, vi } from "vitest";

import http from "./http";
import assistantSettings, {
  MAX_GRANTS,
  parseCapabilityStatus,
  parseOrgAiSettings,
  parseTestResult,
} from "./assistant_settings";

vi.mock("./http", () => ({ default: vi.fn() }));

const httpError = (status?: number) =>
  Object.assign(new Error("request failed"), status ? { response: { status } } : {});

const SETTINGS = {
  enabled: true,
  permission_tier: "propose",
  org_sharing: true,
  public_sharing: false,
  data_sharing_level: "aggregates",
  updated_by: "ada@example.com",
  updated_at: 1_700_000_000_000_000,
};

describe("assistant settings service", () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    api = {
      get: vi.fn().mockResolvedValue({ data: SETTINGS }),
      put: vi.fn().mockResolvedValue({ data: SETTINGS }),
      patch: vi.fn().mockResolvedValue({ data: {} }),
      post: vi.fn().mockResolvedValue({ data: { ok: true, duration_ms: 180 } }),
      delete: vi.fn().mockResolvedValue({ data: {} }),
    };
    (http as any).mockReturnValue(api);
  });

  it("reads org settings without the interceptor's 403 toast", async () => {
    await expect(assistantSettings.get("org 1")).resolves.toMatchObject({ enabled: true });
    expect(api.get).toHaveBeenCalledWith("/api/org%201/ai/settings", { silentForbidden: true });
  });

  it("answers null when the server predates org settings (404)", async () => {
    api.get.mockRejectedValue(httpError(404));
    await expect(assistantSettings.get("acme")).resolves.toBeNull();
  });

  it("rethrows any other read failure", async () => {
    api.get.mockRejectedValue(httpError(500));
    await expect(assistantSettings.get("acme")).rejects.toThrow("request failed");
  });

  it("puts only the five writable keys", async () => {
    await assistantSettings.update("acme", { ...SETTINGS, extra: "x" } as any);
    expect(api.put).toHaveBeenCalledWith("/api/acme/ai/settings", {
      enabled: true,
      permission_tier: "propose",
      org_sharing: true,
      public_sharing: false,
      data_sharing_level: "aggregates",
    });
  });

  it.each([
    ["an unknown tier", { ...SETTINGS, permission_tier: "admin" }],
    ["an unknown level", { ...SETTINGS, data_sharing_level: "all" }],
    ["a missing flag", { ...SETTINGS, enabled: undefined }],
    ["a non-object", "<html>"],
  ])("reads %s as no settings", (_name, body) => {
    expect(parseOrgAiSettings(body)).toBeNull();
  });

  it("drops an overlong actor rather than rendering it", () => {
    expect(parseOrgAiSettings({ ...SETTINGS, updated_by: "x".repeat(600) })?.updated_by).toBe(
      undefined,
    );
  });

  it("is safe against a prototype-pollution body", () => {
    const body = JSON.parse('{"__proto__":{"polluted":true},' + JSON.stringify(SETTINGS).slice(1));
    const parsed = parseOrgAiSettings(body);
    expect(parsed?.enabled).toBe(true);
    expect(({} as any).polluted).toBeUndefined();
  });

  it("patches a toolset's enabled flag and tests it", async () => {
    await assistantSettings.setToolsetEnabled("acme", "pager duty", false);
    expect(api.patch).toHaveBeenCalledWith("/api/acme/ai/toolsets/pager%20duty", {
      enabled: false,
    });
    await expect(assistantSettings.testToolset("acme", "pd")).resolves.toEqual({
      ok: true,
      duration_ms: 180,
      error: undefined,
    });
    api.post.mockRejectedValue(httpError(404));
    await expect(assistantSettings.testToolset("acme", "pd")).resolves.toBeNull();
  });

  it("lists grants, drops malformed rows and caps the count", async () => {
    const grant = {
      id: "g1",
      tool: "UpdateAlert",
      operation: "update",
      scope: "always",
      granted_by: "ada@example.com",
      granted_at: 1,
    };
    api.get.mockResolvedValue({
      data: [grant, { id: "bad" }, ...Array.from({ length: MAX_GRANTS + 5 }, () => grant)],
    });
    const rows = await assistantSettings.grants("acme");
    expect(rows![0]).toEqual(grant);
    expect(rows!.length).toBe(MAX_GRANTS - 1);
    api.get.mockRejectedValue(httpError(404));
    await expect(assistantSettings.grants("acme")).resolves.toBeNull();
  });

  it("pages activity with only the filters that are set", async () => {
    api.get.mockResolvedValue({
      data: {
        rows: [{ id: "a1", at: 5, action: "Updated alert", on_behalf_of: "ada@example.com" }, {}],
        next_cursor: "c2",
      },
    });
    const page = await assistantSettings.activity("acme", { from: 1, actor: "", cursor: "c1" });
    expect(api.get).toHaveBeenCalledWith("/api/acme/ai/activity", {
      silentForbidden: true,
      params: { from: 1, cursor: "c1" },
    });
    expect(page?.rows.map((e) => e.id)).toEqual(["a1"]);
    expect(page?.next_cursor).toBe("c2");
    api.get.mockRejectedValue(httpError(404));
    await expect(assistantSettings.activity("acme")).resolves.toBeNull();
  });

  it("reads activity rows in the server's shape", async () => {
    const serverRow = {
      id: "r1",
      at: 1_700_000_000_000_000,
      action: "Deleted alert",
      target: { type: "alert", id: "a9", name: "cpu", deleted: true },
      on_behalf_of: "ada@example.com",
      approval: { kind: "approved", by: "bob@example.com" },
      result: { state: "done" },
      undo: { available: true, until: 1_700_000_900_000_000 },
      chat_id: "c1",
      turn_id: "t1",
    };
    const undone = {
      ...serverRow,
      id: "r2",
      approval: { kind: "standing" },
      result: { state: "undone", message: "Reverted" },
      undo: { available: false, reason: "already_undone" },
    };
    const undoRow = { ...serverRow, id: "r3", undo_of: "r2", approval: { kind: "bogus" } };
    api.get.mockResolvedValue({ data: { rows: [serverRow, undone, undoRow] } });
    const page = await assistantSettings.activity("acme");
    expect(page?.rows).toHaveLength(3);
    expect(page?.rows[0]).toMatchObject({
      on_behalf_of: "ada@example.com",
      approval: { kind: "approved", by: "bob@example.com" },
      result: { state: "done" },
      undo: { available: true, until: 1_700_000_900_000_000 },
      target: { name: "cpu", deleted: true },
      chat_id: "c1",
    });
    expect(page?.rows[1].result).toEqual({ state: "undone", message: "Reverted" });
    expect(page?.rows[1].undo).toMatchObject({ available: false, reason: "already_undone" });
    expect(page?.rows[2].undo_of).toBe("r2");
    expect(page?.rows[2].approval).toBeUndefined();
    expect(page?.next_cursor).toBeUndefined();
  });

  it("revokes a grant and undoes an activity entry", async () => {
    await assistantSettings.revokeGrant("acme", "g/1");
    expect(api.delete).toHaveBeenCalledWith("/api/acme/ai/grants/g%2F1");
    await assistantSettings.undoActivity("acme", "a1");
    expect(api.post).toHaveBeenCalledWith("/api/acme/ai/activity/a1/undo", {});
  });
});

describe("capability and test parsing", () => {
  it("reads a wrong-typed health or label as not reported, never as a crash", () => {
    const caps = parseCapabilityStatus({
      health: { status: "down", last_error: { code: 1 }, checked_at: "yesterday" },
      model: 42,
      agent_version: "v".repeat(400),
      model_provider: ["x"],
      policy_enforced: "true",
    });
    expect(caps?.health).toEqual({ status: "down", lastError: undefined, checkedAt: undefined });
    expect(caps?.model).toBeUndefined();
    expect(caps?.agentVersion).toHaveLength(100);
    expect(caps?.provider).toBeUndefined();
    expect(caps?.policyEnforced).toBe(false);
  });

  it("has no health when the body reports none", () => {
    expect(parseCapabilityStatus({ policy_enforced: true })?.health).toBeNull();
    expect(parseCapabilityStatus({ health: { last_error: "x" } })?.health).toBeNull();
    expect(parseCapabilityStatus(null)).toBeNull();
  });

  it("bounds a test error and reads a malformed answer as failed", () => {
    expect(parseTestResult({ ok: false, error: "e".repeat(900) }).error).toHaveLength(500);
    expect(parseTestResult(null)).toEqual({ ok: false });
    expect(parseTestResult({ ok: "yes" })).toEqual({ ok: false });
    expect(
      parseTestResult({
        ok: false,
        duration_ms: 3,
        error: { code: "timeout", message: "No answer." },
      }),
    ).toEqual({ ok: false, duration_ms: 3, error: "No answer." });
  });
});
