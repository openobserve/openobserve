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

vi.mock("@/utils/commons", () => ({
  getDashboard: vi.fn(async () => ({ title: "Pinned", tabs: [{ tabId: "t1", panels: [] }] })),
}));

describe("PinnedDashboardTab", () => {
  let wrapper: VueWrapper<any>;

  const mountTab = async () => {
    wrapper = mount(PinnedDashboardTab, {
      props: { dashboardId: "d1", folderId: "default" },
      global: {
        plugins: [
          createStore({ state: { zoConfig: {}, selectedOrganization: { identifier: "o1" } } }),
          createI18n({
            legacy: false,
            locale: "en",
            messages: { en: { common: { refresh: "Refresh" } } },
          }),
        ],
        stubs: {
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
