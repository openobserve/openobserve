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
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { useLeaveGuard } from "@/lib/forms/SaveBar/useLeaveGuard";

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

describe("MainLayout — organization selection without an org list", () => {
  let wrapper: VueWrapper | undefined;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it("does not throw when the organizations list is missing", async () => {
    getOrgSettings.mockResolvedValue({ data: { data: {} } });
    wrapper = await mountLayout();
    await flushPromises();
    const saved = store.state.organizations;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    store.state.organizations = undefined;

    await (
      wrapper.vm as unknown as { setSelectedOrganization: () => Promise<void> }
    ).setSelectedOrganization();

    store.state.organizations = saved;
    expect(consoleError).not.toHaveBeenCalledWith(
      "Error in setSelectedOrganization:",
      expect.anything(),
    );
  });

  it("a header switch waits for the unsaved-changes answer, and cancelling keeps the organization", async () => {
    getOrgSettings.mockResolvedValue({ data: { data: {} } });
    wrapper = await mountLayout();
    await flushPromises();
    const layout = wrapper.vm as unknown as {
      selectedOrg: { identifier?: string };
      updateOrganization: () => Promise<void>;
    };
    const current = store.state.selectedOrganization;
    const dirtyPage = mount(
      defineComponent({
        setup() {
          useLeaveGuard(() => true);
          return () => h("div");
        },
      }),
    );
    const dialog = useConfirmDialog();
    const pickOther = async () => {
      layout.selectedOrg = { identifier: "other-org" };
      const switching = layout.updateOrganization();
      await flushPromises();
      return switching;
    };

    const cancelled = pickOther();
    await flushPromises();
    expect(dialog.currentDialog.value).not.toBeNull();
    expect(store.state.selectedOrganization.identifier).toBe(current.identifier);
    dialog.handleCancel();
    await cancelled;
    expect(store.state.selectedOrganization.identifier).toBe(current.identifier);
    expect(layout.selectedOrg.identifier).toBe(current.identifier);

    const confirmed = pickOther();
    await flushPromises();
    dialog.handleConfirm();
    await confirmed;
    expect(store.state.selectedOrganization.identifier).toBe("other-org");

    dirtyPage.unmount();
    store.state.selectedOrganization = current;
  });
});
