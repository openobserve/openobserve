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

import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar();

// Stub ODialog so tests are deterministic (no Portal/Reka teleport)
// and so we can assert on the props the component forwards + emit
// the click events the component listens to.
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
      :data-size="size"
      :data-title="title"
      :data-primary-label="primaryButtonLabel"
      :data-secondary-label="secondaryButtonLabel"
    >
      <span data-test="o-dialog-stub-title">{{ title }}</span>
      <slot name="header" />
      <slot />
      <slot name="footer" />
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

const QBannerStub = {
  name: "QBanner",
  template: `<div data-test="q-banner" :class="$attrs.class"><slot name="avatar" /><slot /></div>`,
};

const QIconStub = {
  name: "QIcon",
  props: ["name", "size"],
  template: `<i data-test="OIcon" :data-name="name" :class="$attrs.class" />`,
};

function buildWrapper(props: Record<string, any> = {}) {
  return mount(ConfirmDialog, {
    props: {
      title: "Dialog Title",
      message: "Dialog Message",
      modelValue: true,
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        ODialog: ODialogStub,
        "q-banner": QBannerStub,
        "OIcon": QIconStub,
      },
    },
  });
}

describe("ConfirmDialog", () => {
  let wrapper: ReturnType<typeof buildWrapper>;

  beforeEach(() => {
    store.state.theme = "dark";
    wrapper = buildWrapper();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.restoreAllMocks();
  });

  it("renders the ODialog wrapper", () => {
    expect(wrapper.find('[data-test="o-dialog-stub"]').exists()).toBe(true);
  });

  it("has the correct component name", () => {
    expect(wrapper.vm.$options.name).toBe("ConfirmDialog");
  });

  it("forwards the title prop to ODialog", () => {
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("title")).toBe("Dialog Title");
  });

  it("renders the message inside the dialog body", () => {
    expect(wrapper.text()).toContain("Dialog Message");
  });

  it("forwards the open state from modelValue to ODialog", () => {
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("open")).toBe(true);
  });

  it("renders i18n labels on the primary and secondary buttons", () => {
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("primaryButtonLabel")).toBe("OK");
    expect(dialog.props("secondaryButtonLabel")).toBe("Cancel");
  });

  it("uses size 'sm' when no warningMessage is provided", () => {
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("size")).toBe("sm");
  });

  it("uses size 'md' when a warningMessage is provided", () => {
    wrapper.unmount();
    wrapper = buildWrapper({ warningMessage: "Heads up" });
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("size")).toBe("md");
  });

  it("does not render the warning banner when warningMessage is empty", () => {
    expect(wrapper.find('[data-test="q-banner"]').exists()).toBe(false);
  });

  it("renders the warning banner with its message when warningMessage is provided", () => {
    wrapper.unmount();
    wrapper = buildWrapper({ warningMessage: "Be careful" });
    const banner = wrapper.find('[data-test="q-banner"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("Be careful");
  });

  it("applies dark-theme banner classes when store theme is dark", () => {
    store.state.theme = "dark";
    wrapper.unmount();
    wrapper = buildWrapper({ warningMessage: "Be careful" });
    const banner = wrapper.find('[data-test="q-banner"]');
    expect(banner.classes().join(" ")).toContain("tw:bg-gray-800/60");
    expect(banner.classes().join(" ")).toContain("tw:border-yellow-600/70");
  });

  it("applies light-theme banner classes when store theme is light", () => {
    store.state.theme = "light";
    wrapper.unmount();
    wrapper = buildWrapper({ warningMessage: "Be careful" });
    const banner = wrapper.find('[data-test="q-banner"]');
    expect(banner.classes().join(" ")).toContain("tw:bg-orange-50");
    expect(banner.classes().join(" ")).toContain("tw:border-orange-400");
  });

  it("emits update:ok and closes (update:modelValue=false) when primary is clicked", async () => {
    const dialog = wrapper.findComponent(ODialogStub);
    await dialog.vm.$emit("click:primary");

    expect(wrapper.emitted("update:ok")).toHaveLength(1);
    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")![0]).toEqual([false]);
  });

  it("emits update:cancel and closes (update:modelValue=false) when secondary is clicked", async () => {
    const dialog = wrapper.findComponent(ODialogStub);
    await dialog.vm.$emit("click:secondary");

    expect(wrapper.emitted("update:cancel")).toHaveLength(1);
    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")![0]).toEqual([false]);
  });

  it("does not emit update:cancel when primary is clicked", async () => {
    const dialog = wrapper.findComponent(ODialogStub);
    await dialog.vm.$emit("click:primary");
    expect(wrapper.emitted("update:cancel")).toBeFalsy();
  });

  it("does not emit update:ok when secondary is clicked", async () => {
    const dialog = wrapper.findComponent(ODialogStub);
    await dialog.vm.$emit("click:secondary");
    expect(wrapper.emitted("update:ok")).toBeFalsy();
  });

  it("exposes onCancel and onConfirm as functions", () => {
    expect(typeof (wrapper.vm as any).onCancel).toBe("function");
    expect(typeof (wrapper.vm as any).onConfirm).toBe("function");
  });

  it("emits update:ok when onConfirm is invoked directly", () => {
    (wrapper.vm as any).onConfirm();
    expect(wrapper.emitted("update:ok")).toHaveLength(1);
  });

  it("emits update:cancel when onCancel is invoked directly", () => {
    (wrapper.vm as any).onCancel();
    expect(wrapper.emitted("update:cancel")).toHaveLength(1);
  });

  it("defaults modelValue to false when not provided", () => {
    wrapper.unmount();
    wrapper = mount(ConfirmDialog, {
      global: {
        plugins: [i18n, store],
        stubs: {
          ODialog: ODialogStub,
          "q-banner": QBannerStub,
          "OIcon": QIconStub,
        },
      },
    });
    const dialog = wrapper.findComponent(ODialogStub);
    expect(dialog.props("open")).toBe(false);
  });
});
