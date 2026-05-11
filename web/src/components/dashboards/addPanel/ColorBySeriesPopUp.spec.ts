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

// Stub ODialog so tests are deterministic (no Portal/Teleport) and so we can
// drive primary/neutral button clicks via the emits the component listens to.
const ODialogStub = {
  name: "ODialog",
  props: [
    "open",
    "size",
    "title",
    "subTitle",
    "persistent",
    "showClose",
    "width",
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

installQuasar({
  plugins: [Dialog, Notify],
});

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
    expect(
      wrapper.find("[data-test='dashboard-color-by-series-popup']").exists(),
    ).toBe(true);
  });

  it("forwards the title to ODialog", () => {
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("title")).toBe("Color by series");
  });

  it("forwards the width to ODialog", () => {
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("width")).toBe(40);
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
      seriesOptions: [
        { name: "Valid" },
        { name: undefined },
        { name: "Another" },
      ],
    });
    await flushPromises();
    const items = wrapper.vm.seriesDataItems;
    expect(items).toHaveLength(2);
    expect(items.map((i: any) => i.label)).toEqual(["Valid", "Another"]);
  });

  it("returns false from isFormValid when initial values are empty", () => {
    expect(wrapper.vm.isFormValid).toBe(false);
  });

  it("returns true from isFormValid when all series have value and color", async () => {
    wrapper.vm.editColorBySeries[0].value = "Series 1";
    wrapper.vm.editColorBySeries[0].color = "#FF0000";
    await flushPromises();
    expect(wrapper.vm.isFormValid).toBe(true);
  });

  it("returns false from isFormValid when value is whitespace only", async () => {
    wrapper.vm.editColorBySeries[0].value = "   ";
    wrapper.vm.editColorBySeries[0].color = "#FF0000";
    await flushPromises();
    expect(wrapper.vm.isFormValid).toBe(false);
  });

  it("returns false from isFormValid when any one of several series is invalid", async () => {
    await wrapper.vm.addcolorBySeries();
    wrapper.vm.editColorBySeries[0].value = "Series 1";
    wrapper.vm.editColorBySeries[0].color = "#FF0000";
    // second row is left empty
    await flushPromises();
    expect(wrapper.vm.isFormValid).toBe(false);
  });

  it("forwards primaryButtonDisabled=true when the form is invalid", () => {
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("primaryButtonDisabled")).toBe(true);
  });

  it("forwards primaryButtonDisabled=false when the form becomes valid", async () => {
    wrapper.vm.editColorBySeries[0].value = "Series 1";
    wrapper.vm.editColorBySeries[0].color = "#FF0000";
    await flushPromises();
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("primaryButtonDisabled")).toBe(false);
  });

  it("emits save with the edited series when the primary button is clicked and form is valid", async () => {
    wrapper.vm.editColorBySeries[0].value = "Series 1";
    wrapper.vm.editColorBySeries[0].color = "#FF0000";
    await flushPromises();

    const dialog = wrapper.findComponent(ODialogStub);
    await dialog.vm.$emit("click:primary");

    expect(wrapper.emitted().save).toBeTruthy();
    expect(wrapper.emitted().save[0][0]).toEqual([
      {
        type: "value",
        value: "Series 1",
        color: "#FF0000",
      },
    ]);
  });

  it("does not emit save when the primary button is clicked while the form is invalid", async () => {
    const dialog = wrapper.findComponent(ODialogStub);
    await dialog.vm.$emit("click:primary");
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

  it("coerces undefined series values back to an empty string via the deep watcher", async () => {
    wrapper.vm.editColorBySeries[0].value = undefined;
    await flushPromises();
    expect(wrapper.vm.editColorBySeries[0].value).toBe("");
  });

  it("coerces null series values back to an empty string via the deep watcher", async () => {
    wrapper.vm.editColorBySeries[0].value = null;
    await flushPromises();
    expect(wrapper.vm.editColorBySeries[0].value).toBe("");
  });

  it("returns value, label, or raw item from selectColorBySeriesOption", () => {
    expect(
      wrapper.vm.selectColorBySeriesOption({ value: "v", label: "l" }),
    ).toBe("v");
    expect(wrapper.vm.selectColorBySeriesOption({ label: "l" })).toBe("l");
    expect(wrapper.vm.selectColorBySeriesOption("raw")).toBe("raw");
  });

  it("exposes the expected setup helpers", () => {
    expect(typeof wrapper.vm.addcolorBySeries).toBe("function");
    expect(typeof wrapper.vm.removecolorBySeriesByIndex).toBe("function");
    expect(typeof wrapper.vm.setColorByIndex).toBe("function");
    expect(typeof wrapper.vm.removeColorByIndex).toBe("function");
    expect(typeof wrapper.vm.applycolorBySeries).toBe("function");
    expect(typeof wrapper.vm.cancelEdit).toBe("function");
    expect(typeof wrapper.vm.openColorPicker).toBe("function");
  });
});
