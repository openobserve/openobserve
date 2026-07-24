// Copyright 2026 OpenObserve Inc.
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
import ColorBySeriesPopUp from "./ColorBySeriesPopUp.vue";
import OFormCombobox from "@/lib/forms/Combobox/OFormCombobox.vue";
import OCombobox from "@/lib/forms/Combobox/OCombobox.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// Mock VueDraggableNext
vi.mock("vue-draggable-next", () => ({
  VueDraggableNext: {
    template: "<div><slot></slot></div>",
  },
}));

// Stub ODialog so tests are deterministic (no Portal/Teleport) and so we can
// drive primary/neutral button clicks via the emits the component listens to.
const ODialogStub = {
  name: "ODialog",
  inheritAttrs: false,
  props: [
    "open",
    "size",
    "title",
    "subTitle",
    "persistent",
    "showClose",
    "width",
    "formId",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "primaryButtonVariant",
    "secondaryButtonVariant",
    "neutralButtonVariant",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
    "neutralButtonDisabled",
    "primaryButtonLoading",
    "secondaryButtonLoading",
    "neutralButtonLoading",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test="o-dialog-stub"
      :data-open="String(open)"
      :data-title="title"
      :data-width="width"
      :data-primary-label="primaryButtonLabel"
      :data-neutral-label="neutralButtonLabel"
      :data-primary-disabled="String(primaryButtonDisabled)"
    >
      <span data-test="o-dialog-stub-title">{{ title }}</span>
      <slot name="header" />
      <slot />
      <slot name="footer" />
      <button
        data-test="o-dialog-stub-primary"
        :disabled="primaryButtonDisabled"
        @click="$emit('click:primary')"
      >{{ primaryButtonLabel }}</button>
      <button
        data-test="o-dialog-stub-neutral"
        @click="$emit('click:neutral')"
      >{{ neutralButtonLabel }}</button>
      <button
        data-test="o-dialog-stub-close"
        @click="$emit('update:open', false)"
      >close</button>
    </div>
  `,
};

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

const mockSeriesOptions = [
  { name: "Series 1", value: "series1" },
  { name: "Series 2", value: "series2" },
];

function buildWrapper(props: Record<string, any> = {}) {
  return mount(ColorBySeriesPopUp, {
    attachTo: "#app",
    props: {
      open: true,
      colorBySeries: [],
      seriesOptions: mockSeriesOptions,
      ...props,
    },
    global: {
      plugins: [i18n, router],
      provide: {
        store,
      },
      stubs: {
        ODialog: ODialogStub,
      },
    },
  });
}

describe("ColorBySeriesPopUp", () => {
  let wrapper: ReturnType<typeof buildWrapper>;

  beforeEach(async () => {
    wrapper = buildWrapper();
    await flushPromises();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.clearAllMocks();
  });

  it("renders ODialog wrapper", () => {
    expect(wrapper.find('[data-test="o-dialog-stub"]').exists()).toBe(true);
  });

  it("renders the popup content inside the dialog", () => {
    expect(wrapper.find("[data-test='dashboard-color-by-series-popup']").exists()).toBe(true);
  });

  it("forwards the title to ODialog", () => {
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("title")).toBe("Color by series");
  });

  it("forwards size='lg' to ODialog", () => {
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("size")).toBe("lg");
  });

  it("forwards open prop from parent to ODialog", () => {
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("open")).toBe(true);
  });

  it("renders the configured neutral and primary button labels", () => {
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("neutralButtonLabel")).toBe("+ Add a new color");
    expect(dialog.props("primaryButtonLabel")).toBe("Save");
  });

  it("uses outline variant for the neutral button", () => {
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("neutralButtonVariant")).toBe("outline");
  });

  it("initializes with one default empty series when no colorBySeries provided", () => {
    expect(wrapper.vm.editColorBySeries).toHaveLength(1);
    expect(wrapper.vm.editColorBySeries[0]).toEqual({
      type: "value",
      value: "",
      color: null,
    });
  });

  it("initializes with provided colorBySeries data", async () => {
    wrapper.unmount();
    wrapper = buildWrapper({
      colorBySeries: [
        { value: "series1", color: "#FF0000" },
        { value: "series2", color: "#00FF00" },
      ],
    });
    await flushPromises();

    expect(wrapper.vm.editColorBySeries).toHaveLength(2);
    expect(wrapper.vm.editColorBySeries[0].value).toBe("series1");
    expect(wrapper.vm.editColorBySeries[0].color).toBe("#FF0000");
    expect(wrapper.vm.editColorBySeries[1].value).toBe("series2");
    expect(wrapper.vm.editColorBySeries[1].color).toBe("#00FF00");
  });

  it("adds a new color series when the neutral button is clicked", async () => {
    const dialog = wrapper.findComponent(ODialogStub);
    await dialog.vm.$emit("click:neutral");
    await flushPromises();

    expect(wrapper.vm.editColorBySeries).toHaveLength(2);
    expect(wrapper.vm.editColorBySeries[1]).toEqual({
      type: "value",
      value: "",
      color: null,
    });
  });

  it("removes a color series when the row delete button is clicked", async () => {
    await wrapper.vm.addcolorBySeries();
    await flushPromises();
    expect(wrapper.vm.editColorBySeries).toHaveLength(2);

    const deleteButton = wrapper.find(
      "[data-test='dashboard-addpanel-config-color-by-series-delete-btn-0']",
    );
    await deleteButton.trigger("click");

    expect(wrapper.vm.editColorBySeries).toHaveLength(1);
  });

  // START-HERE ① "non-negotiable gate": deleting a NON-last row of a field-array
  // must keep each RENDERED input aligned with its surviving row — assert the
  // OFormCombobox→OCombobox `model-value` per row, NOT just `form.state.values`.
  // (A stable-id `:key` + index-based `name` would leave the inputs shifted/blank
  // here while the data stays correct; `:key="index"` is what keeps them aligned.)
  it("keeps each row's RENDERED input aligned after deleting a NON-last row (field-array :key gate)", async () => {
    // Build 3 rows (default 1 + 2) with distinct values.
    wrapper.vm.addcolorBySeries();
    wrapper.vm.addcolorBySeries();
    await flushPromises();
    wrapper.vm.form.setFieldValue("series[0].value", "Series A");
    wrapper.vm.form.setFieldValue("series[1].value", "Series B");
    wrapper.vm.form.setFieldValue("series[2].value", "Series C");
    await flushPromises();
    await wrapper.vm.$nextTick();

    // Read the RENDERED inputs in row order (the OForm* → base OCombobox value).
    const renderedRowValues = () =>
      wrapper
        .findAllComponents(OFormCombobox)
        .filter((c: any) => /^series\[\d+\]\.value$/.test(c.props("name")))
        .map((c: any) => c.findComponent(OCombobox).props("modelValue"));

    expect(renderedRowValues()).toEqual(["Series A", "Series B", "Series C"]);

    // Delete the MIDDLE (non-last) row via its delete button.
    await wrapper
      .find("[data-test='dashboard-addpanel-config-color-by-series-delete-btn-1']")
      .trigger("click");
    await flushPromises();
    await wrapper.vm.$nextTick();

    // The surviving rows must render in order (B gone, C shifted up) — proving the
    // inputs track the data and are not left blank/shifted.
    expect(renderedRowValues()).toEqual(["Series A", "Series C"]);
    expect(wrapper.vm.editColorBySeries.map((r: any) => r.value)).toEqual(["Series A", "Series C"]);
  });

  it("sets color when setColorByIndex is invoked", async () => {
    await wrapper.vm.setColorByIndex(0);
    expect(wrapper.vm.editColorBySeries[0].color).toBe("#5960b2");
  });

  it("removes color when removeColorByIndex is invoked", async () => {
    await wrapper.vm.setColorByIndex(0);
    expect(wrapper.vm.editColorBySeries[0].color).toBe("#5960b2");
    await wrapper.vm.removeColorByIndex(0);
    expect(wrapper.vm.editColorBySeries[0].color).toBeNull();
  });

  it("computes series data items from options", () => {
    const items = wrapper.vm.seriesDataItems;
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ label: "Series 1", value: "Series 1" });
    expect(items[1]).toEqual({ label: "Series 2", value: "Series 2" });
  });

  it("filters out series options with undefined name", async () => {
    wrapper.unmount();
    wrapper = buildWrapper({
      seriesOptions: [{ name: "Valid" }, { name: undefined }, { name: "Another" }],
    });
    await flushPromises();
    const items = wrapper.vm.seriesDataItems;
    expect(items).toHaveLength(2);
    expect(items.map((i: any) => i.label)).toEqual(["Valid", "Another"]);
  });

  // Validation is now schema-driven through the REAL <OForm> (the series[] field
  // array). Each row needs a non-empty value + a non-null color; the schema gates
  // the submit instead of disabling Save (R3).
  const submitForm = async (w: any) => {
    await w.vm.form.handleSubmit();
    await flushPromises();
  };
  // series[] is form-owned (rule ②) — set row fields through the form.
  const setRow = (w: any, i: number, field: string, val: unknown) =>
    w.vm.form.setFieldValue(`series[${i}].${field}`, val);

  it("is invalid when initial values are empty (blocks save)", async () => {
    await submitForm(wrapper);
    expect(wrapper.vm.form.state.isValid).toBe(false);
    expect(wrapper.emitted().save).toBeFalsy();
  });

  it("shows the inline series-value error on the OFormCombobox after submit", async () => {
    // value left empty, color set → only the value rule fails
    setRow(wrapper, 0, "color", "#FF0000");
    await flushPromises();
    await submitForm(wrapper);
    expect(wrapper.text()).toContain("Series value is required");
  });

  it("is valid when all series have a value and a color", async () => {
    setRow(wrapper, 0, "value", "Series 1");
    setRow(wrapper, 0, "color", "#FF0000");
    await flushPromises();
    await submitForm(wrapper);
    expect(wrapper.vm.form.state.isValid).toBe(true);
  });

  it("is invalid when a value is whitespace only", async () => {
    setRow(wrapper, 0, "value", "   ");
    setRow(wrapper, 0, "color", "#FF0000");
    await flushPromises();
    await submitForm(wrapper);
    expect(wrapper.vm.form.state.isValid).toBe(false);
  });

  it("is invalid when any one of several series is invalid", async () => {
    wrapper.vm.addcolorBySeries();
    await flushPromises();
    setRow(wrapper, 0, "value", "Series 1");
    setRow(wrapper, 0, "color", "#FF0000");
    // second row is left empty
    await flushPromises();
    await submitForm(wrapper);
    expect(wrapper.vm.form.state.isValid).toBe(false);
  });

  it("is valid with zero rows and saves an empty array (clears all colors)", async () => {
    // Removing every row must save [] (the pre-revamp "clear all colors" flow) —
    // not be blocked by a min(1) rule.
    wrapper.vm.form.setFieldValue("series", []);
    await flushPromises();
    await submitForm(wrapper);
    expect(wrapper.vm.form.state.isValid).toBe(true);
    expect(wrapper.emitted().save).toBeTruthy();
    expect(wrapper.emitted().save[0][0]).toEqual([]);
  });

  it("keeps the Save button enabled (R3) and wires form-id (R4)", () => {
    const dialog = wrapper.findComponent(ODialogStub);
    // Save is never disabled by validity now — the schema gates submit.
    expect(dialog.props("primaryButtonDisabled")).toBeFalsy();
    expect(dialog.props("formId")).toBe("color-by-series-form");
    expect(wrapper.find("#color-by-series-form").exists()).toBe(true);
  });

  it("emits save with the edited series on a valid submit", async () => {
    setRow(wrapper, 0, "value", "Series 1");
    setRow(wrapper, 0, "color", "#FF0000");
    await flushPromises();

    await submitForm(wrapper);

    expect(wrapper.emitted().save).toBeTruthy();
    expect(wrapper.emitted().save[0][0]).toEqual([
      {
        type: "value",
        value: "Series 1",
        color: "#FF0000",
      },
    ]);
  });

  it("does not emit save on submit while the form is invalid", async () => {
    await submitForm(wrapper);
    expect(wrapper.emitted().save).toBeFalsy();
  });

  it("emits close when ODialog requests close via update:open=false", async () => {
    const dialog = wrapper.findComponent(ODialogStub);
    await dialog.vm.$emit("update:open", false);
    expect(wrapper.emitted().close).toBeTruthy();
    expect(wrapper.emitted().close).toHaveLength(1);
  });

  it("does not emit close when ODialog reports update:open=true", async () => {
    const dialog = wrapper.findComponent(ODialogStub);
    await dialog.vm.$emit("update:open", true);
    expect(wrapper.emitted().close).toBeFalsy();
  });

  it("returns value, label, or raw item from selectColorBySeriesOption", () => {
    expect(wrapper.vm.selectColorBySeriesOption({ value: "v", label: "l" })).toBe("v");
    expect(wrapper.vm.selectColorBySeriesOption({ label: "l" })).toBe("l");
    expect(wrapper.vm.selectColorBySeriesOption("raw")).toBe("raw");
  });

  it("exposes the expected setup helpers", () => {
    expect(typeof wrapper.vm.addcolorBySeries).toBe("function");
    expect(typeof wrapper.vm.removecolorBySeriesByIndex).toBe("function");
    expect(typeof wrapper.vm.setColorByIndex).toBe("function");
    expect(typeof wrapper.vm.removeColorByIndex).toBe("function");
    expect(typeof wrapper.vm.cancelEdit).toBe("function");
    expect(typeof wrapper.vm.openColorPicker).toBe("function");
  });
});
