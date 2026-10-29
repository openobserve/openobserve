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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import {
  hashDraftValue,
  readEditorDraft,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import { getAllRolePermissions, updateRole } from "@/services/iam";
import { beginDraftSignOut, cancelDraftSignOut } from "@/utils/drafts/draftSession";
import { byTest, click, clickLeave, clickRestore, leaveButton } from "@/test/unit/helpers/draftDom";
import EditRole from "./EditRole.vue";

vi.setConfig({ testTimeout: 20000 });

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/aws-exports", () => ({ default: { isCloud: "false", isEnterprise: "true" } }));
vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStreams: vi.fn(async () => ({ list: [] })) }),
}));
vi.mock("@/services/iam", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    getResources: vi.fn(async () => ({
      data: [
        {
          key: "function",
          display_name: "Functions",
          has_entities: false,
          top_level: true,
          visible: true,
          parent: "",
          order: 1,
        },
      ],
    })),
    getAllRolePermissions: vi.fn(async () => ({ data: [] })),
    getRoleUsers: vi.fn(async () => ({ data: ["u1@x.io"] })),
    updateRole: vi.fn(async () => ({ data: { code: 200 } })),
  });
});
vi.mock("@/services/users", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      orgUsers: vi.fn(async () => ({
        data: { data: [{ email: "u1@x.io" }, { email: "u2@x.io" }] },
      })),
    },
  });
});
vi.mock("@/services/service_accounts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { list: vi.fn(async () => ({ data: { data: [] } })) },
  });
});

interface RoleVm {
  updatePermissionMappings: (key: string) => void;
  addedPermissions: Record<string, unknown>;
  activeTab: string;
}

const GRANT = "function:_all_default:AllowList";

const scope: EditorDraftScope = {
  kind: "iam_role",
  org: "default",
  entityId: "Admin",
  userEmail: "example@gmail.com",
};

const draftData = {
  added: [GRANT],
  removed: [],
  addedUsers: ["u2@x.io"],
  removedUsers: [],
  addedServiceAccounts: [],
  removedServiceAccounts: [],
  tab: "users",
};

let router: Router;
let wrapper: VueWrapper | null = null;

const mountEditor = async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/iam/roles/edit/:role_name", name: "editRole", component: EditRole },
      { path: "/iam/roles", name: "roles", component: defineComponent({ render: () => h("div") }) },
    ],
  });
  await router.push("/iam/roles/edit/Admin");
  wrapper = mount(
    { render: () => h(RouterView) },
    {
      attachTo: document.body,
      global: {
        plugins: [i18n, store, router],
        stubs: { QueryEditor: true, CodeQueryEditor: true },
      },
    },
  );
  await flushPromises();
  await flushPromises();
};

const vm = () => wrapper!.findComponent(EditRole).vm as unknown as RoleVm;
const leaveChoice = async (id: string) => {
  clickLeave(id);
  await flushPromises();
};

const stageGrant = async () => {
  vm().updatePermissionMappings(GRANT);
  await flushPromises();
};

const seedDraft = (baseHash?: string) =>
  writeEditorDraft(scope, {
    data: draftData,
    baseHash: baseHash ?? hashDraftValue({ grants: [], users: ["u1@x.io"] }),
  });

describe("EditRole drafts", () => {
  beforeEach(() => {
    localStorage.clear();
    queryClient.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(updateRole).mockClear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("drafts a staged grant without any pointer or key input, under the role's own key", async () => {
    await mountEditor();
    await stageGrant();
    await vi.advanceTimersByTimeAsync(1100);

    const stored = readEditorDraft<typeof draftData>(scope);
    expect(stored?.data.added).toEqual([GRANT]);
    expect(stored?.data.tab).toBe("permissions");
    expect(stored?.baseHash).toBe(hashDraftValue({ grants: [], users: ["u1@x.io"] }));
  });

  it("Continue restores the staged grant, the open tab and the picked member in the real member list", async () => {
    seedDraft();
    await mountEditor();
    expect(byTest("editor-draft-restore-dialog")).not.toBeNull();

    clickRestore("editor-draft-continue");
    await flushPromises();
    await flushPromises();

    expect(Object.keys(vm().addedPermissions)).toEqual([GRANT]);
    expect(vm().activeTab).toBe("users");
    const picked = document.body.querySelector(
      '[data-test="iam-users-selection-table-body-row-u2@x.io-checkbox"] [role="checkbox"]',
    );
    expect(picked?.getAttribute("aria-checked")).toBe("true");
  });

  it("a restored member removal stays listed under Selected, unticked, so it can be undone", async () => {
    writeEditorDraft(scope, {
      data: { ...draftData, added: [], addedUsers: [], removedUsers: ["u1@x.io"] },
    });
    await mountEditor();
    clickRestore("editor-draft-continue");
    await flushPromises();
    await flushPromises();

    const removed = document.body.querySelector(
      '[data-test="iam-users-selection-table-body-row-u1@x.io-checkbox"] [role="checkbox"]',
    );
    expect(removed?.getAttribute("aria-checked")).toBe("false");
  });

  it("Start fresh drops the draft and stages nothing", async () => {
    seedDraft();
    await mountEditor();
    clickRestore("o-dialog-secondary-btn");
    await flushPromises();

    expect(readEditorDraft(scope)).toBeNull();
    expect(Object.keys(vm().addedPermissions)).toEqual([]);
  });

  it("Escape keeps the draft for later and stages nothing", async () => {
    seedDraft();
    await mountEditor();
    document.body
      .querySelector('[data-test="editor-draft-restore-dialog"]')!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();

    expect(byTest("editor-draft-restore-dialog")).toBeNull();
    expect(readEditorDraft(scope)).not.toBeNull();
    expect(Object.keys(vm().addedPermissions)).toEqual([]);
  });

  it("notes a role changed on the server since the draft", async () => {
    seedDraft("stale");
    await mountEditor();
    expect(byTest("editor-draft-changed-on-server")).not.toBeNull();
  });

  it("leaving with staged changes asks; Save stores them and the navigation goes on", async () => {
    await mountEditor();
    await stageGrant();

    void router.push("/iam/roles");
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();

    await leaveChoice("editor-draft-leave-save");
    await flushPromises();

    expect(vi.mocked(updateRole)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateRole).mock.calls[0][0].payload.add).toEqual([
      { object: "function:_all_default", permission: "AllowList" },
    ]);
    expect(router.currentRoute.value.name).toBe("roles");
    expect(readEditorDraft(scope)).toBeNull();
  });

  it("Keep draft stores the staged changes and lets the navigation go", async () => {
    await mountEditor();
    await stageGrant();

    void router.push("/iam/roles");
    await flushPromises();
    await leaveChoice("o-dialog-secondary-btn");

    expect(router.currentRoute.value.name).toBe("roles");
    expect(readEditorDraft<typeof draftData>(scope)?.data.added).toEqual([GRANT]);
    expect(vi.mocked(updateRole)).not.toHaveBeenCalled();
  });

  it("Discard drops the changes and saves nothing", async () => {
    await mountEditor();
    await stageGrant();
    await vi.advanceTimersByTimeAsync(1100);

    void router.push("/iam/roles");
    await flushPromises();
    await leaveChoice("o-dialog-neutral-btn");

    expect(router.currentRoute.value.name).toBe("roles");
    expect(readEditorDraft(scope)).toBeNull();
    expect(vi.mocked(updateRole)).not.toHaveBeenCalled();
  });

  it("closing the leave dialog stays on the editor with the changes staged", async () => {
    await mountEditor();
    await stageGrant();

    void router.push("/iam/roles");
    await flushPromises();
    await leaveChoice("o-dialog-close-btn");

    expect(router.currentRoute.value.name).toBe("editRole");
    expect(Object.keys(vm().addedPermissions)).toEqual([GRANT]);
  });

  it("the footer Save clears the draft", async () => {
    await mountEditor();
    await stageGrant();
    await vi.advanceTimersByTimeAsync(1100);
    expect(readEditorDraft(scope)).not.toBeNull();

    click("edit-role-save-btn");
    await flushPromises();

    expect(vi.mocked(updateRole)).toHaveBeenCalledTimes(1);
    expect(readEditorDraft(scope)).toBeNull();
  });

  it("a load that fails still asks before staged changes are left, though no draft started", async () => {
    let failLoad: (reason: unknown) => void = () => undefined;
    vi.mocked(getAllRolePermissions).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failLoad = reject;
        }) as never,
    );
    await mountEditor();
    await stageGrant();

    failLoad({ response: { status: 500 }, message: "Internal error" });
    await flushPromises();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    await leaveChoice("o-dialog-close-btn");
    expect(router.currentRoute.value.name).toBe("editRole");

    void router.push("/iam/roles");
    await flushPromises();
    await leaveChoice("o-dialog-neutral-btn");

    expect(router.currentRoute.value.name).toBe("roles");
    expect(vi.mocked(updateRole)).not.toHaveBeenCalled();
    expect(readEditorDraft(scope)).toBeNull();
  });

  it("a failed load during a forced sign-out offers only Discard", async () => {
    let failLoad: (reason: unknown) => void = () => undefined;
    vi.mocked(getAllRolePermissions).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failLoad = reject;
        }) as never,
    );
    await mountEditor();
    await stageGrant();
    failLoad({ response: { status: 500 }, message: "Internal error" });
    await flushPromises();
    beginDraftSignOut({ forced: true });
    try {
      const navigation = router.push("/iam/roles");
      await flushPromises();
      expect(byTest("editor-draft-leave-message")?.textContent?.trim()).toBe(
        "Your password changed, so you are being signed out and this role cannot be saved. Your changes to it will be discarded.",
      );
      expect(leaveButton("o-dialog-secondary-btn")).toBeNull();
      expect(leaveButton("o-dialog-close-btn")).toBeNull();
      expect(leaveButton("editor-draft-leave-save")).toBeNull();

      await leaveChoice("o-dialog-neutral-btn");
      await navigation;
      expect(router.currentRoute.value.name).toBe("roles");
    } finally {
      cancelDraftSignOut();
    }
  });

  it("a role that no longer exists drops its drafts", async () => {
    seedDraft();
    vi.mocked(getAllRolePermissions).mockRejectedValueOnce({ response: { status: 404 } });
    await mountEditor();

    expect(readEditorDraft(scope)).toBeNull();
  });
});
