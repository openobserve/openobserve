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
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import { queryClient } from "@/composables/query/queryClient";

const getOrgSettings = vi.fn();

vi.mock("@/services/config", () => ({
  default: { get_config_full: vi.fn(() => new Promise(() => {})) },
}));
vi.mock("@openobserve/browser-rum", () => ({
  openobserveRum: { setUser: vi.fn(), startView: vi.fn() },
}));
vi.mock("@/services/organizations", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    default: {
      ...actual.default,
      get_organization_settings: (...args: unknown[]) => getOrgSettings(...args),
    },
  };
});
vi.mock("@/composables/useHomeDashboard", () => ({
  useHomeDashboard: () => ({ load: vi.fn(async () => undefined) }),
}));

import MainLayout from "./MainLayout.vue";

const StubDiv = defineComponent({ setup: () => () => h("div") });

const mountLayout = async (start: string, router: Router) => {
  await router.push(start);
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

const makeRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: StubDiv },
      { path: "/dashboards", component: StubDiv },
      { path: "/dashboards/view", component: StubDiv },
      { path: "/dashboards/add_panel", component: StubDiv },
      { path: "/alerts", component: StubDiv },
    ],
  });

type LayoutVm = { selectedOrg: any; updateOrganization: () => Promise<void> };

describe("MainLayout — org switch", () => {
  let wrapper: VueWrapper | undefined;
  const oldOrg = { ...store.state.selectedOrganization };
  const newOrg = { ...oldOrg, identifier: "_meta", label: "_meta", name: "_meta" };

  beforeEach(() => {
    getOrgSettings.mockResolvedValue({ data: { data: {} } });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    queryClient.clear();
    getOrgSettings.mockReset();
    store.state.selectedOrganization = { ...oldOrg };
  });

  const switchOrg = async (router: Router, start: string) => {
    wrapper = await mountLayout(start, router);
    await flushPromises();
    const vm = wrapper.vm as unknown as LayoutVm;
    // Mount-time org bootstrap depends on the org list, so pin the starting org here.
    store.state.selectedOrganization = { ...oldOrg };
    vm.selectedOrg = { ...newOrg };
    await vm.updateOrganization();
    await flushPromises();
    return vm;
  };

  it("leaves a dashboard page for the new org's dashboard list before the org changes", async () => {
    const router = makeRouter();
    const orgAtNavigation: string[] = [];
    router.afterEach(() => {
      orgAtNavigation.push(store.state.selectedOrganization.identifier);
    });
    await switchOrg(
      router,
      `/dashboards/view?org_identifier=${oldOrg.identifier}&dashboard=d1&folder=default&tab=default`,
    );

    expect(router.currentRoute.value.path).toBe("/dashboards");
    expect(router.currentRoute.value.query).toEqual({ org_identifier: "_meta" });
    expect(store.state.selectedOrganization.identifier).toBe("_meta");
    // The last navigation (the org switch) finished while the old org was still selected,
    // so the dashboard page never remounts with the new org and the old dashboard id.
    expect(orgAtNavigation.at(-1)).toBe(oldOrg.identifier);
  });

  it("keeps the old org when a leave guard cancels the move off the panel editor", async () => {
    const router = makeRouter();
    await router.push("/dashboards/add_panel?dashboard=d1");
    router.beforeEach((to) => (to.path === "/dashboards" ? false : true));
    const vm = await switchOrg(router, "/dashboards/add_panel?dashboard=d1");

    expect(router.currentRoute.value.path).toBe("/dashboards/add_panel");
    expect(store.state.selectedOrganization.identifier).toBe(oldOrg.identifier);
    expect(vm.selectedOrg.identifier).toBe(oldOrg.identifier);
  });

  it("keeps the path of other pages and sets only the new org", async () => {
    const router = makeRouter();
    await switchOrg(router, `/alerts?org_identifier=${oldOrg.identifier}&folder=f1`);

    expect(router.currentRoute.value.path).toBe("/alerts");
    expect(router.currentRoute.value.query).toEqual({ org_identifier: "_meta" });
    expect(store.state.selectedOrganization.identifier).toBe("_meta");
  });
});
