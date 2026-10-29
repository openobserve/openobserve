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
import { ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import { useRoleSave } from "@/composables/iam/useRoleSave";
import analytics from "@/services/product_analytics";
import { toast } from "@/lib/feedback/Toast/useToast";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

type Staged = { object: string; permission: string };

const makeDeps = (
  mutateAsync: () => Promise<unknown>,
  staged: { add: Staged[]; remove: Staged[] } = {
    add: [{ object: "logs:_all_default", permission: "AllowGet" }],
    remove: [],
  },
) => ({
  editingRole: ref("r1"),
  permissionsUiType: ref("table"),
  updateJsonInTable: vi.fn(),
  grants: {
    payload: () => staged,
    commit: vi.fn(),
  },
  addedUsers: ref(new Set<unknown>()),
  removedUsers: ref(new Set<unknown>()),
  addedServiceAccounts: ref(new Set<unknown>()),
  removedServiceAccounts: ref(new Set<unknown>()),
  roleUsers: ref<string[]>([]),
  updateRoleOne: { mutateAsync: vi.fn(mutateAsync) },
  pendingCounts: vi.fn(() => ({ changes: 1, modules: 1 })),
  presetSettled: vi.fn(() => Promise.resolve()),
  t: i18n.global.t as any,
});

describe("useRoleSave product analytics", () => {
  beforeEach(() => {
    vi.mocked(analytics.track).mockClear();
  });

  it("tracks role_updated once the role update succeeds", async () => {
    useRoleSave(makeDeps(() => Promise.resolve({}))).saveRole();
    await flushPromises();
    expect(analytics.track).toHaveBeenCalledWith("role_updated", {
      permissions_changed: true,
      members_changed: false,
    });
  });

  it("does not track role_updated when the role update fails", async () => {
    useRoleSave(makeDeps(() => Promise.reject({ response: { status: 500 } }))).saveRole();
    await flushPromises();
    expect(analytics.track).not.toHaveBeenCalled();
  });
});

describe("useRoleSave toast", () => {
  const savedToast = async (deps: ReturnType<typeof makeDeps>) => {
    vi.mocked(toast).mockClear();
    useRoleSave(deps).saveRole();
    await flushPromises();
    return vi.mocked(toast).mock.calls.map(([arg]) => arg);
  };

  // Drawer rows, not payload keys: four keys can be three rows.
  it("names the changes and the modules the drawer shows", async () => {
    const deps = makeDeps(() => Promise.resolve({}), {
      add: [
        { object: "logs:app", permission: "AllowGet" },
        { object: "logs:app", permission: "AllowList" },
        { object: "dashboard:f1/d1", permission: "AllowGet" },
      ],
      remove: [{ object: "metrics:cpu", permission: "AllowGet" }],
    });
    deps.pendingCounts.mockReturnValue({ changes: 3, modules: 2 });

    expect(await savedToast(deps)).toEqual([
      { variant: "success", message: "Saved 3 changes in 2 modules." },
    ]);
  });

  it("uses the singular for one change in one module", async () => {
    const deps = makeDeps(() => Promise.resolve({}));

    expect(await savedToast(deps)).toEqual([
      { variant: "success", message: "Saved 1 change in 1 module." },
    ]);
  });

  it("keeps the plain success message for a members-only save", async () => {
    const deps = makeDeps(() => Promise.resolve({}), { add: [], remove: [] });
    deps.addedUsers.value.add("new@example.com");

    expect(await savedToast(deps)).toEqual([
      { variant: "success", message: i18n.global.t("iam.editRole.updateSuccess") },
    ]);
  });

  it("says nothing changed when nothing is staged", async () => {
    const deps = makeDeps(() => Promise.resolve({}), { add: [], remove: [] });

    expect(await savedToast(deps)).toEqual([
      { variant: "info", message: i18n.global.t("iam.editRole.noUpdatesDetected") },
    ]);
    expect(deps.updateRoleOne.mutateAsync).not.toHaveBeenCalled();
  });

  it("counts the grants typed in JSON, flushed before the payload is read", async () => {
    let staged = { add: [] as Staged[], remove: [] as Staged[] };
    const deps = makeDeps(() => Promise.resolve({}));
    deps.grants.payload = () => staged;
    deps.permissionsUiType.value = "json";
    deps.updateJsonInTable.mockImplementation(() => {
      staged = { add: [{ object: "logs:app", permission: "AllowGet" }], remove: [] };
    });

    expect(await savedToast(deps)).toEqual([
      { variant: "success", message: "Saved 1 change in 1 module." },
    ]);
  });
});

describe("useRoleSave preset and save interlock", () => {
  // A preset still staging when Save is clicked must reach the payload, not be committed unsent.
  it("builds the payload only after a staging preset has settled", async () => {
    let settle!: () => void;
    let staged = { add: [] as Staged[], remove: [] as Staged[] };
    const deps = makeDeps(() => Promise.resolve({}));
    deps.grants.payload = () => staged;
    deps.presetSettled.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );

    const saving = useRoleSave(deps).saveRole();
    staged = { add: [{ object: "logs:app", permission: "AllowGet" }], remove: [] };
    settle();
    await saving;

    expect(deps.updateRoleOne.mutateAsync).toHaveBeenCalledWith({
      role_id: "r1",
      payload: {
        add: [{ object: "logs:app", permission: "AllowGet" }],
        remove: [],
        add_users: [],
        remove_users: [],
      },
    });
  });

  it("reports saving from the click until the request settles", async () => {
    let finish!: (value: unknown) => void;
    const deps = makeDeps(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { saveRole, isSaving } = useRoleSave(deps);

    const saving = saveRole();
    expect(isSaving.value).toBe(true);
    await flushPromises();
    expect(isSaving.value).toBe(true);

    finish({});
    await saving;
    expect(isSaving.value).toBe(false);
  });

  it("sends one request for a second click while the first is in flight", async () => {
    let finish!: (value: unknown) => void;
    const deps = makeDeps(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { saveRole } = useRoleSave(deps);

    const first = saveRole();
    await flushPromises();
    await saveRole();
    finish({});
    await first;

    expect(deps.updateRoleOne.mutateAsync).toHaveBeenCalledTimes(1);
  });
});

describe("useRoleSave network failure", () => {
  it("shows the save-failure toast when the request has no response", async () => {
    vi.mocked(toast).mockClear();
    const deps = makeDeps(() => Promise.reject(new TypeError("Network Error")));
    vi.spyOn(console, "log").mockImplementation(() => {});

    await useRoleSave(deps).saveRole();
    await flushPromises();

    expect(toast).toHaveBeenCalledWith({
      variant: "error",
      message: i18n.global.t("iam.editRole.updateError"),
    });
  });
});
