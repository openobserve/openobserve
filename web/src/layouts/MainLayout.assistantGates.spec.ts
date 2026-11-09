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

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import { queryClient } from "@/composables/query/queryClient";
import { resetAssistantV2ForTests } from "@/composables/assistant/flags";

const getOrgSettings = vi.fn();
const getConfigFull = vi.fn((): Promise<unknown> => new Promise(() => {}));

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
  useHomeDashboard: () => ({ load: () => new Promise(() => {}) }),
}));

import MainLayout from "./MainLayout.vue";

const StubDiv = defineComponent({ setup: () => () => h("div") });
const Page = defineComponent({
  name: "AssistantGatesPage",
  setup: () => () => h("div", { "data-test": "assistant-gates-page" }),
});

const mountLayout = async (meta: Record<string, unknown> = {}) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", name: "page", component: Page, meta }],
  });
  await router.push("/");
  return mount(MainLayout, {
    global: {
      plugins: [store, i18n, router],
      stubs: {
        AppHeader: StubDiv,
        ONavbar: StubDiv,
        O2AIChat: StubDiv,
        AssistantSidebarHost: StubDiv,
        AssistantWindowLayer: StubDiv,
        AssistantSkipLink: StubDiv,
        HomeReturnBar: StubDiv,
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
};

const pageShown = (w: VueWrapper) => w.find('[data-test="assistant-gates-page"]').exists();
const pendingShown = (w: VueWrapper) => w.find('[data-test="main-content-pending"]').exists();

describe("MainLayout — page gates with the assistant flag on", () => {
  let wrapper: VueWrapper | undefined;
  let savedConfig: Record<string, unknown>;
  const savedOrgs = store.state.organizations;

  beforeAll(() => {
    window.__O2_ASSISTANT_V2__ = true;
    resetAssistantV2ForTests();
  });

  beforeEach(() => {
    localStorage.clear();
    savedConfig = store.state.zoConfig;
    store.state.userInfo = { ...store.state.userInfo, email: "gates@example.com" };
    store.state.organizations = [
      {
        id: 1,
        name: "Default",
        identifier: "default",
        type: "default",
        UserObj: { email: "gates@example.com" },
      },
    ];
    getOrgSettings.mockResolvedValue({ data: { data: {} } });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    queryClient.clear();
    getOrgSettings.mockReset();
    getConfigFull.mockReset();
    getConfigFull.mockImplementation(() => new Promise(() => {}));
    store.state.zoConfig = savedConfig;
    store.state.organizations = savedOrgs;
  });

  it("puts a license-locked page behind its feature lock", async () => {
    store.state.zoConfig = { ...savedConfig, features: { alerts: "locked" } };
    wrapper = await mountLayout({ licenseFeature: "alerts" });
    await flushPromises();
    const boundary = wrapper.find('[data-test="feature-lock-boundary"]');
    expect(boundary.attributes("data-locked-feature")).toBe("alerts");
    expect(boundary.find('[data-test="assistant-gates-page"]').exists()).toBe(true);
  });

  it("holds the page behind the skeleton until the full config lands", async () => {
    store.state.zoConfig = { commit_hash: "abc" };
    let land: (v: unknown) => void = () => {};
    getConfigFull.mockReturnValue(new Promise((r) => (land = r)));
    wrapper = await mountLayout();
    await flushPromises();
    expect(pendingShown(wrapper)).toBe(true);
    expect(pageShown(wrapper)).toBe(false);

    land({ data: { version: "v1", ai_enabled: true, rum: { enabled: false } } });
    await flushPromises();
    expect(pageShown(wrapper)).toBe(true);
  });
});
