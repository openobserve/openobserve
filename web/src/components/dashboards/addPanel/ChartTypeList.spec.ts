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
import { mount, VueWrapper } from "@vue/test-utils";
import { ref } from "vue";
import i18n from "@/locales";
import ChartTypeList from "./ChartTypeList.vue";
import { CHART_TYPES } from "@/utils/dashboard/chartTypeCatalog";

const promqlMode = ref(false);

vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: () => ({ promqlMode }),
}));

const rowSelector = '[data-test="dashboard-addpanel-chart-selection-item"]';

describe("ChartTypeList", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    promqlMode.value = false;
  });

  const mountList = (props: Record<string, unknown> = {}) =>
    mount(ChartTypeList, {
      attachTo: document.body,
      props: { selected: "line", ...props },
      global: { plugins: [i18n], provide: { dashboardPanelDataPageKey: "dashboard" } },
    });

  const rowNames = () =>
    wrapper.findAll(rowSelector).map((row) => row.find('[data-test^="selected-chart-"]').text());

  const search = async (term: string) => {
    await wrapper.find('[data-test="dashboard-addpanel-chart-type-search"] input').setValue(term);
  };

  it("shows one row per type under ten sentence-case group headings", () => {
    wrapper = mountList();
    expect(wrapper.findAll(rowSelector)).toHaveLength(CHART_TYPES.length);
    expect(wrapper.findAll("section")).toHaveLength(10);
    expect(wrapper.find('[data-test="dashboard-addpanel-chart-type-group-trends"]').text()).toMatch(
      /^Trends over time/,
    );
  });

  it("marks only the selected type's row with the e2e attributes", () => {
    wrapper = mountList({ selected: "maps" });
    const selected = wrapper.findAll(`${rowSelector}[data-test-selected]`);
    expect(selected).toHaveLength(1);
    expect(selected[0].attributes("data-test-selected")).toBe("maps");
    expect(selected[0].classes()).toContain("bg-label-chip-url-bg");

    const inner = selected[0].find('[data-test="selected-chart-maps-item"]');
    expect(inner.attributes("data-selected")).toBe("true");
    expect(inner.text()).toBe("World map");
    expect(wrapper.find('[data-test="selected-chart-line-item"]').attributes("data-selected")).toBe(
      "false",
    );
  });

  it("focuses the search when it opens", () => {
    wrapper = mountList();
    expect(document.activeElement).toBe(
      wrapper.find('[data-test="dashboard-addpanel-chart-type-search"] input').element,
    );
  });

  it("filters by name, case-insensitively", async () => {
    wrapper = mountList();
    await search("STACKED");
    expect(rowNames()).toEqual(["Stacked area", "Stacked bar", "Horizontal stacked bar"]);
  });

  it("filters by intent keywords", async () => {
    wrapper = mountList();
    await search("kpi");
    expect(rowNames()).toEqual(["Metric"]);
    await search("country");
    expect(rowNames()).toEqual(["World map"]);
    await search("percent");
    expect(rowNames()).toEqual(expect.arrayContaining(["Gauge", "Pie"]));
  });

  it("drops groups with no match and shows one empty line when nothing matches", async () => {
    wrapper = mountList();
    await search("kpi");
    expect(wrapper.findAll("section")).toHaveLength(1);
    expect(wrapper.find('[data-test="dashboard-addpanel-chart-type-empty"]').exists()).toBe(false);

    await search("zzz-no-such-chart");
    expect(wrapper.findAll(rowSelector)).toHaveLength(0);
    expect(wrapper.find('[data-test="dashboard-addpanel-chart-type-empty"]').text()).toBe(
      "No chart type matches",
    );
  });

  it("emits the picked type", async () => {
    wrapper = mountList();
    await wrapper.find('[data-test="selected-chart-bar-item"]').trigger("click");
    expect(wrapper.emitted("select")).toEqual([["bar"]]);
  });

  it("keeps PromQL-incapable types listed but not selectable in PromQL mode", async () => {
    promqlMode.value = true;
    wrapper = mountList();
    const sankey = wrapper.find('[data-test="selected-chart-sankey-item"]');
    expect(sankey.exists()).toBe(true);
    expect(sankey.attributes("disabled")).toBeDefined();
    await sankey.trigger("click");
    await wrapper.find('[data-test="selected-chart-line-item"]').trigger("click");
    expect(wrapper.emitted("select")).toEqual([["line"]]);
  });

  it("dims the types outside the host's allowed list", async () => {
    wrapper = mountList({ allowedChartTypes: ["line", "bar"] });
    expect(wrapper.find('[data-test="selected-chart-bar-item"]').attributes("disabled")).toBe(
      undefined,
    );
    const pie = wrapper.find('[data-test="selected-chart-pie-item"]');
    expect(pie.attributes("disabled")).toBeDefined();
    expect(pie.find("img").classes()).toContain("opacity-50");
    await pie.trigger("click");
    expect(wrapper.emitted("select")).toBeUndefined();
  });
});
