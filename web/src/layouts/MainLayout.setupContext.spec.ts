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
import { queryClient } from "@/composables/query/queryClient";

vi.mock("@/services/config", () => ({
  default: {
    get_config_full: vi.fn(() =>
      Promise.resolve({ data: { version: "v1", rum: { enabled: false } } }),
    ),
  },
}));

vi.mock("@/services/organizations", () => ({
  default: {
    os_list: vi.fn(() => Promise.resolve({ data: { data: [] } })),
    list: vi.fn(() => Promise.resolve({ data: { data: [] } })),
  },
}));

import organizationService from "@/services/organizations";
import MainLayout from "./MainLayout.vue";

const StubDiv = defineComponent({ setup: () => () => h("div") });

const mountMainLayout = () =>
  mount(MainLayout, {
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

const setupContextWarnings = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls
    .map((args) => String(args[0]))
    .filter((msg) => msg.includes("inject()") || msg.includes("no active component instance"));

describe("MainLayout — layout mixin runs inside setup()", () => {
  let wrapper: VueWrapper | undefined;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  const originalOrg = store.state.selectedOrganization;
  const originalZoConfig = store.state.zoConfig;

  beforeEach(async () => {
    vi.clearAllMocks();
    await router.push({ path: "/", query: { org_identifier: "acme" } });
    queryClient.clear();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    store.state.selectedOrganization = { label: "Acme", identifier: "acme" };
    // No version yet, so mount fetches the full config, as on a fresh page load.
    store.state.zoConfig = { ...originalZoConfig, version: "" };
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    warnSpy.mockRestore();
    store.state.selectedOrganization = originalOrg;
    store.state.zoConfig = originalZoConfig;
  });

  it("adds the pipeline link after the full config loads without setup-context warnings", async () => {
    wrapper = mountMainLayout();
    await flushPromises();

    expect(setupContextWarnings(warnSpy)).toEqual([]);
    expect((wrapper.vm as any).linksList.some((l: any) => l.name === "pipeline")).toBe(true);
    // The mixin's onMounted loads the org list that names the selected org in the header.
    expect(organizationService.os_list).toHaveBeenCalledTimes(1);
  });

  it("refetches organizations on ?update_org without setup-context warnings", async () => {
    wrapper = mountMainLayout();
    await flushPromises();
    warnSpy.mockClear();

    await router.push({ query: { ...router.currentRoute.value.query, update_org: "1" } });
    await flushPromises();

    expect(setupContextWarnings(warnSpy)).toEqual([]);
  });
});
