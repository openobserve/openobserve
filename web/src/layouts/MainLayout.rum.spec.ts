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
import config from "@/aws-exports";
import { openobserveRum } from "@openobserve/browser-rum";

vi.mock("@/services/config", () => ({
  default: { get_config_full: vi.fn(() => new Promise(() => {})) },
}));

vi.mock("@/utils/zincutils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/zincutils")>()),
  invalidateLoginData: vi.fn(),
}));

vi.mock("@openobserve/browser-rum", () => ({
  openobserveRum: {
    setUser: vi.fn(),
    setAccount: vi.fn(),
    clearUser: vi.fn(),
    clearAccount: vi.fn(),
    stopSessionReplayRecording: vi.fn(),
    startSessionReplayRecording: vi.fn(),
    startView: vi.fn(),
  },
}));

import MainLayout from "./MainLayout.vue";

const StubDiv = defineComponent({ setup: () => () => h("div") });

function mountMainLayout() {
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
        "router-view": StubDiv,
      },
    },
  });
}

describe("MainLayout — RUM identity and account", () => {
  let wrapper: VueWrapper | undefined;
  const originalIsCloud = config.isCloud;
  const originalIsEnterprise = config.isEnterprise;
  const originalOrg = store.state.selectedOrganization;
  const originalZoConfig = store.state.zoConfig;
  const originalUserInfo = store.state.userInfo;

  beforeEach(() => {
    vi.clearAllMocks();
    config.isCloud = "false";
    config.isEnterprise = "false";
    store.state.zoConfig = { ...originalZoConfig, version: "v1", rum: { enabled: true } };
    store.state.selectedOrganization = {
      label: "Acme",
      identifier: "acme",
      subscription_type: "pay-as-you-go",
    };
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    config.isCloud = originalIsCloud;
    config.isEnterprise = originalIsEnterprise;
    store.state.zoConfig = originalZoConfig;
    store.state.selectedOrganization = originalOrg;
    store.state.userInfo = originalUserInfo;
  });

  it("identifies the RUM user by email", async () => {
    wrapper = mountMainLayout();
    await flushPromises();

    expect(openobserveRum.setUser).toHaveBeenCalledWith({
      id: "example@gmail.com",
      name: "example example",
      email: "example@gmail.com",
    });
  });

  it("sets the RUM account to the selected org on mount", async () => {
    wrapper = mountMainLayout();
    await flushPromises();

    expect(openobserveRum.setAccount).toHaveBeenCalledWith({
      id: "acme",
      name: "Acme",
      subscription_type: "pay-as-you-go",
    });
  });

  it("ignores a re-dispatch of the same org and updates for a new org", async () => {
    wrapper = mountMainLayout();
    await flushPromises();
    // Mount clears the org when the router's org_identifier query differs, so re-select it.
    store.state.selectedOrganization = { label: "Acme", identifier: "acme", subscription_type: "" };
    await flushPromises();
    expect(openobserveRum.setAccount).toHaveBeenLastCalledWith({
      id: "acme",
      name: "Acme",
      subscription_type: "",
    });
    vi.mocked(openobserveRum.setAccount).mockClear();

    store.state.selectedOrganization = { ...store.state.selectedOrganization };
    await flushPromises();
    expect(openobserveRum.setAccount).not.toHaveBeenCalled();

    store.state.selectedOrganization = { label: "Beta", identifier: "beta", subscription_type: "" };
    await flushPromises();
    expect(openobserveRum.setAccount).toHaveBeenCalledWith({
      id: "beta",
      name: "Beta",
      subscription_type: "",
    });
  });

  it("updates the RUM account when the org is renamed or changes plan", async () => {
    wrapper = mountMainLayout();
    await flushPromises();
    store.state.selectedOrganization = { label: "Acme", identifier: "acme", subscription_type: "" };
    await flushPromises();
    vi.mocked(openobserveRum.setAccount).mockClear();

    store.state.selectedOrganization = {
      label: "Acme Inc",
      identifier: "acme",
      subscription_type: "enterprise",
    };
    await flushPromises();

    expect(openobserveRum.setAccount).toHaveBeenCalledTimes(1);
    expect(openobserveRum.setAccount).toHaveBeenCalledWith({
      id: "acme",
      name: "Acme Inc",
      subscription_type: "enterprise",
    });
  });

  it("clears the RUM user and account on sign out", async () => {
    wrapper = mountMainLayout();
    await flushPromises();

    (wrapper.vm as any).signout();

    expect(openobserveRum.stopSessionReplayRecording).toHaveBeenCalled();
    expect(openobserveRum.clearUser).toHaveBeenCalled();
    expect(openobserveRum.clearAccount).toHaveBeenCalled();
  });

  it("sets the RUM account once RUM is enabled after the org is already selected", async () => {
    store.state.zoConfig = { ...originalZoConfig, version: "v1" };
    wrapper = mountMainLayout();
    await flushPromises();
    store.state.selectedOrganization = { label: "Acme", identifier: "acme", subscription_type: "" };
    await flushPromises();
    expect(openobserveRum.setAccount).not.toHaveBeenCalled();

    store.state.zoConfig = { ...store.state.zoConfig, rum: { enabled: true } };
    await flushPromises();

    expect(openobserveRum.setAccount).toHaveBeenCalledWith({
      id: "acme",
      name: "Acme",
      subscription_type: "",
    });
  });

  it("does not set the RUM account when RUM is disabled", async () => {
    store.state.zoConfig = { ...originalZoConfig, version: "v1", rum: { enabled: false } };

    wrapper = mountMainLayout();
    await flushPromises();

    expect(openobserveRum.setAccount).not.toHaveBeenCalled();
  });
});
