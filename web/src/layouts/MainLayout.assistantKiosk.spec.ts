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

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import { resetAssistantV2ForTests } from "@/composables/assistant/flags";

vi.mock("@/services/config", () => ({
  default: { get_config_full: vi.fn(() => new Promise(() => {})) },
}));
vi.mock("@openobserve/browser-rum", () => ({
  openobserveRum: { setUser: vi.fn(), startView: vi.fn() },
}));

import MainLayout from "./MainLayout.vue";

const StubDiv = defineComponent({ setup: () => () => h("div") });
const SidebarHost = defineComponent({
  setup: () => () => h("div", { "data-test": "assistant-sidebar-host" }),
});

describe("MainLayout — assistant v2 in kiosk mode", () => {
  let wrapper: VueWrapper | undefined;

  beforeAll(() => {
    window.__O2_ASSISTANT_V2__ = true;
    resetAssistantV2ForTests();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    store.state.kioskMode = false;
  });

  const mountLayout = async (kioskMode: boolean) => {
    store.state.kioskMode = kioskMode;
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
          O2AIChat: StubDiv,
          AssistantSidebarHost: SidebarHost,
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
          PaidOverageConsentDialog: StubDiv,
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
});
