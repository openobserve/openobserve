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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import { queryClient } from "@/composables/query/queryClient";

vi.mock("@/services/config", () => ({
  default: { get_config_full: vi.fn(() => new Promise(() => {})) },
}));
vi.mock("@openobserve/browser-rum", () => ({
  openobserveRum: { setUser: vi.fn(), startView: vi.fn() },
}));
vi.mock("@/composables/useHomeDashboard", () => ({
  useHomeDashboard: () => ({ load: vi.fn(async () => undefined) }),
}));
vi.mock("@/composables/useOrgSwitcherPrefs", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, noteLanding: vi.fn(actual.noteLanding) };
});

import MainLayout from "./MainLayout.vue";
import appStore from "@/stores";
import {
  __resetOrgSwitcherPrefsForTest,
  noteLanding,
  useOrgSwitcherPrefs,
} from "@/composables/useOrgSwitcherPrefs";

const StubDiv = defineComponent({ setup: () => () => h("div") });

const mountLayout = async (path = "/") => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: StubDiv }],
  });
  // A login lands on "/" with no org_identifier in the URL.
  await router.push(path);
  return mount(MainLayout, {
    global: {
      plugins: [store, i18n, router],
      stubs: {
        AppHeader: StubDiv,
        ONavbar: StubDiv,
        O2AIChat: StubDiv,
        WebinarBanner: StubDiv,
        AnnouncementBanner: StubDiv,
        ShortcutCheatsheet: StubDiv,
        CommunitySlackInvite: StubDiv,
        ThemeSwitcher: StubDiv,
        PredefinedThemes: StubDiv,
        SlackIcon: StubDiv,
        ManagementIcon: StubDiv,
        ODialog: StubDiv,
      },
    },
  });
};

describe("MainLayout — org switcher recents", () => {
  let wrapper: VueWrapper | undefined;
  const initial = store.state.selectedOrganization;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    queryClient.clear();
    store.state.selectedOrganization = initial;
    store.state.organizations = [];
    vi.mocked(noteLanding).mockClear();
    appStore.state.userInfo = {};
    localStorage.clear();
    __resetOrgSwitcherPrefsForTest();
  });

  it("C3 records the org a queryless login lands in", async () => {
    store.state.organizations = [{ identifier: "default" }, { identifier: "acme" }];
    wrapper = await mountLayout();
    await flushPromises();
    expect(noteLanding).toHaveBeenCalledWith("default", ["default", "acme"]);
  });

  it("C3 records an org resolved after mount, and not a later switch", async () => {
    store.state.selectedOrganization = {};
    wrapper = await mountLayout();
    await flushPromises();
    vi.mocked(noteLanding).mockClear();

    store.state.selectedOrganization = { identifier: "acme" };
    await flushPromises();
    expect(noteLanding).toHaveBeenCalledWith("acme", []);

    vi.mocked(noteLanding).mockClear();
    store.state.selectedOrganization = { identifier: "billing" };
    await flushPromises();
    expect(noteLanding).not.toHaveBeenCalledWith("billing", expect.anything());
  });

  it("F11 records the URL org of a link landing, not the stale stored org", async () => {
    appStore.state.userInfo = { email: "f11@example.com" };
    __resetOrgSwitcherPrefsForTest();
    store.state.organizations = [];
    store.state.selectedOrganization = { identifier: "stale" };
    // The router's afterEach notes the URL org during the initial navigation, before the list loads.
    noteLanding("linked", []);
    wrapper = await mountLayout("/?org_identifier=linked");
    await flushPromises();
    expect(noteLanding).not.toHaveBeenCalledWith("stale", expect.anything());

    store.state.organizations = [
      { identifier: "stale", name: "Stale" },
      { identifier: "linked", name: "Linked" },
    ];
    await flushPromises();
    expect(useOrgSwitcherPrefs().recents.value).toEqual(["linked"]);
  });

  it("F11 still records the resolved org of a queryless landing once the list loads", async () => {
    appStore.state.userInfo = { email: "f11@example.com" };
    __resetOrgSwitcherPrefsForTest();
    store.state.organizations = [];
    store.state.selectedOrganization = { identifier: "stale" };
    wrapper = await mountLayout("/");
    await flushPromises();

    store.state.organizations = [
      { identifier: "stale", name: "Stale" },
      { identifier: "linked", name: "Linked" },
    ];
    await flushPromises();
    expect(useOrgSwitcherPrefs().recents.value).toEqual(["stale"]);
  });

  it("F14 records the resolved org when org_identifier is repeated in the URL", async () => {
    store.state.organizations = [
      { identifier: "default", name: "Default" },
      { identifier: "acme", name: "Acme" },
    ];
    wrapper = await mountLayout("/?org_identifier=a&org_identifier=b");
    await flushPromises();
    expect(noteLanding).toHaveBeenCalledWith("default", ["default", "acme"]);
  });
});
