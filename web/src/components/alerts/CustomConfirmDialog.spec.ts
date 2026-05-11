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

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import CustomConfirmDialog from "./CustomConfirmDialog.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createStore } from "vuex";

installQuasar();

// Stub ODialog so tests are deterministic (no Portal/Reka teleport) and so we
// can assert on the props forwarded by CustomConfirmDialog and synthesise the
// `click:primary` / `click:secondary` / `update:open` events the component
// listens to.
const ODialogStub = {
  name: "ODialog",
  props: {
    open: { type: Boolean, default: false },
    size: { type: String, default: "md" },
    title: { type: String, default: "" },
    subTitle: { type: String, default: "" },
    persistent: { type: Boolean, default: false },
    showClose: { type: Boolean, default: true },
    width: { type: Number, default: undefined },
    primaryButtonLabel: { type: String, default: "" },
    secondaryButtonLabel: { type: String, default: "" },
    neutralButtonLabel: { type: String, default: "" },
    primaryButtonVariant: { type: String, default: "primary" },
    secondaryButtonVariant: { type: String, default: "outline" },
    neutralButtonVariant: { type: String, default: "ghost" },
    primaryButtonDisabled: { type: Boolean, default: false },
    secondaryButtonDisabled: { type: Boolean, default: false },
    neutralButtonDisabled: { type: Boolean, default: false },
    primaryButtonLoading: { type: Boolean, default: false },
    secondaryButtonLoading: { type: Boolean, default: false },
    neutralButtonLoading: { type: Boolean, default: false },
  },
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test="o-dialog-stub"
      :data-open="String(open)"
      :data-size="size"
      :data-title="title"
      :data-persistent="String(persistent)"
      :data-show-close="String(showClose)"
      :data-primary-label="primaryButtonLabel"
      :data-secondary-label="secondaryButtonLabel"
    >
      <span data-test="o-dialog-stub-title">{{ title }}</span>
      <slot />
      <button
        data-test="o-dialog-stub-primary"
        @click="$emit('click:primary')"
      >{{ primaryButtonLabel }}</button>
      <button
        data-test="o-dialog-stub-secondary"
        @click="$emit('click:secondary')"
      >{{ secondaryButtonLabel }}</button>
    </div>
  `,
};

function buildWrapper(props: Record<string, any> = {}, storeOverride?: any) {
  const store =
    storeOverride ??
    createStore({
      state: {
        theme: "light",
      },
    });

  return mount(CustomConfirmDialog, {
    props: {
      modelValue: true,
      ...props,
    },
    global: {
      plugins: [store],
      stubs: {
        ODialog: ODialogStub,
      },
    },
  });
}

describe("CustomConfirmDialog", () => {
  let wrapper: VueWrapper<any> | null = null;

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
    vi.restoreAllMocks();
  });

  it("should render the component", () => {
    wrapper = buildWrapper();
    expect(wrapper.exists()).toBe(true);
  });

  it("should have the correct component name", () => {
    wrapper = buildWrapper();
    expect(wrapper.vm.$options.name).toBe("CustomConfirmDialog");
  });

  it("should render the ODialog wrapper when modelValue is true", () => {
    wrapper = buildWrapper({ modelValue: true });
    expect(wrapper.find('[data-test="o-dialog-stub"]').exists()).toBe(true);
  });

  it("should forward the open state from modelValue to ODialog", () => {
    wrapper = buildWrapper({ modelValue: true });
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("open")).toBe(true);
  });

  it("should forward open=false to ODialog when modelValue is false", () => {
    wrapper = buildWrapper({ modelValue: false });
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("open")).toBe(false);
  });

  it("should display custom title via ODialog title prop", () => {
    wrapper = buildWrapper({ title: "Delete Item?" });
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("title")).toBe("Delete Item?");
  });

  it("should display default title when not provided", () => {
    wrapper = buildWrapper();
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("title")).toBe("Confirm Action");
  });

  it("should display custom message inside the dialog body", () => {
    wrapper = buildWrapper({ message: "Are you sure you want to proceed?" });
    const message = wrapper.find('[data-test="dialog-message"]');
    expect(message.exists()).toBe(true);
    expect(message.text()).toBe("Are you sure you want to proceed?");
  });

  it("should default message to empty string when not provided", () => {
    wrapper = buildWrapper();
    const message = wrapper.find('[data-test="dialog-message"]');
    expect(message.exists()).toBe(true);
    expect(message.text()).toBe("");
  });

  it("should render the custom confirm card container", () => {
    wrapper = buildWrapper();
    expect(wrapper.find('[data-test="custom-confirm-card"]').exists()).toBe(
      true,
    );
  });

  it("should forward the Cancel label to the ODialog secondary button", () => {
    wrapper = buildWrapper();
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("secondaryButtonLabel")).toBe("Cancel");
  });

  it("should forward the 'Clear & Continue' label to the ODialog primary button", () => {
    wrapper = buildWrapper();
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("primaryButtonLabel")).toBe("Clear & Continue");
  });

  it("should pass persistent=true to the ODialog", () => {
    wrapper = buildWrapper();
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("persistent")).toBe(true);
  });

  it("should pass showClose=false to the ODialog", () => {
    wrapper = buildWrapper();
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("showClose")).toBe(false);
  });

  it("should pass size='sm' to the ODialog", () => {
    wrapper = buildWrapper();
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("size")).toBe("sm");
  });

  it("should emit cancel event when ODialog emits click:secondary", async () => {
    wrapper = buildWrapper();
    const dialog = wrapper.findComponent(ODialogStub);
    await dialog.vm.$emit("click:secondary");

    expect(wrapper.emitted("cancel")).toHaveLength(1);
  });

  it("should emit confirm event when ODialog emits click:primary", async () => {
    wrapper = buildWrapper();
    const dialog = wrapper.findComponent(ODialogStub);
    await dialog.vm.$emit("click:primary");

    expect(wrapper.emitted("confirm")).toHaveLength(1);
  });

  it("should not emit confirm when secondary is clicked", async () => {
    wrapper = buildWrapper();
    const dialog = wrapper.findComponent(ODialogStub);
    await dialog.vm.$emit("click:secondary");
    expect(wrapper.emitted("confirm")).toBeFalsy();
  });

  it("should not emit cancel when primary is clicked", async () => {
    wrapper = buildWrapper();
    const dialog = wrapper.findComponent(ODialogStub);
    await dialog.vm.$emit("click:primary");
    expect(wrapper.emitted("cancel")).toBeFalsy();
  });

  it("should emit update:modelValue with false when cancel is triggered", async () => {
    wrapper = buildWrapper();
    const dialog = wrapper.findComponent(ODialogStub);
    await dialog.vm.$emit("click:secondary");
    await nextTick();

    const events = wrapper.emitted("update:modelValue");
    expect(events).toBeTruthy();
    expect(events![events!.length - 1]).toEqual([false]);
  });

  it("should emit update:modelValue with false when confirm is triggered", async () => {
    wrapper = buildWrapper();
    const dialog = wrapper.findComponent(ODialogStub);
    await dialog.vm.$emit("click:primary");
    await nextTick();

    const events = wrapper.emitted("update:modelValue");
    expect(events).toBeTruthy();
    expect(events![events!.length - 1]).toEqual([false]);
  });

  it("should update isVisible when modelValue prop changes to true", async () => {
    wrapper = buildWrapper({ modelValue: false });
    await wrapper.setProps({ modelValue: true });
    await nextTick();
    expect((wrapper.vm as any).isVisible).toBe(true);
  });

  it("should update isVisible when modelValue prop changes to false", async () => {
    wrapper = buildWrapper({ modelValue: true });
    await wrapper.setProps({ modelValue: false });
    await nextTick();
    expect((wrapper.vm as any).isVisible).toBe(false);
  });

  it("should propagate prop changes to ODialog open prop", async () => {
    wrapper = buildWrapper({ modelValue: false });
    let dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("open")).toBe(false);

    await wrapper.setProps({ modelValue: true });
    await nextTick();
    dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("open")).toBe(true);
  });

  it("should expose onCancel and onConfirm as functions", () => {
    wrapper = buildWrapper();
    expect(typeof (wrapper.vm as any).onCancel).toBe("function");
    expect(typeof (wrapper.vm as any).onConfirm).toBe("function");
  });

  it("should emit confirm when onConfirm is invoked directly", () => {
    wrapper = buildWrapper();
    (wrapper.vm as any).onConfirm();
    expect(wrapper.emitted("confirm")).toHaveLength(1);
  });

  it("should emit cancel when onCancel is invoked directly", () => {
    wrapper = buildWrapper();
    (wrapper.vm as any).onCancel();
    expect(wrapper.emitted("cancel")).toHaveLength(1);
  });

  it("should set isVisible to false when onCancel is invoked", () => {
    wrapper = buildWrapper({ modelValue: true });
    (wrapper.vm as any).onCancel();
    expect((wrapper.vm as any).isVisible).toBe(false);
  });

  it("should set isVisible to false when onConfirm is invoked", () => {
    wrapper = buildWrapper({ modelValue: true });
    (wrapper.vm as any).onConfirm();
    expect((wrapper.vm as any).isVisible).toBe(false);
  });

  it("should default modelValue to false when not provided", () => {
    wrapper = mount(CustomConfirmDialog, {
      global: {
        plugins: [
          createStore({ state: { theme: "light" } }),
        ],
        stubs: { ODialog: ODialogStub },
      },
    });
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("open")).toBe(false);
  });
});
