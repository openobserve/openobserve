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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import router from "@/test/unit/helpers/router";
import EditorDraftSignOutDialog from "@/components/common/drafts/EditorDraftSignOutDialog.vue";
import {
  editorDraftSessionEnded,
  editorDraftSigningOut,
  countEditorDraftsFor,
  resumeEditorDraftSession,
  writeEditorDraft,
} from "@/utils/drafts/editorDraftStore";
import { invalidateLoginData } from "@/utils/zincutils";
import { stopSessionServices } from "@/utils/sessionServices";

const realLocation = window.location;

vi.mock("@/services/config", () => ({
  default: { get_config_full: vi.fn(() => new Promise(() => {})) },
}));

vi.mock("@/utils/zincutils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/zincutils")>()),
  invalidateLoginData: vi.fn(),
}));

vi.mock("@/utils/sessionServices", () => ({ stopSessionServices: vi.fn() }));

import MainLayout from "./MainLayout.vue";

const StubDiv = defineComponent({ setup: () => () => h("div") });

const mountMainLayout = () =>
  mount(MainLayout, {
    global: {
      plugins: [store, i18n, router],
      stubs: {
        AppHeader: StubDiv,
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
        ODialog: StubDiv,
        "router-view": StubDiv,
      },
    },
  });

describe("MainLayout — sign out with drafts", () => {
  let wrapper: VueWrapper | undefined;
  const originalUserInfo = store.state.userInfo;
  const email = "drafts@x.io";
  const logout = ["logout", { draftsOf: email }];
  let assign: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
  });

  afterEach(async () => {
    vi.stubGlobal("location", realLocation);
    await router.push("/");
    wrapper?.unmount();
    wrapper = undefined;
    store.state.userInfo = originalUserInfo;
    localStorage.clear();
    resumeEditorDraftSession();
    vi.restoreAllMocks();
  });

  it("asks before signing out when this user has drafts, and signs out only on confirm", async () => {
    store.state.userInfo = { ...originalUserInfo, email };
    writeEditorDraft({ kind: "slo", org: "o1", entityId: null, userEmail: email }, { data: {} });
    writeEditorDraft({ kind: "alert", org: "o2", entityId: "a1", userEmail: email }, { data: {} });
    writeEditorDraft(
      { kind: "alert", org: "o2", entityId: "a1", userEmail: "other@x.io" },
      { data: {} },
    );
    const dispatch = vi.spyOn(store, "dispatch");
    wrapper = mountMainLayout();
    await flushPromises();

    (wrapper.vm as unknown as { signout: () => void }).signout();
    await flushPromises();
    const dialog = wrapper.findComponent(EditorDraftSignOutDialog);
    expect(dialog.props()).toMatchObject({ open: true, count: 2 });
    expect(dispatch).not.toHaveBeenCalledWith(...logout);
    expect(assign).not.toHaveBeenCalled();

    dialog.vm.$emit("confirm");
    await flushPromises();
    expect(dispatch).toHaveBeenCalledWith(...logout);
    expect(assign).toHaveBeenCalledTimes(1);
    resumeEditorDraftSession();
    expect(countEditorDraftsFor(email)).toBe(0);
    expect(countEditorDraftsFor("other@x.io")).toBe(1);
  });

  it("runs the editors' leave guards before ending the session, and Stay aborts the sign-out", async () => {
    store.state.userInfo = { ...originalUserInfo, email };
    vi.mocked(invalidateLoginData).mockClear();
    vi.mocked(stopSessionServices).mockClear();
    const dispatch = vi.spyOn(store, "dispatch");
    const seen: { loggedOut: boolean; signingOut: boolean }[] = [];
    let allow = false;
    const removeGuard = router.beforeEach((to) => {
      if (to.path !== "/logout") return true;
      seen.push({
        loggedOut: dispatch.mock.calls.some(([type]) => type === "logout"),
        signingOut: editorDraftSigningOut.value,
      });
      return allow;
    });
    try {
      wrapper = mountMainLayout();
      await flushPromises();
      const vm = wrapper.vm as unknown as { signout: () => void };

      vm.signout();
      await flushPromises();
      expect(seen).toEqual([{ loggedOut: false, signingOut: true }]);
      expect(dispatch).not.toHaveBeenCalledWith(...logout);
      expect(invalidateLoginData).not.toHaveBeenCalled();
      expect(stopSessionServices).not.toHaveBeenCalled();
      expect(assign).not.toHaveBeenCalled();
      expect(editorDraftSigningOut.value).toBe(false);

      allow = true;
      vm.signout();
      await flushPromises();
      expect(seen[1]).toEqual({ loggedOut: false, signingOut: true });
      expect(dispatch).toHaveBeenCalledWith(...logout);
      expect(invalidateLoginData).toHaveBeenCalledTimes(1);
      expect(stopSessionServices).toHaveBeenCalledTimes(1);
      expect(editorDraftSessionEnded.value).toBe(true);
      expect(router.currentRoute.value.path).toBe("/login");
      expect(assign).toHaveBeenCalledTimes(1);
    } finally {
      removeGuard();
    }
  });

  it("signs out at once when this user has no drafts", async () => {
    store.state.userInfo = { ...originalUserInfo, email };
    const dispatch = vi.spyOn(store, "dispatch");
    wrapper = mountMainLayout();
    await flushPromises();

    (wrapper.vm as unknown as { signout: () => void }).signout();
    await flushPromises();
    expect(wrapper.findComponent(EditorDraftSignOutDialog).props("open")).toBe(false);
    expect(dispatch).toHaveBeenCalledWith(...logout);
    expect(assign).toHaveBeenCalledTimes(1);
  });
});
