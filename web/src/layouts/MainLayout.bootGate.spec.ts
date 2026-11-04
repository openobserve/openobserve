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
import { createMemoryHistory, createRouter } from "vue-router";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import { queryClient } from "@/composables/query/queryClient";

const getOrgSettings = vi.fn();
const getConfigFull = vi.fn((): Promise<unknown> => new Promise(() => {}));
const loadHomeDashboard = vi.fn(() => new Promise(() => {}));

vi.mock("@/services/config", () => ({
  default: { get_config_full: (...args: unknown[]) => getConfigFull(...args) },
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
  useHomeDashboard: () => ({ load: loadHomeDashboard }),
}));

import MainLayout from "./MainLayout.vue";

const StubDiv = defineComponent({ setup: () => () => h("div") });
const Page = defineComponent({
  name: "BootGatePage",
  setup: () => () => h("div", { "data-test": "boot-gate-page" }),
});

const deferred = () => {
  let resolve: (v: unknown) => void = () => {};
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const settings = (data: Record<string, unknown>) => ({ data: { data } });

const mountLayout = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", name: "page", component: Page }],
  });
  await router.push("/");
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
      },
    },
  });
  return { wrapper };
};

const pageShown = (w: VueWrapper) => w.find('[data-test="boot-gate-page"]').exists();
const pendingShown = (w: VueWrapper) => w.find('[data-test="main-content-pending"]').exists();

describe("MainLayout — boot gate", () => {
  let wrapper: VueWrapper | undefined;
  const savedOrgs = store.state.organizations;

  beforeEach(() => {
    localStorage.clear();
    store.state.userInfo = { ...store.state.userInfo, email: "boot@example.com" };
    store.state.organizations = [
      {
        id: 1,
        name: "Default",
        identifier: "default",
        type: "default",
        UserObj: { email: "boot@example.com" },
      },
    ];
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    queryClient.clear();
    getOrgSettings.mockReset();
    loadHomeDashboard.mockClear();
    store.state.organizations = savedOrgs;
  });

  it("mounts the page once settings land, without waiting for the home dashboard", async () => {
    getOrgSettings.mockResolvedValue(settings({}));
    ({ wrapper } = await mountLayout());
    await flushPromises();
    expect(loadHomeDashboard).toHaveBeenCalledWith("default");
    expect(pageShown(wrapper)).toBe(true);
  });

  it("shows the content skeleton instead of a blank card while settings load", async () => {
    const answer = deferred();
    getOrgSettings.mockReturnValue(answer.promise);
    ({ wrapper } = await mountLayout());
    await flushPromises();
    expect(pendingShown(wrapper)).toBe(true);
    expect(pageShown(wrapper)).toBe(false);

    answer.resolve(settings({}));
    await flushPromises();
    expect(pendingShown(wrapper)).toBe(false);
    expect(pageShown(wrapper)).toBe(true);
  });

  it("ignores a settings answer for an org the user already switched away from", async () => {
    const forDefault = deferred();
    const forNext = deferred();
    getOrgSettings.mockImplementation((org: string) =>
      org === "default" ? forDefault.promise : forNext.promise,
    );
    ({ wrapper } = await mountLayout());
    await flushPromises();
    store.dispatch("setSelectedOrganization", { identifier: "next-org", label: "Next" });
    await flushPromises();

    forDefault.resolve(settings({ scrape_interval: 99 }));
    await flushPromises();
    expect(pageShown(wrapper)).toBe(false);
    expect(pendingShown(wrapper)).toBe(true);
    expect(store.state.organizationData.organizationSettings.scrape_interval).not.toBe(99);

    forNext.resolve(settings({ scrape_interval: 30 }));
    await flushPromises();
    expect(pageShown(wrapper)).toBe(true);
    expect(store.state.organizationData.organizationSettings.scrape_interval).toBe(30);
  });

  describe("before the full config has landed", () => {
    let savedConfig: Record<string, unknown>;
    beforeEach(() => {
      savedConfig = store.state.zoConfig;
      store.state.zoConfig = { commit_hash: "abc" };
      getOrgSettings.mockResolvedValue(settings({}));
    });
    afterEach(() => {
      store.state.zoConfig = savedConfig;
      getConfigFull.mockReset();
      getConfigFull.mockImplementation(() => new Promise(() => {}));
    });

    it("mounts the page only once the full config lands, so pages see its flags", async () => {
      const answer = deferred();
      getConfigFull.mockReturnValue(answer.promise);
      ({ wrapper } = await mountLayout());
      await flushPromises();
      expect(pendingShown(wrapper)).toBe(true);
      expect(pageShown(wrapper)).toBe(false);

      answer.resolve({ data: { version: "v1", ai_enabled: true, rum: { enabled: false } } });
      await flushPromises();
      expect(pageShown(wrapper)).toBe(true);
    });

    it("still mounts the page when the full config fails", async () => {
      getConfigFull.mockRejectedValue(new Error("down"));
      ({ wrapper } = await mountLayout());
      await flushPromises();
      expect(pageShown(wrapper)).toBe(true);
    });
  });
});
