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
import { defineComponent, h, inject } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import { queryClient } from "@/composables/query/queryClient";
import {
  FIRST_DATA_NOTICE,
  writeFirstDataRecord,
} from "@/composables/firstEvent/useFirstDataNotice";

const getStreams = vi.fn();

vi.mock("@/services/config", () => ({
  default: { get_config_full: vi.fn(() => new Promise(() => {})) },
}));
vi.mock("@openobserve/browser-rum", () => ({
  openobserveRum: { setUser: vi.fn(), startView: vi.fn() },
}));
vi.mock("@/composables/useHomeDashboard", () => ({
  useHomeDashboard: () => ({ load: vi.fn(async () => undefined) }),
}));
vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: (...args: unknown[]) => getStreams(...args),
    resetStreams: vi.fn(),
  }),
}));

import MainLayout from "./MainLayout.vue";

const StubDiv = defineComponent({ setup: () => () => h("div") });
const NoticeStub = defineComponent({
  setup: () => () => h("div", { "data-test": "layout-notice" }),
});
// Home draws the notice under its own header from the injected state
const HomeStub = defineComponent({
  setup: () => {
    const notice = inject(FIRST_DATA_NOTICE, null);
    return () => h("div", { "data-test": "home-notice", "data-visible": notice?.visible.value });
  },
});

const mountLayout = async (path: string) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: HomeStub, meta: { allowOnEmptyData: true } },
      { path: "/logs", name: "logs", component: StubDiv, meta: { allowOnEmptyData: true } },
      { path: "/alerts", name: "alertList", component: StubDiv },
      { path: "/ingestion", name: "ingestion", component: StubDiv },
    ],
  });
  await router.push(path);
  const push = vi.spyOn(router, "push");
  const wrapper = mount(MainLayout, {
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
        FirstDataNotice: NoticeStub,
      },
    },
  });
  return { wrapper, router, push };
};

const verify = (wrapper: VueWrapper) =>
  (
    wrapper.vm as unknown as { verifyStreamExist: (org: unknown) => Promise<void> }
  ).verifyStreamExist(store.state.selectedOrganization);

describe("MainLayout — empty-data check", () => {
  let wrapper: VueWrapper | undefined;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    queryClient.clear();
    getStreams.mockReset();
    store.state.organizationData.isDataIngested = false;
  });

  it.each([
    ["/", true, "/"],
    ["/logs", true, "/logs"],
    ["/alerts", true, "/ingestion"],
    ["/alerts", false, "/alerts"],
  ])(
    "records an empty org on %s (flag %s) and lands on %s, as in-app navigation would",
    async (path, flagOn, landing) => {
      const flag = store.state.zoConfig.restricted_routes_on_empty_data;
      store.state.zoConfig.restricted_routes_on_empty_data = flagOn;
      getStreams.mockResolvedValue({ list: [{ name: "usage", stream_type: "logs" }] });
      try {
        const mounted = await mountLayout(path);
        wrapper = mounted.wrapper;
        await flushPromises();

        await verify(wrapper);
        await flushPromises();

        expect(store.state.organizationData.isDataIngested).toBe(false);
        expect(mounted.router.currentRoute.value.path).toBe(landing);
      } finally {
        store.state.zoConfig.restricted_routes_on_empty_data = flag;
      }
    },
  );

  it("does not bounce when the org moved on before its list answered", async () => {
    const flag = store.state.zoConfig.restricted_routes_on_empty_data;
    const selected = store.state.selectedOrganization;
    store.state.zoConfig.restricted_routes_on_empty_data = true;
    let answer: (v: unknown) => void = () => {};
    getStreams.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    try {
      const mounted = await mountLayout("/alerts");
      wrapper = mounted.wrapper;
      await flushPromises();
      const pending = verify(wrapper);
      store.state.selectedOrganization = { identifier: "moved_on", label: "moved_on" };
      answer({ list: [] });
      await pending;
      await flushPromises();
      expect(mounted.router.currentRoute.value.path).toBe("/alerts");
    } finally {
      store.state.zoConfig.restricted_routes_on_empty_data = flag;
      store.state.selectedOrganization = selected;
    }
  });

  it("records data when a user stream exists", async () => {
    getStreams.mockResolvedValue({ list: [{ name: "default", stream_type: "logs" }] });
    const mounted = await mountLayout("/logs");
    wrapper = mounted.wrapper;
    await flushPromises();

    await verify(wrapper);

    expect(store.state.organizationData.isDataIngested).toBe(true);
  });

  it.each([
    ["/", false],
    ["/logs", true],
  ])("draws the next-visit banner in the layout on %s: %s", async (path, inLayout) => {
    const flag = store.state.zoConfig.restricted_routes_on_empty_data;
    const selected = store.state.selectedOrganization;
    store.state.zoConfig.restricted_routes_on_empty_data = true;
    getStreams.mockResolvedValue({
      list: [{ name: "default", stream_type: "logs", stats: { created_at: 5 } }],
    });
    try {
      const mounted = await mountLayout(path);
      wrapper = mounted.wrapper;
      await flushPromises();
      store.state.selectedOrganization = { identifier: "notice_org", label: "notice_org" };
      writeFirstDataRecord("notice_org", { lastVisit: 1, hadData: false });
      await verify(wrapper);
      (wrapper.vm as unknown as { isLoading: boolean }).isLoading = true;
      await flushPromises();
      expect(wrapper.find('[data-test="layout-notice"]').exists()).toBe(inLayout);
      if (!inLayout) {
        expect(wrapper.find('[data-test="home-notice"]').attributes("data-visible")).toBe("true");
      }
    } finally {
      store.state.zoConfig.restricted_routes_on_empty_data = flag;
      store.state.selectedOrganization = selected;
      localStorage.clear();
    }
  });
});
