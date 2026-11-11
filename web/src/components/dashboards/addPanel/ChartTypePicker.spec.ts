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
import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
import { defineComponent, onMounted, ref } from "vue";
import i18n from "@/locales";
import ChartTypePicker from "./ChartTypePicker.vue";
import ChartTypeSelect from "./ChartTypeSelect.vue";

vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: () => ({ promqlMode: ref(false) }),
}));

const fieldsMounted = vi.fn();

// Stands in for the field list: counts mounts so a remount (and its refetch) would show.
const FieldsStub = defineComponent({
  setup() {
    onMounted(fieldsMounted);
    return {};
  },
  template: '<div data-test="fields-stub" />',
});

const listSelector = '[data-test="dashboard-addpanel-chart-type-list"]';
const triggerSelector = '[data-test="dashboard-addpanel-chart-type-select-trigger"]';

describe("ChartTypePicker", () => {
  let wrapper: VueWrapper<any>;

  afterEach(() => {
    wrapper?.unmount();
    fieldsMounted.mockClear();
  });

  const mountPicker = (chartType = "line") => {
    wrapper = mount(ChartTypePicker, {
      attachTo: document.body,
      props: {
        chartType,
        open: false,
        "onUpdate:open": (open: boolean) => wrapper.setProps({ open }),
      },
      slots: { default: FieldsStub },
      global: { plugins: [i18n], provide: { dashboardPanelDataPageKey: "dashboard" } },
    });
    return wrapper;
  };

  const fieldsPane = () => wrapper.find('[data-test="fields-stub"]').element.parentElement!;

  it("shows the current chart's icon and name in the select, with its id for e2e", () => {
    mountPicker("h-stacked");
    const select = wrapper.find('[data-test="dashboard-addpanel-chart-type-select"]');
    expect(select.attributes("data-test-selected-value")).toBe("h-stacked");
    expect(select.text()).toContain("Chart type");
    expect(select.text()).toContain("Horizontal stacked bar");
    expect(
      select.find('[data-test="dashboard-addpanel-chart-type-select-icon"]').attributes("src"),
    ).toContain("h-stacked.svg");
  });

  it("shows the fields until the select is clicked", async () => {
    mountPicker();
    expect(wrapper.find(listSelector).exists()).toBe(false);
    expect(fieldsPane().classList.contains("invisible")).toBe(false);
    expect(fieldsPane().hasAttribute("inert")).toBe(false);

    await wrapper.find(triggerSelector).trigger("click");
    await flushPromises();

    expect(wrapper.find(listSelector).exists()).toBe(true);
    expect(fieldsPane().classList.contains("invisible")).toBe(true);
    expect(fieldsPane().hasAttribute("inert")).toBe(true);
    expect(wrapper.findComponent(ChartTypeSelect).props("expanded")).toBe(true);
  });

  it("closes on a second click and keeps the fields mounted throughout", async () => {
    mountPicker();
    await wrapper.find(triggerSelector).trigger("click");
    await wrapper.find(triggerSelector).trigger("click");
    await flushPromises();

    expect(wrapper.find(listSelector).exists()).toBe(false);
    expect(fieldsPane().classList.contains("invisible")).toBe(false);
    expect(fieldsMounted).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and gives focus back to the select", async () => {
    mountPicker();
    await wrapper.setProps({ open: true });
    await wrapper
      .find('[data-test="dashboard-addpanel-chart-type-search"] input')
      .trigger("keydown", { key: "Escape" });
    await flushPromises();

    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
    expect(wrapper.find(listSelector).exists()).toBe(false);
    expect(document.activeElement).toBe(wrapper.find(triggerSelector).element);
  });

  it("closes and reports the pick", async () => {
    mountPicker();
    await wrapper.setProps({ open: true });
    await wrapper.find('[data-test="selected-chart-pie-item"]').trigger("click");

    expect(wrapper.emitted("select")).toEqual([["pie"]]);
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("starts each opening with an empty search", async () => {
    mountPicker();
    await wrapper.setProps({ open: true });
    const input = () => wrapper.find('[data-test="dashboard-addpanel-chart-type-search"] input');
    await input().setValue("pie");
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });

    expect((input().element as HTMLInputElement).value).toBe("");
  });
});
