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
import config from "@/aws-exports";

vi.mock("@/services/config", () => ({
  default: { get_config_full: vi.fn(() => new Promise(() => {})) },
}));
vi.mock("@openobserve/browser-rum", () => ({
  openobserveRum: { setUser: vi.fn(), startView: vi.fn() },
}));

import MainLayout from "./MainLayout.vue";

const StubDiv = defineComponent({ setup: () => () => h("div") });
const tagged = (test: string) =>
  defineComponent({ setup: () => () => h("div", { "data-test": test }) });
const SidebarHost = tagged("assistant-sidebar-host");

describe("MainLayout — the assistant shell in kiosk and focus mode", () => {
  let wrapper: VueWrapper | undefined;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    store.state.kioskMode = false;
  });

  const mountLayout = async (kioskMode: boolean, meta: Record<string, unknown> = {}) => {
    store.state.kioskMode = kioskMode;
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: StubDiv, meta }],
    });
    await router.push("/");
    wrapper = mount(MainLayout, {
      global: {
        plugins: [store, i18n, router],
        stubs: {
          AppHeader: StubDiv,
          ONavbar: StubDiv,
          AssistantSidebarHost: SidebarHost,
          AssistantWindowLayer: tagged("assistant-window-layer"),
          AssistantSkipLink: StubDiv,
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
          PaidOverageConsentDialog: tagged("paid-overage-consent"),
        },
      },
    });
    await flushPromises();
    return wrapper;
  };

  it("drops the gutter, card chrome and assistant sidebar in kiosk mode", async () => {
    const layout = await mountLayout(true);
    const main = layout.find('[data-test="main-content"]');
    expect(main.classes()).not.toContain("pe-2");
    expect(main.find("div").classes()).not.toContain("shadow-md");
    expect(layout.find('[data-test="assistant-sidebar-host"]').exists()).toBe(false);
  });

  it("keeps them outside kiosk mode", async () => {
    const layout = await mountLayout(false);
    const main = layout.find('[data-test="main-content"]');
    expect(main.classes()).toContain("pe-2");
    expect(main.find("div").classes()).toContain("shadow-md");
    expect(layout.find('[data-test="assistant-sidebar-host"]').exists()).toBe(true);
  });

  it("mounts no assistant sidebar or window on a focus-mode route", async () => {
    const layout = await mountLayout(false, { focusMode: true });
    expect(layout.find('[data-test="assistant-sidebar-host"]').exists()).toBe(false);
    expect(layout.find('[data-test="assistant-window-layer"]').exists()).toBe(false);
  });
});

describe("MainLayout — the paid overage consent dialog", () => {
  let wrapper: VueWrapper | undefined;
  const savedCloud = config.isCloud;
  const savedConfig = store.state.zoConfig;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    config.isCloud = savedCloud;
    store.state.zoConfig = savedConfig;
  });

  const mountLayout = async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: StubDiv }],
    });
    await router.push("/");
    wrapper = mount(MainLayout, {
      global: {
        plugins: [store, i18n, router],
        stubs: {
          AppHeader: StubDiv,
          ONavbar: StubDiv,
          AssistantSidebarHost: StubDiv,
          AssistantWindowLayer: StubDiv,
          AssistantSkipLink: StubDiv,
          WebinarBanner: StubDiv,
          AnnouncementBanner: StubDiv,
          ShortcutCheatsheet: StubDiv,
          CommunitySlackInvite: StubDiv,
          ThemeSwitcher: StubDiv,
          PredefinedThemes: StubDiv,
          SlackIcon: StubDiv,
          ManagementIcon: StubDiv,
          ODialog: StubDiv,
          PaidOverageConsentDialog: tagged("paid-overage-consent"),
        },
      },
    });
    await flushPromises();
    return wrapper;
  };

  it("stays off a self-hosted build that bills", async () => {
    config.isCloud = "false";
    store.state.zoConfig = { ...savedConfig, billing_enabled: true };
    const layout = await mountLayout();
    expect(layout.find('[data-test="paid-overage-consent"]').exists()).toBe(false);
  });

  it("mounts on cloud", async () => {
    config.isCloud = "true";
    const layout = await mountLayout();
    expect(layout.find('[data-test="paid-overage-consent"]').exists()).toBe(true);
  });
});
