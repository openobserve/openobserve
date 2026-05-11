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

import { mount, VueWrapper } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import CustomChartConfirmDialog from "@/components/dashboards/addPanel/customChartExamples/CustomChartConfirmDialog.vue";
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
  template: `<i data-test="q-icon" :data-name="name" :class="$attrs.class" />`,
};

const QCheckboxStub = {
  name: "QCheckbox",
  props: ["modelValue", "label"],
  emits: ["update:modelValue"],
  template: `
    <label
      data-test="replace-query-checkbox"
      :class="$attrs.class"
    >
      <input
        type="checkbox"
        data-test="replace-query-checkbox-input"
        :checked="modelValue"
        @change="$emit('update:modelValue', $event.target.checked)"
      />
      {{ label }}
    </label>
  `,
};

function buildWrapper(props: Record<string, any> = {}): VueWrapper<any> {
  return mount(CustomChartConfirmDialog, {
    props: {
      title: "Custom Chart",
      message: "Are you sure?",
      modelValue: true,
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        ODialog: ODialogStub,
        "q-banner": QBannerStub,
        "q-icon": QIconStub,
        "q-checkbox": QCheckboxStub,
      },
    },
  });
}

describe("CustomChartConfirmDialog", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    store.state.theme = "dark";
    wrapper = buildWrapper();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.restoreAllMocks();
  });

  describe("Component Initialization", () => {
    it("renders the ODialog wrapper", () => {
      expect(wrapper.find('[data-test="o-dialog-stub"]').exists()).toBe(true);
    });

    it("renders the inner dialog-box container", () => {
      expect(wrapper.find('[data-test="dialog-box"]').exists()).toBe(true);
    });

    it("has the correct component name", () => {
      expect(wrapper.vm.$options.name).toBe("CustomChartConfirmDialog");
    });

    it("declares the expected emits", () => {
      expect(wrapper.vm.$options.emits).toEqual([
        "update:ok",
        "update:cancel",
        "update:modelValue",
      ]);
    });
  });

  describe("Prop Forwarding", () => {
    it("forwards the title prop to ODialog", () => {
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("title")).toBe("Custom Chart");
    });

    it("renders the message inside the dialog body", () => {
      expect(wrapper.text()).toContain("Are you sure?");
    });

    it("forwards open=true to ODialog when modelValue is true", () => {
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("open")).toBe(true);
    });

    it("forwards open=false to ODialog when modelValue is false", () => {
      wrapper.unmount();
      wrapper = buildWrapper({ modelValue: false });
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("open")).toBe(false);
    });

    it("defaults modelValue to false (open=false) when not provided", () => {
      wrapper.unmount();
      wrapper = mount(CustomChartConfirmDialog, {
        props: { title: "T", message: "M" },
        global: {
          plugins: [i18n, store],
          stubs: {
            ODialog: ODialogStub,
            "q-banner": QBannerStub,
            "q-icon": QIconStub,
            "q-checkbox": QCheckboxStub,
          },
        },
      });
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("open")).toBe(false);
    });

    it("renders i18n labels on the primary and secondary buttons", () => {
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("primaryButtonLabel")).toBe("OK");
      expect(dialog.props("secondaryButtonLabel")).toBe("Cancel");
    });
  });

  describe("Size computation", () => {
    it("uses size 'sm' when no warningMessage is provided", () => {
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("size")).toBe("sm");
    });

    it("uses size 'sm' when warningMessage is an empty string", () => {
      wrapper.unmount();
      wrapper = buildWrapper({ warningMessage: "" });
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("size")).toBe("sm");
    });

    it("uses size 'md' when a non-empty warningMessage is provided", () => {
      wrapper.unmount();
      wrapper = buildWrapper({ warningMessage: "Heads up" });
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("size")).toBe("md");
    });
  });

  describe("Warning banner rendering", () => {
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

    it("renders the warning icon inside the banner", () => {
      wrapper.unmount();
      wrapper = buildWrapper({ warningMessage: "Heads up" });
      const icon = wrapper.find('[data-test="q-icon"]');
      expect(icon.exists()).toBe(true);
      expect(icon.attributes("data-name")).toBe("warning");
    });

    it("applies dark-theme banner classes when store theme is dark", () => {
      store.state.theme = "dark";
      wrapper.unmount();
      wrapper = buildWrapper({ warningMessage: "Be careful" });
      const banner = wrapper.find('[data-test="q-banner"]');
      const cls = banner.classes().join(" ");
      expect(cls).toContain("tw:bg-gray-800/60");
      expect(cls).toContain("tw:border-yellow-600/70");
    });

    it("applies light-theme banner classes when store theme is light", () => {
      store.state.theme = "light";
      wrapper.unmount();
      wrapper = buildWrapper({ warningMessage: "Be careful" });
      const banner = wrapper.find('[data-test="q-banner"]');
      const cls = banner.classes().join(" ");
      expect(cls).toContain("tw:bg-orange-50");
      expect(cls).toContain("tw:border-orange-400");
    });

    it("applies dark-theme icon class when store theme is dark", () => {
      store.state.theme = "dark";
      wrapper.unmount();
      wrapper = buildWrapper({ warningMessage: "Heads up" });
      const icon = wrapper.find('[data-test="q-icon"]');
      expect(icon.classes().join(" ")).toContain("tw:text-yellow-500/80");
    });

    it("applies light-theme icon class when store theme is light", () => {
      store.state.theme = "light";
      wrapper.unmount();
      wrapper = buildWrapper({ warningMessage: "Heads up" });
      const icon = wrapper.find('[data-test="q-icon"]');
      expect(icon.classes().join(" ")).toContain("tw:text-orange-500");
    });
  });

  describe("Replace-query checkbox", () => {
    it("does not render the checkbox when currentQuery is empty", () => {
      expect(wrapper.find('[data-test="replace-query-checkbox"]').exists()).toBe(false);
    });

    it("does not render the checkbox when currentQuery is only whitespace", () => {
      wrapper.unmount();
      wrapper = buildWrapper({ currentQuery: "   " });
      expect(wrapper.find('[data-test="replace-query-checkbox"]').exists()).toBe(false);
    });

    it("renders the checkbox when currentQuery is a non-empty string", () => {
      wrapper.unmount();
      wrapper = buildWrapper({ currentQuery: "SELECT * FROM logs" });
      expect(wrapper.find('[data-test="replace-query-checkbox"]').exists()).toBe(true);
    });

    it("hasQuery is false when currentQuery is empty", () => {
      expect(wrapper.vm.hasQuery).toBe(false);
    });

    it("hasQuery is true when currentQuery is a non-empty string", () => {
      wrapper.unmount();
      wrapper = buildWrapper({ currentQuery: "SELECT 1" });
      expect(wrapper.vm.hasQuery).toBe(true);
    });

    it("defaults replaceQuery to true when there is no current query", () => {
      expect(wrapper.vm.replaceQuery).toBe(true);
    });

    it("defaults replaceQuery to false when a current query exists", () => {
      wrapper.unmount();
      wrapper = buildWrapper({ currentQuery: "SELECT 1" });
      expect(wrapper.vm.replaceQuery).toBe(false);
    });

    it("applies dark-theme text class to the checkbox when store theme is dark", () => {
      store.state.theme = "dark";
      wrapper.unmount();
      wrapper = buildWrapper({ currentQuery: "SELECT 1" });
      const checkbox = wrapper.find('[data-test="replace-query-checkbox"]');
      expect(checkbox.classes().join(" ")).toContain("tw:text-gray-300");
    });

    it("applies light-theme text class to the checkbox when store theme is light", () => {
      store.state.theme = "light";
      wrapper.unmount();
      wrapper = buildWrapper({ currentQuery: "SELECT 1" });
      const checkbox = wrapper.find('[data-test="replace-query-checkbox"]');
      expect(checkbox.classes().join(" ")).toContain("tw:text-gray-700");
    });

    it("updates replaceQuery when the checkbox emits update:modelValue", async () => {
      wrapper.unmount();
      wrapper = buildWrapper({ currentQuery: "SELECT 1" });
      expect(wrapper.vm.replaceQuery).toBe(false);

      const checkbox = wrapper.findComponent(QCheckboxStub);
      await checkbox.vm.$emit("update:modelValue", true);
      expect(wrapper.vm.replaceQuery).toBe(true);
    });
  });

  describe("Event emissions: primary (confirm)", () => {
    it("emits update:ok with replaceQuery=true when no query is present", async () => {
      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:primary");

      expect(wrapper.emitted("update:ok")).toBeTruthy();
      expect(wrapper.emitted("update:ok")).toHaveLength(1);
      expect(wrapper.emitted("update:ok")![0]).toEqual([{ replaceQuery: true }]);
    });

    it("emits update:ok with replaceQuery=false by default when a query is present", async () => {
      wrapper.unmount();
      wrapper = buildWrapper({ currentQuery: "SELECT 1" });
      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:primary");

      expect(wrapper.emitted("update:ok")![0]).toEqual([{ replaceQuery: false }]);
    });

    it("emits update:ok with replaceQuery=true after the user checks the checkbox", async () => {
      wrapper.unmount();
      wrapper = buildWrapper({ currentQuery: "SELECT 1" });

      const checkbox = wrapper.findComponent(QCheckboxStub);
      await checkbox.vm.$emit("update:modelValue", true);

      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:primary");

      expect(wrapper.emitted("update:ok")![0]).toEqual([{ replaceQuery: true }]);
    });

    it("emits update:modelValue=false alongside update:ok when primary is clicked", async () => {
      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:primary");

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")![0]).toEqual([false]);
    });

    it("does not emit update:cancel when primary is clicked", async () => {
      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:primary");
      expect(wrapper.emitted("update:cancel")).toBeFalsy();
    });
  });

  describe("Event emissions: secondary (cancel)", () => {
    it("emits update:cancel when secondary is clicked", async () => {
      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:secondary");

      expect(wrapper.emitted("update:cancel")).toBeTruthy();
      expect(wrapper.emitted("update:cancel")).toHaveLength(1);
    });

    it("emits update:modelValue=false alongside update:cancel when secondary is clicked", async () => {
      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:secondary");

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")![0]).toEqual([false]);
    });

    it("does not emit update:ok when secondary is clicked", async () => {
      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:secondary");
      expect(wrapper.emitted("update:ok")).toBeFalsy();
    });
  });

  describe("Exposed methods", () => {
    it("exposes onCancel and onConfirm as functions", () => {
      expect(typeof (wrapper.vm as any).onCancel).toBe("function");
      expect(typeof (wrapper.vm as any).onConfirm).toBe("function");
    });

    it("emits update:ok with the replaceQuery payload when onConfirm is invoked directly", () => {
      (wrapper.vm as any).onConfirm();
      expect(wrapper.emitted("update:ok")).toHaveLength(1);
      expect(wrapper.emitted("update:ok")![0]).toEqual([{ replaceQuery: true }]);
    });

    it("emits update:cancel when onCancel is invoked directly", () => {
      (wrapper.vm as any).onCancel();
      expect(wrapper.emitted("update:cancel")).toHaveLength(1);
    });
  });

  describe("Edge cases", () => {
    it("renders multiple events when buttons are clicked multiple times", async () => {
      const dialog = wrapper.findComponent(ODialogStub);

      await dialog.vm.$emit("click:secondary");
      await dialog.vm.$emit("click:primary");
      await dialog.vm.$emit("click:secondary");

      expect(wrapper.emitted("update:cancel")).toHaveLength(2);
      expect(wrapper.emitted("update:ok")).toHaveLength(1);
    });

    it("unmounts cleanly", () => {
      expect(() => wrapper.unmount()).not.toThrow();
    });
  });
});
