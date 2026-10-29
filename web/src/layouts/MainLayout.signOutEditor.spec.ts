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
import { defineComponent, h, nextTick } from "vue";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import jsTransformService from "@/services/jstransform";
import OForm from "@/lib/forms/Form/OForm.vue";
import AddFunction from "@/components/functions/AddFunction.vue";
import EditorDraftSignOutDialog from "@/components/common/drafts/EditorDraftSignOutDialog.vue";
import {
  countEditorDraftsFor,
  readEditorDraft,
  resumeEditorDraftSession,
  writeEditorDraft,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import { stopSessionServices } from "@/utils/sessionServices";

vi.mock("@/services/config", () => ({
  default: { get_config_full: vi.fn(() => new Promise(() => {})) },
}));
vi.mock("@/utils/zincutils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/zincutils")>()),
  invalidateLoginData: vi.fn(),
}));
vi.mock("@/utils/sessionServices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/sessionServices")>()),
  stopSessionServices: vi.fn(),
}));
vi.mock("@/services/jstransform", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      create: vi.fn(() => Promise.resolve({ data: { message: "created" } })),
      update: vi.fn(() => Promise.resolve({ data: { message: "updated" } })),
    },
  });
});
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

import MainLayout from "./MainLayout.vue";

const StubDiv = defineComponent({ setup: () => () => h("div") });
const AppHeaderStub = defineComponent({
  name: "AppHeader",
  emits: ["signout"],
  setup: () => () => h("div"),
});

const email = "editor@x.io";
const realLocation = window.location;
const functionScope: EditorDraftScope = {
  kind: "function",
  org: "default",
  entityId: null,
  userEmail: email,
};
const otherDraft: EditorDraftScope = {
  kind: "slo",
  org: "default",
  entityId: null,
  userEmail: email,
};

const FunctionsRoute = defineComponent({ setup: () => () => h(AddFunction) });

const originalOrg = store.state.selectedOrganization;
let router: Router;
let wrapper: VueWrapper | undefined;
let assign: ReturnType<typeof vi.fn>;

const mountLayoutWithEditor = async () => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/",
        component: MainLayout,
        children: [{ path: "functions", name: "functionList", component: FunctionsRoute }],
      },
      { path: "/login", component: StubDiv },
      { path: "/logout", component: StubDiv },
    ],
  });
  await router.push("/functions?action=add");
  wrapper = mount(
    { render: () => h(RouterView) },
    {
      attachTo: document.body,
      global: {
        plugins: [store, i18n, router],
        stubs: {
          AppHeader: AppHeaderStub,
          ONavbar: StubDiv,
          O2AIChat: StubDiv,
          WebinarBanner: StubDiv,
          AnnouncementBanner: StubDiv,
          ShortcutCheatsheet: StubDiv,
          GetStarted: StubDiv,
          CommunitySlackInvite: StubDiv,
          ThemeSwitcher: StubDiv,
          PredefinedThemes: StubDiv,
          SlackIcon: StubDiv,
          ManagementIcon: StubDiv,
          UnifiedQueryEditor: true,
          TestFunction: true,
          FunctionsToolbar: true,
          FullViewContainer: true,
        },
      },
    },
  );
  await flushPromises();
  // The org list and settings never load here, so the org they would pick is set and the content opened.
  store.state.selectedOrganization = { ...originalOrg, identifier: "default" };
  await flushPromises();
  (wrapper.findComponent(MainLayout).vm as unknown as { isLoading: boolean }).isLoading = true;
  await flushPromises();
};

const editor = () => wrapper!.findComponent(AddFunction);
const typeCode = async (code: string) => {
  window.dispatchEvent(new Event("pointerdown"));
  (editor().vm as unknown as { handleFunctionUpdate: (code: string) => void }).handleFunctionUpdate(
    code,
  );
  await nextTick();
};
const setName = (name: string) =>
  (
    editor().findComponent(OForm).vm as unknown as {
      form: { setFieldValue: (k: string, v: string) => void };
    }
  ).form.setFieldValue("name", name);

const signOutFromHeader = async () => {
  wrapper!.findComponent(AppHeaderStub).vm.$emit("signout");
  await flushPromises();
};

const byTest = (id: string) => document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);
const leaveButton = (id: string) => {
  const target = document.body.querySelector<HTMLElement>(
    `[data-test="editor-draft-leave-dialog"] [data-test="${id}"]`,
  );
  if (!target) throw new Error(`no ${id} in the leave dialog`);
  return target;
};

describe("MainLayout — sign out from a dirty editor", () => {
  const originalUserInfo = store.state.userInfo;

  beforeEach(() => {
    assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    localStorage.clear();
    store.state.userInfo = { ...originalUserInfo, email };
    writeEditorDraft(otherDraft, { data: { name: "other work" } });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.stubGlobal("location", realLocation);
    store.state.userInfo = originalUserInfo;
    store.state.selectedOrganization = originalOrg;
    localStorage.clear();
    resumeEditorDraftSession();
    vi.clearAllMocks();
  });

  it("asks once, in the editor's dialog, which tells about the other drafts and offers no Keep; Discard signs out", async () => {
    await mountLayoutWithEditor();
    await typeCode(".a = 1");
    window.dispatchEvent(new Event("pagehide"));
    expect(readEditorDraft(functionScope)).not.toBeNull();

    await signOutFromHeader();

    expect(wrapper!.findComponent(EditorDraftSignOutDialog).props("open")).toBe(false);
    expect(byTest("editor-draft-signout-dialog")).toBeNull();
    expect(byTest("editor-draft-leave-dialog")).not.toBeNull();
    expect(byTest("editor-draft-leave-message")?.textContent).toContain(
      "Save the function or discard your changes.",
    );
    expect(
      document.body.querySelector(
        '[data-test="editor-draft-leave-dialog"] [data-test="o-dialog-secondary-btn"]',
      ),
    ).toBeNull();
    expect(byTest("editor-draft-leave-sign-out")?.getAttribute("aria-label")).toBe(
      "Signing out also discards 1 other unsaved draft in this browser.",
    );
    expect(assign).not.toHaveBeenCalled();

    leaveButton("o-dialog-neutral-btn").click();
    await flushPromises();

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign.mock.calls[0][0]).toMatch(/login$/);
    expect(stopSessionServices).toHaveBeenCalledTimes(1);
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
    resumeEditorDraftSession(email);
    expect(countEditorDraftsFor(email)).toBe(0);
  });

  it("Save in the editor's dialog saves while the session is alive, then signs out", async () => {
    await mountLayoutWithEditor();
    setName("signed_out_fn");
    await typeCode(".b = 2");

    await signOutFromHeader();
    leaveButton("editor-draft-leave-save").click();

    await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(jsTransformService.create).toHaveBeenCalledTimes(1);
    expect(stopSessionServices).toHaveBeenCalledTimes(1);
    expect(vi.mocked(jsTransformService.create).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(stopSessionServices).mock.invocationCallOrder[0],
    );
  });

  it("keeps the count dialog when the open editor has nothing to ask", async () => {
    await mountLayoutWithEditor();

    await signOutFromHeader();

    expect(wrapper!.findComponent(EditorDraftSignOutDialog).props()).toMatchObject({
      open: true,
      count: 1,
    });
    expect(byTest("editor-draft-leave-dialog")).toBeNull();
    expect(assign).not.toHaveBeenCalled();
    byTest("editor-draft-signout-confirm")!.click();
    await flushPromises();
    expect(assign).toHaveBeenCalledTimes(1);
  });
});
