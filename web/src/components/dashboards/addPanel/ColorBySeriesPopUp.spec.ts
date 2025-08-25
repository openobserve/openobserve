// Copyright 2023 OpenObserve Inc.
//
// Licensed under the GNU Affero General Public License, Version 3.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.gnu.org/licenses/agpl-3.0.en.html
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import ColorBySeriesPopUp from "./ColorBySeriesPopUp.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// Mock VueDraggableNext
vi.mock("vue-draggable-next", () => ({
  VueDraggableNext: {
    template: "<div><slot></slot></div>",
  },
}));

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

installQuasar({
  plugins: [Dialog, Notify],
});

describe("ColorBySeriesPopUp", () => {
  let wrapper: any;
  const mockSeriesOptions = [
    { name: "Series 1", value: "series1" },
    { name: "Series 2", value: "series2" },
  ];

  const defaultProps = {
    colorBySeries: [],
    seriesOptions: mockSeriesOptions,
  };

  beforeEach(async () => {
    wrapper = mount(ColorBySeriesPopUp, {
      attachTo: "#app",
      props: defaultProps,
      global: {
        plugins: [i18n, router],
        provide: {
          store,
        },
      },
    });
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.clearAllMocks();
  });

  it("should render color by series popup", () => {
    expect(
      wrapper.find("[data-test='dashboard-color-by-series-popup']").exists(),
    ).toBeTruthy();
  });

  it("should initialize with default empty series if no colorBySeries provided", () => {
    expect(wrapper.vm.editColorBySeries).toHaveLength(1);
    expect(wrapper.vm.editColorBySeries[0]).toEqual({
      type: "value",
      value: "",
      color: null,
    });
  });

  it("should initialize with provided colorBySeries data", async () => {
    const colorBySeriesData = [
      { value: "series1", color: "#FF0000" },
      { value: "series2", color: "#00FF00" },
    ];

    wrapper = mount(ColorBySeriesPopUp, {
      attachTo: "#app",
      props: {
        ...defaultProps,
        colorBySeries: colorBySeriesData,
      },
      global: {
        plugins: [i18n, router],
        provide: {
          store,
        },
      },
    });
    await flushPromises();

    expect(wrapper.vm.editColorBySeries).toHaveLength(2);
    expect(wrapper.vm.editColorBySeries[0].value).toBe("series1");
    expect(wrapper.vm.editColorBySeries[0].color).toBe("#FF0000");
  });

  it("should add new color series when add button is clicked", async () => {
    const addButton = wrapper.find(
      "[data-test='dashboard-addpanel-config-color-by-series-add-btn']",
    );
    await addButton.trigger("click");

    expect(wrapper.vm.editColorBySeries).toHaveLength(2);
    expect(wrapper.vm.editColorBySeries[1]).toEqual({
      type: "value",
      value: "",
      color: null,
    });
  });

  it("should remove color series when delete button is clicked", async () => {
    await wrapper.vm.addcolorBySeries();
    await flushPromises();

    const deleteButton = wrapper.find(
      "[data-test='dashboard-addpanel-config-color-by-series-delete-btn-0']",
    );
    await deleteButton.trigger("click");

    expect(wrapper.vm.editColorBySeries).toHaveLength(1);
  });

  it("should set color when set color button is clicked", async () => {
    const seriesIndex = 0;
    await wrapper.vm.setColorByIndex(seriesIndex);

    expect(wrapper.vm.editColorBySeries[seriesIndex].color).toBe("#5960b2");
  });

  it("should remove color when remove color button is clicked", async () => {
    const seriesIndex = 0;
    await wrapper.vm.setColorByIndex(seriesIndex);
    await wrapper.vm.removeColorByIndex(seriesIndex);

    expect(wrapper.vm.editColorBySeries[seriesIndex].color).toBeNull();
  });

  it("should compute series data items from options", () => {
    const items = wrapper.vm.seriesDataItems;
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      label: "Series 1",
      value: "Series 1",
    });
  });

  it("should validate form before saving", async () => {
    // Form should be invalid initially (no values set)
    expect(wrapper.vm.isFormValid).toBe(false);

    // Set valid values
    wrapper.vm.editColorBySeries[0].value = "Series 1";
    wrapper.vm.editColorBySeries[0].color = "#FF0000";
    await flushPromises();

    expect(wrapper.vm.isFormValid).toBe(true);
  });

  it("should emit save event with valid data", async () => {
    wrapper.vm.editColorBySeries[0].value = "Series 1";
    wrapper.vm.editColorBySeries[0].color = "#FF0000";
    await flushPromises();

    const saveButton = wrapper.find(
      "[data-test='dashboard-addpanel-config-color-by-series-apply-btn']",
    );
    await saveButton.trigger("click");

    expect(wrapper.emitted().save).toBeTruthy();
    expect(wrapper.emitted().save[0][0]).toEqual([
      {
        type: "value",
        value: "Series 1",
        color: "#FF0000",
      },
    ]);
  });

  it("should emit close event when cancel button is clicked", async () => {
    const cancelButton = wrapper.find(
      "[data-test='dashboard-color-by-series-cancel']",
    );
    await cancelButton.trigger("click");

    expect(wrapper.emitted().close).toBeTruthy();
  });

  it("should disable save button when form is invalid", async () => {
    // Initially form should be invalid (empty values)
    expect(wrapper.vm.isFormValid).toBe(false);

    // Set valid values
    wrapper.vm.editColorBySeries[0].value = "Series 1";
    wrapper.vm.editColorBySeries[0].color = "#FF0000";
    await flushPromises();

    // Now form should be valid
    expect(wrapper.vm.isFormValid).toBe(true);
  });

  it("should handle undefined or null series values", async () => {
    wrapper.vm.editColorBySeries[0].value = undefined;
    await flushPromises();
    expect(wrapper.vm.editColorBySeries[0].value).toBe("");

    wrapper.vm.editColorBySeries[0].value = null;
    await flushPromises();
    expect(wrapper.vm.editColorBySeries[0].value).toBe("");
  });
});
