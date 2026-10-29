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

import { describe, it, expect, vi, afterEach } from "vitest";
import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import PinnedDashboardTab from "./PinnedDashboardTab.vue";
import { getDashboard } from "@/utils/commons";

vi.mock("@/utils/commons", () => ({
  getDashboard: vi.fn(async () => ({ title: "Pinned", tabs: [{ tabId: "t1", panels: [] }] })),
}));

describe("PinnedDashboardTab", () => {
  let wrapper: VueWrapper<any>;
  let store: any;

  const mountTab = async (features: Record<string, string> = {}) => {
    store = createStore({
      state: { zoConfig: { features }, selectedOrganization: { identifier: "o1" } },
    });
    wrapper = mount(PinnedDashboardTab, {
      props: { dashboardId: "d1", folderId: "default" },
      global: {
        plugins: [
          store,
          createI18n({
            legacy: false,
            locale: "en",
            messages: { en: { common: { refresh: "Refresh" } } },
          }),
        ],
        stubs: {
          LicenseDeniedState: {
            name: "LicenseDeniedState",
            props: ["features"],
            template: '<div v-bind="$attrs" />',
          },
          RenderDashboardCharts: true,
          DateTimePickerDashboard: true,
          AutoRefreshInterval: true,
          OSkeleton: true,
          OTooltip: { name: "OTooltip", props: ["content", "disabled"], template: "<slot />" },
          OButton: {
            name: "OButton",
            props: ["variant", "size", "iconLeft"],
            template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
          },
        },
      },
    });
    await flushPromises();
  };

  const refreshButton = () =>
    wrapper
      .findAllComponents({ name: "OButton" })
      .find((b) => b.attributes("data-test") === "pinned-dashboard-refresh-btn")!;

  afterEach(() => {
    wrapper?.unmount();
    vi.mocked(getDashboard).mockClear();
  });

  it("shows the license-denied state and loads nothing when dashboards are locked", async () => {
    await mountTab({ dashboards: "locked" });

    const denied = wrapper.findComponent({ name: "LicenseDeniedState" });
    expect(denied.exists()).toBe(true);
    expect(denied.props("features")).toEqual(["dashboards"]);
    expect(getDashboard).not.toHaveBeenCalled();
    expect(wrapper.emitted("unavailable")).toBeUndefined();
  });

  it("never emits unavailable for a license 403 that beat the config, and shows the license state", async () => {
    vi.mocked(getDashboard).mockRejectedValueOnce({
      response: { status: 403, data: { code: 40001, error_detail: "dashboards" } },
    });
    await mountTab();

    expect(wrapper.emitted("unavailable")).toBeUndefined();
    expect(wrapper.findComponent({ name: "LicenseDeniedState" }).props("features")).toEqual([
      "dashboards",
    ]);
  });

  it("still emits unavailable for a dashboard that is really gone", async () => {
    vi.mocked(getDashboard).mockRejectedValueOnce({ response: { status: 404 } });
    await mountTab();

    expect(wrapper.emitted("unavailable")).toEqual([["d1"]]);
  });

  it("drops the dashboard and shows the license state when the lock arrives late", async () => {
    await mountTab();
    expect(wrapper.findComponent({ name: "LicenseDeniedState" }).exists()).toBe(false);

    store.state.zoConfig = { features: { dashboards: "locked" } };
    await flushPromises();

    expect(wrapper.findComponent({ name: "LicenseDeniedState" }).exists()).toBe(true);
    expect(wrapper.find('[data-test="pinned-dashboard-refresh-btn"]').exists()).toBe(false);
    expect(wrapper.emitted("unavailable")).toBeUndefined();
  });

  it("loads the dashboard when dashboards are enabled", async () => {
    await mountTab({ dashboards: "enabled" });

    expect(wrapper.findComponent({ name: "LicenseDeniedState" }).exists()).toBe(false);
    expect(getDashboard).toHaveBeenCalledTimes(1);
  });

  it("shows Refresh as a labelled primary button", async () => {
    await mountTab();

    expect(refreshButton().props("variant")).toBe("primary");
    expect(refreshButton().props("size")).toBe("sm-toolbar");
    expect(refreshButton().text()).toContain("Refresh");
  });

  it("keeps the tooltip off while the label is visible", async () => {
    await mountTab();

    const tooltip = wrapper
      .findAllComponents({ name: "OTooltip" })
      .find((tip) => tip.find('[data-test="pinned-dashboard-refresh-btn"]').exists())!;
    expect(tooltip.props("disabled")).toBe(true);
  });
});
