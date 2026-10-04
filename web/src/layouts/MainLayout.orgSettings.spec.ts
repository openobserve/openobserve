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
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
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

const mountLayout = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: StubDiv }],
  });
  await router.push("/");
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
        GetStarted: StubDiv,
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

describe("MainLayout — organization settings load", () => {
  let wrapper: VueWrapper | undefined;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    queryClient.clear();
    getOrgSettings.mockReset();
  });

  it.each([true, false])(
    "copies red_insights_enabled=%s from the server into the store",
    async (enabled) => {
      getOrgSettings.mockResolvedValue({ data: { data: { red_insights_enabled: enabled } } });
      wrapper = await mountLayout();
      await flushPromises();
      queryClient.clear();
      await (
        wrapper.vm as unknown as { getOrganizationSettings: () => Promise<void> }
      ).getOrganizationSettings();
      expect(getOrgSettings).toHaveBeenCalled();
      expect(store.state.organizationData.organizationSettings.red_insights_enabled).toBe(enabled);
    },
  );

  it("defaults red_insights_enabled to false when the server omits it", async () => {
    getOrgSettings.mockResolvedValue({ data: { data: {} } });
    wrapper = await mountLayout();
    await flushPromises();
    queryClient.clear();
    await (
      wrapper.vm as unknown as { getOrganizationSettings: () => Promise<void> }
    ).getOrganizationSettings();
    expect(store.state.organizationData.organizationSettings.red_insights_enabled).toBe(false);
  });
});
