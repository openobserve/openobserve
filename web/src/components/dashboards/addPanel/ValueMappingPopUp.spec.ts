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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import ValueMappingPopUp from "@/components/dashboards/addPanel/ValueMappingPopUp.vue";
import i18n from "@/locales";

installQuasar({
  plugins: [Dialog, Notify],
});

// Stub ODialog so tests are deterministic (no Portal/Reka teleport)
// and so we can drive the dialog's primary/neutral buttons via emit.
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
      :data-test="$attrs['data-test'] || 'o-dialog-stub'"
      :data-open="String(open)"
      :data-title="title"
      :data-width="width"
      :data-neutral-label="neutralButtonLabel"
      :data-neutral-variant="neutralButtonVariant"
      :data-primary-label="primaryButtonLabel"
    >
      <span data-test="o-dialog-stub-title">{{ title }}</span>
      <slot name="header" />
      <slot name="header-left" />
      <slot name="header-right" />
      <slot />
      <slot name="footer" />
      <button
        data-test="o-dialog-stub-primary"
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

describe("ValueMappingPopUp", () => {
  let wrapper: VueWrapper<any>;

  const defaultProps = {
    open: true,
    valueMapping: [
      {
        type: "value",
        value: "100",
        text: "Excellent",
        color: "#00ff00",
      },
    ],
  };

  const createWrapper = (props: Record<string, any> = {}) => {
    return mount(ValueMappingPopUp, {
      props: {
        ...defaultProps,
        ...props,
      },
      global: {
        plugins: [i18n],
        stubs: {
          ODialog: ODialogStub,
          draggable: {
            name: "draggable",
            template: "<div><slot></slot></div>",
            props: ["modelValue", "options"],
            emits: ["update:modelValue"],
          },
        },
        mocks: {
          $t: (key: string) => key,
        },
      },
    });
  };

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.clearAllMocks();
  });

  describe("Component Rendering", () => {
    it("should render the ODialog stub wrapper", () => {
      wrapper = createWrapper();
      expect(
        wrapper.find('[data-test="dashboard-value-mapping-popup"]').exists(),
      ).toBe(true);
    });

    it("should forward title to ODialog", () => {
      wrapper = createWrapper();
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("title")).toBe("Value Mappings");
    });

    it("should forward open=true to ODialog when open prop is true", () => {
      wrapper = createWrapper({ open: true });
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("open")).toBe(true);
    });

    it("should forward open=false to ODialog when open prop is false", () => {
      wrapper = createWrapper({ open: false });
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("open")).toBe(false);
    });

    it("should forward width 70 to ODialog", () => {
      wrapper = createWrapper();
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("width")).toBe(70);
    });

    it("should pass the Add-new mapping label as the neutral button label", () => {
      wrapper = createWrapper();
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("neutralButtonLabel")).toBe("+ Add a new mapping");
    });

    it("should pass outline as the neutral button variant", () => {
      wrapper = createWrapper();
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("neutralButtonVariant")).toBe("outline");
    });

    it("should pass the Apply label as the primary button label", () => {
      wrapper = createWrapper();
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("primaryButtonLabel")).toBe("Apply");
    });

    it("should render the draggable container", () => {
      wrapper = createWrapper();
      expect(
        wrapper
          .find('[data-test="dashboard-addpanel-config-value-mapping-drag"]')
          .exists(),
      ).toBe(true);
    });
  });

  describe("Props Handling", () => {
    it("should accept valueMapping prop", () => {
      const mappings = [
        { type: "value", value: "200", text: "Good", color: "#ffff00" },
        { type: "range", from: "0", to: "50", text: "Low", color: "#ff0000" },
      ];
      wrapper = createWrapper({ valueMapping: mappings });
      expect(wrapper.props("valueMapping")).toEqual(mappings);
    });

    it("should add a default mapping when valueMapping prop is empty", () => {
      wrapper = createWrapper({ valueMapping: [] });

      expect(wrapper.vm.editedValueMapping.length).toBe(1);
      expect(wrapper.vm.editedValueMapping[0]).toEqual({
        type: "value",
        value: "",
        text: "",
        color: null,
      });
    });

    it("should default valueMapping to an empty array when undefined", () => {
      wrapper = createWrapper({ valueMapping: undefined });
      expect(Array.isArray(wrapper.props("valueMapping"))).toBe(true);
    });

    it("should require the open prop", () => {
      wrapper = createWrapper({ open: true });
      expect(wrapper.props("open")).toBe(true);
    });
  });

  describe("Component Structure", () => {
    it("should have correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("ValueMappingPopUp");
    });

    it("should expose addValueMapping as a function", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.addValueMapping).toBe("function");
    });

    it("should expose removeValueMappingByIndex as a function", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.removeValueMappingByIndex).toBe("function");
    });

    it("should expose setColorByIndex as a function", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.setColorByIndex).toBe("function");
    });

    it("should expose removeColorByIndex as a function", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.removeColorByIndex).toBe("function");
    });

    it("should expose applyValueMapping as a function", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.applyValueMapping).toBe("function");
    });

    it("should expose cancelEdit as a function", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.cancelEdit).toBe("function");
    });

    it("should initialise editedValueMapping from the valueMapping prop", () => {
      const mappings = [
        { type: "regex", pattern: "test.*", text: "Test", color: null },
      ];
      wrapper = createWrapper({ valueMapping: mappings });
      expect(wrapper.vm.editedValueMapping).toEqual(mappings);
    });

    it("should configure dragOptions with animation 200", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.dragOptions).toEqual({ animation: 200 });
    });

    it("should expose outlinedCancel icon", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.outlinedCancel).toBe("string");
    });
  });

  describe("Mapping Types", () => {
    it("should have the value/range/regex mapping types defined", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.mappingTypes).toEqual([
        { label: "Value", value: "value" },
        { label: "Range", value: "range" },
        { label: "Regex", value: "regex" },
      ]);
    });

    it("should render a type select for each mapping row", () => {
      wrapper = createWrapper();
      expect(
        wrapper
          .find(
            '[data-test="dashboard-addpanel-config-value-mapping-type-select-0"]',
          )
          .exists(),
      ).toBe(true);
    });
  });

  describe("Value Type Mapping", () => {
    it("should render the value input for a value-type mapping", () => {
      const mappings = [
        { type: "value", value: "test", text: "Test", color: null },
      ];
      wrapper = createWrapper({ valueMapping: mappings });
      expect(
        wrapper
          .find(
            '[data-test="dashboard-addpanel-config-value-mapping-value-input-0"]',
          )
          .exists(),
      ).toBe(true);
    });

    it("should not render range inputs for a value-type mapping", () => {
      const mappings = [
        { type: "value", value: "test", text: "Test", color: null },
      ];
      wrapper = createWrapper({ valueMapping: mappings });
      expect(
        wrapper
          .find(
            '[data-test="dashboard-addpanel-config-value-mapping-from-input-0"]',
          )
          .exists(),
      ).toBe(false);
      expect(
        wrapper
          .find(
            '[data-test="dashboard-addpanel-config-value-mapping-to-input-0"]',
          )
          .exists(),
      ).toBe(false);
    });

    it("should not render the pattern input for a value-type mapping", () => {
      const mappings = [
        { type: "value", value: "test", text: "Test", color: null },
      ];
      wrapper = createWrapper({ valueMapping: mappings });
      expect(
        wrapper
          .find(
            '[data-test="dashboard-addpanel-config-value-mapping-pattern-input-0"]',
          )
          .exists(),
      ).toBe(false);
    });
  });

  describe("Range Type Mapping", () => {
    it("should render from and to inputs for a range-type mapping", () => {
      const mappings = [
        { type: "range", from: "0", to: "100", text: "Range", color: null },
      ];
      wrapper = createWrapper({ valueMapping: mappings });
      expect(
        wrapper
          .find(
            '[data-test="dashboard-addpanel-config-value-mapping-from-input-0"]',
          )
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find(
            '[data-test="dashboard-addpanel-config-value-mapping-to-input-0"]',
          )
          .exists(),
      ).toBe(true);
    });

    it("should not render the value input for a range-type mapping", () => {
      const mappings = [
        { type: "range", from: "0", to: "100", text: "Range", color: null },
      ];
      wrapper = createWrapper({ valueMapping: mappings });
      expect(
        wrapper
          .find(
            '[data-test="dashboard-addpanel-config-value-mapping-value-input-0"]',
          )
          .exists(),
      ).toBe(false);
    });

    it("should not render the pattern input for a range-type mapping", () => {
      const mappings = [
        { type: "range", from: "0", to: "100", text: "Range", color: null },
      ];
      wrapper = createWrapper({ valueMapping: mappings });
      expect(
        wrapper
          .find(
            '[data-test="dashboard-addpanel-config-value-mapping-pattern-input-0"]',
          )
          .exists(),
      ).toBe(false);
    });
  });

  describe("Regex Type Mapping", () => {
    it("should render the pattern input for a regex-type mapping", () => {
      const mappings = [
        { type: "regex", pattern: "test.*", text: "Test", color: null },
      ];
      wrapper = createWrapper({ valueMapping: mappings });
      expect(
        wrapper
          .find(
            '[data-test="dashboard-addpanel-config-value-mapping-pattern-input-0"]',
          )
          .exists(),
      ).toBe(true);
    });

    it("should not render the value input for a regex-type mapping", () => {
      const mappings = [
        { type: "regex", pattern: "test.*", text: "Test", color: null },
      ];
      wrapper = createWrapper({ valueMapping: mappings });
      expect(
        wrapper
          .find(
            '[data-test="dashboard-addpanel-config-value-mapping-value-input-0"]',
          )
          .exists(),
      ).toBe(false);
    });

    it("should not render range inputs for a regex-type mapping", () => {
      const mappings = [
        { type: "regex", pattern: "test.*", text: "Test", color: null },
      ];
      wrapper = createWrapper({ valueMapping: mappings });
      expect(
        wrapper
          .find(
            '[data-test="dashboard-addpanel-config-value-mapping-from-input-0"]',
          )
          .exists(),
      ).toBe(false);
      expect(
        wrapper
          .find(
            '[data-test="dashboard-addpanel-config-value-mapping-to-input-0"]',
          )
          .exists(),
      ).toBe(false);
    });
  });

  describe("Text Input", () => {
    it("should render the display-value text input for every mapping", () => {
      wrapper = createWrapper();
      expect(
        wrapper
          .find(
            '[data-test="dashboard-addpanel-config-value-mapping-text-input-0"]',
          )
          .exists(),
      ).toBe(true);
    });
  });

  describe("Color Management", () => {
    it("should keep the mapping color when one is provided", () => {
      const mappings = [
        { type: "value", value: "test", text: "Test", color: "#ff0000" },
      ];
      wrapper = createWrapper({ valueMapping: mappings });
      expect(wrapper.vm.editedValueMapping[0].color).toBe("#ff0000");
    });

    it("should show the Set color button when mapping color is null", () => {
      const mappings = [
        { type: "value", value: "test", text: "Test", color: null },
      ];
      wrapper = createWrapper({ valueMapping: mappings });
      expect(wrapper.text()).toContain("Set color");
    });

    it("should set color to #000000 when setColorByIndex is called", () => {
      const mappings = [
        { type: "value", value: "test", text: "Test", color: null },
      ];
      wrapper = createWrapper({ valueMapping: mappings });
      wrapper.vm.setColorByIndex(0);
      expect(wrapper.vm.editedValueMapping[0].color).toBe("#000000");
    });

    it("should clear color when removeColorByIndex is called", () => {
      const mappings = [
        { type: "value", value: "test", text: "Test", color: "#ff0000" },
      ];
      wrapper = createWrapper({ valueMapping: mappings });
      wrapper.vm.removeColorByIndex(0);
      expect(wrapper.vm.editedValueMapping[0].color).toBe(null);
    });
  });

  describe("Drag and Drop", () => {
    it("should render a drag handle for every mapping", () => {
      wrapper = createWrapper();
      expect(
        wrapper
          .find(
            '[data-test="dashboard-addpanel-config-value-mapping-drag-handle-0"]',
          )
          .exists(),
      ).toBe(true);
    });

    it("should bind draggable's modelValue to editedValueMapping", () => {
      wrapper = createWrapper();
      const draggable = wrapper.findComponent({ name: "draggable" });
      expect(draggable.exists()).toBe(true);
      expect(draggable.props("modelValue")).toBe(wrapper.vm.editedValueMapping);
    });

    it("should pass dragOptions to the draggable", () => {
      wrapper = createWrapper();
      const draggable = wrapper.findComponent({ name: "draggable" });
      expect(draggable.exists()).toBe(true);
      expect(draggable.props("options")).toEqual({ animation: 200 });
    });
  });

  describe("Mapping Management", () => {
    it("should add a default mapping when addValueMapping is called", () => {
      wrapper = createWrapper({ valueMapping: [] });
      const initialLength = wrapper.vm.editedValueMapping.length;
      wrapper.vm.addValueMapping();
      expect(wrapper.vm.editedValueMapping.length).toBe(initialLength + 1);
      expect(
        wrapper.vm.editedValueMapping[wrapper.vm.editedValueMapping.length - 1],
      ).toEqual({
        type: "value",
        value: "",
        text: "",
        color: null,
      });
    });

    it("should remove the mapping at the given index", () => {
      const mappings = [
        { type: "value", value: "1", text: "One", color: null },
        { type: "value", value: "2", text: "Two", color: null },
      ];
      wrapper = createWrapper({ valueMapping: mappings });
      wrapper.vm.removeValueMappingByIndex(0);
      expect(wrapper.vm.editedValueMapping.length).toBe(1);
      expect(wrapper.vm.editedValueMapping[0].value).toBe("2");
    });

    it("should render a delete button per mapping row", () => {
      wrapper = createWrapper();
      expect(
        wrapper
          .find(
            '[data-test="dashboard-addpanel-config-value-mapping-delete-btn-0"]',
          )
          .exists(),
      ).toBe(true);
    });

    it("should remove the mapping when its delete button is clicked", async () => {
      const mappings = [
        { type: "value", value: "1", text: "One", color: null },
        { type: "value", value: "2", text: "Two", color: null },
      ];
      wrapper = createWrapper({ valueMapping: mappings });
      const deleteBtn = wrapper.find(
        '[data-test="dashboard-addpanel-config-value-mapping-delete-btn-0"]',
      );
      expect(deleteBtn.exists()).toBe(true);
      await deleteBtn.trigger("click");
      expect(wrapper.vm.editedValueMapping.length).toBe(1);
      expect(wrapper.vm.editedValueMapping[0].value).toBe("2");
    });
  });

  describe("Event Handling", () => {
    it("should emit save with editedValueMapping when applyValueMapping is called", () => {
      wrapper = createWrapper();
      wrapper.vm.applyValueMapping();
      expect(wrapper.emitted("save")).toBeTruthy();
      expect(wrapper.emitted("save")![0]).toEqual([wrapper.vm.editedValueMapping]);
    });

    it("should emit close when cancelEdit is called", () => {
      wrapper = createWrapper();
      wrapper.vm.cancelEdit();
      expect(wrapper.emitted("close")).toBeTruthy();
      expect(wrapper.emitted("close")!.length).toBe(1);
    });

    it("should emit save when the ODialog primary button is clicked", async () => {
      wrapper = createWrapper();
      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:primary");
      expect(wrapper.emitted("save")).toBeTruthy();
      expect(wrapper.emitted("save")![0]).toEqual([wrapper.vm.editedValueMapping]);
    });

    it("should add a new mapping when the ODialog neutral button is clicked", async () => {
      wrapper = createWrapper({ valueMapping: [] });
      const initialLength = wrapper.vm.editedValueMapping.length;
      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:neutral");
      expect(wrapper.vm.editedValueMapping.length).toBe(initialLength + 1);
    });

    it("should emit close when ODialog requests to close (update:open=false)", async () => {
      wrapper = createWrapper();
      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("update:open", false);
      expect(wrapper.emitted("close")).toBeTruthy();
      expect(wrapper.emitted("close")!.length).toBe(1);
    });

    it("should NOT emit close when ODialog reports it opened (update:open=true)", async () => {
      wrapper = createWrapper();
      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("update:open", true);
      expect(wrapper.emitted("close")).toBeFalsy();
    });

    it("should NOT emit save when the neutral button is clicked", async () => {
      wrapper = createWrapper();
      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:neutral");
      expect(wrapper.emitted("save")).toBeFalsy();
    });

    it("should NOT emit close when the primary button is clicked", async () => {
      wrapper = createWrapper();
      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:primary");
      expect(wrapper.emitted("close")).toBeFalsy();
    });
  });

  describe("Initialization", () => {
    it("should add a default mapping on mount when valueMapping is empty", () => {
      wrapper = createWrapper({ valueMapping: [] });
      expect(wrapper.vm.editedValueMapping.length).toBe(1);
      expect(wrapper.vm.editedValueMapping[0]).toEqual({
        type: "value",
        value: "",
        text: "",
        color: null,
      });
    });

    it("should not add a default mapping when valueMapping is provided", () => {
      const mappings = [
        { type: "value", value: "test", text: "Test", color: null },
      ];
      wrapper = createWrapper({ valueMapping: mappings });
      expect(wrapper.vm.editedValueMapping.length).toBe(1);
      expect(wrapper.vm.editedValueMapping[0]).toEqual(mappings[0]);
    });
  });

  describe("Multiple Mappings", () => {
    it("should render a row per mapping", () => {
      const mappings = [
        { type: "value", value: "1", text: "One", color: "#ff0000" },
        { type: "range", from: "10", to: "20", text: "Range", color: "#00ff00" },
        { type: "regex", pattern: "test.*", text: "Test", color: null },
      ];
      wrapper = createWrapper({ valueMapping: mappings });

      expect(
        wrapper
          .find(
            '[data-test="dashboard-addpanel-config-value-mapping-type-select-0"]',
          )
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find(
            '[data-test="dashboard-addpanel-config-value-mapping-type-select-1"]',
          )
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find(
            '[data-test="dashboard-addpanel-config-value-mapping-type-select-2"]',
          )
          .exists(),
      ).toBe(true);
    });

    it("should render the correct input per row based on mapping type", () => {
      const mappings = [
        { type: "value", value: "test", text: "Value", color: null },
        { type: "range", from: "0", to: "100", text: "Range", color: null },
        { type: "regex", pattern: ".*", text: "Regex", color: null },
      ];
      wrapper = createWrapper({ valueMapping: mappings });

      expect(
        wrapper
          .find(
            '[data-test="dashboard-addpanel-config-value-mapping-value-input-0"]',
          )
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find(
            '[data-test="dashboard-addpanel-config-value-mapping-from-input-1"]',
          )
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find(
            '[data-test="dashboard-addpanel-config-value-mapping-pattern-input-2"]',
          )
          .exists(),
      ).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should preserve type when other mapping properties are undefined", () => {
      const mappings = [{ type: "value" }];
      wrapper = createWrapper({ valueMapping: mappings });
      expect(wrapper.vm.editedValueMapping[0].type).toBe("value");
    });

    it("should accept an unknown mapping type without throwing", () => {
      const mappings = [{ type: "invalid", text: "Invalid", color: null }];
      wrapper = createWrapper({ valueMapping: mappings });
      expect(wrapper.vm.editedValueMapping[0].type).toBe("invalid");
    });

    it("should accept empty string value and text", () => {
      const mappings = [
        { type: "value", value: "", text: "", color: null },
      ];
      wrapper = createWrapper({ valueMapping: mappings });
      expect(wrapper.vm.editedValueMapping[0].value).toBe("");
      expect(wrapper.vm.editedValueMapping[0].text).toBe("");
    });

    it("should treat null color as no-color", () => {
      const mappings = [
        { type: "value", value: "1", text: "One", color: null },
      ];
      wrapper = createWrapper({ valueMapping: mappings });
      expect(wrapper.vm.editedValueMapping[0].color).toBe(null);
    });
  });

  describe("Accessibility", () => {
    it("should attach data-test attributes for each key element", () => {
      wrapper = createWrapper();
      expect(
        wrapper.find('[data-test="dashboard-value-mapping-popup"]').exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="dashboard-addpanel-config-value-mapping-drag"]')
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find(
            '[data-test="dashboard-addpanel-config-value-mapping-type-select-0"]',
          )
          .exists(),
      ).toBe(true);
    });
  });
});
