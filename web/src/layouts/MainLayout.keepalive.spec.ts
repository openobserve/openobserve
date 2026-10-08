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
import { defineComponent, h, onMounted } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

vi.mock("@/services/config", () => ({
  default: { get_config_full: vi.fn(() => new Promise(() => {})) },
}));
vi.mock("@openobserve/browser-rum", () => ({
  openobserveRum: { setUser: vi.fn(), startView: vi.fn() },
}));

import MainLayout from "./MainLayout.vue";

const StubDiv = defineComponent({ setup: () => () => h("div") });
const mounts: Record<string, number> = {};
const view = (name: string) =>
  defineComponent({
    name,
    setup() {
      onMounted(() => (mounts[name] = (mounts[name] ?? 0) + 1));
      return () => h("div", { "data-test": name });
    },
  });

describe("MainLayout — kept-alive modules", () => {
  let wrapper: VueWrapper | undefined;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it("keeps Product Analytics alive while the user visits another module, so Back reruns nothing (AC-19)", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: StubDiv },
        { path: "/pa", component: view("AppAnalytics") },
        { path: "/rum", component: view("RealUserMonitoring") },
      ],
    });
    await router.push("/pa");
    wrapper = mount(MainLayout, {
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
    (wrapper.vm as unknown as { isLoading: boolean }).isLoading = true;
    await flushPromises();
    expect(wrapper.find('[data-test="AppAnalytics"]').exists()).toBe(true);
    await router.push("/rum");
    await flushPromises();
    await router.push("/pa");
    await flushPromises();
    await router.push("/rum");
    await flushPromises();
    expect(mounts.AppAnalytics).toBe(1);
    expect(mounts.RealUserMonitoring).toBe(2);
  });
});
