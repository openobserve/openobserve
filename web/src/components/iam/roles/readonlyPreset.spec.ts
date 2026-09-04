// Copyright 2026 OpenObserve Inc.
//
// Unit tests for the headless read-only role seeding used by embedded role
// creation (service-account create flow).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/iam", () => ({
  getResources: vi.fn(),
  updateRole: vi.fn(),
}));

import { getResources, updateRole } from "@/services/iam";
import { buildReadonlyPermissions, seedReadonlyRolePermissions } from "./readonlyPreset";

describe("buildReadonlyPermissions", () => {
  it("grants AllowList + AllowGet on visible top-level resources", () => {
    const perms = buildReadonlyPermissions(
      [
        { key: "stream", visible: true },
        { key: "alert", visible: true },
      ],
      "default",
      false,
    );
    expect(perms).toEqual([
      { object: "stream:_all_default", permission: "AllowList" },
      { object: "stream:_all_default", permission: "AllowGet" },
      { object: "alert:_all_default", permission: "AllowList" },
      { object: "alert:_all_default", permission: "AllowGet" },
    ]);
  });

  it("skips invisible and child resources", () => {
    const perms = buildReadonlyPermissions(
      [
        { key: "hidden", visible: false },
        { key: "child", visible: true, parent: "stream" },
      ],
      "default",
      false,
    );
    expect(perms).toEqual([]);
  });

  it("respects the per-resource hidden-permission exclusions (mirrors EditRole)", () => {
    const perms = buildReadonlyPermissions(
      [
        { key: "settings", visible: true },
        { key: "logs_cache", visible: true },
      ],
      "default",
      false,
    );
    // settings: AllowList hidden; logs_cache: both read perms hidden.
    expect(perms).toEqual([{ object: "settings:_all_default", permission: "AllowGet" }]);
  });

  it("excludes the org resource outside the meta org (mirrors EditRole's setPermission guard)", () => {
    const resources = [
      { key: "org", visible: true },
      { key: "stream", visible: true },
    ];
    expect(buildReadonlyPermissions(resources, "default", false)).toEqual([
      { object: "stream:_all_default", permission: "AllowList" },
      { object: "stream:_all_default", permission: "AllowGet" },
    ]);
    expect(buildReadonlyPermissions(resources, "_meta", true)).toEqual([
      { object: "org:_all__meta", permission: "AllowList" },
      { object: "org:_all__meta", permission: "AllowGet" },
      { object: "stream:_all__meta", permission: "AllowList" },
      { object: "stream:_all__meta", permission: "AllowGet" },
    ]);
  });
});

describe("seedReadonlyRolePermissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches resources, saves the built permissions, and returns the grant count", async () => {
    vi.mocked(getResources).mockResolvedValue({
      data: [{ key: "stream", visible: true }],
    } as any);
    vi.mocked(updateRole).mockResolvedValue({ data: {} } as any);

    const granted = await seedReadonlyRolePermissions("viewer", "default", false);

    expect(granted).toBe(2);
    expect(getResources).toHaveBeenCalledWith("default");
    expect(updateRole).toHaveBeenCalledWith({
      role_id: "viewer",
      org_identifier: "default",
      payload: {
        add: [
          { object: "stream:_all_default", permission: "AllowList" },
          { object: "stream:_all_default", permission: "AllowGet" },
        ],
        remove: [],
        add_users: [],
        remove_users: [],
      },
    });
  });

  it("skips the save and returns 0 when no permissions apply", async () => {
    vi.mocked(getResources).mockResolvedValue({ data: [] } as any);

    const granted = await seedReadonlyRolePermissions("viewer", "default", false);

    expect(granted).toBe(0);
    expect(updateRole).not.toHaveBeenCalled();
  });

  it("propagates failures so the caller can surface a warning", async () => {
    vi.mocked(getResources).mockRejectedValue(new Error("boom"));

    await expect(seedReadonlyRolePermissions("viewer", "default", false)).rejects.toThrow("boom");
  });
});
