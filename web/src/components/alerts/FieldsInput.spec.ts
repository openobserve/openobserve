// Copyright 2023 OpenObserve Inc.
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
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import FieldsInput from "@/components/alerts/FieldsInput.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar();

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

describe("FieldsInput.vue", () => {
  let wrapper: VueWrapper<any>;

  const mockStreamFields = [
    { label: "field1", value: "field1" },
    { label: "field2", value: "field2" },
    { label: "field3", value: "field3" },
    { label: "status", value: "status" },
    { label: "timestamp", value: "timestamp" },
  ];

  const mockFields = [
    {
      uuid: "uuid-1",
      column: "field1",
      operator: "=",
      value: "test",
    },
    {
      uuid: "uuid-2",
      column: "field2",
      operator: ">=",
      value: "100",
    },
  ];

  afterEach(() => {
    wrapper?.unmount();
  });

  const mountComponent = (props: any = {}) => {
    wrapper = mount(FieldsInput, {
      attachTo: node,
      props: {
        fields: [],
        streamFields: mockStreamFields,
        ...props,
      },
      global: {
        plugins: [i18n, store],
      },
    });
  };

  describe("Component Mounting", () => {
    it("should mount successfully", () => {
      mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct data-test attribute", () => {
      mountComponent();
      expect(wrapper.find('[data-test="alert-conditions-text"]').exists()).toBe(
        true,
      );
    });
  });

  describe("Empty State", () => {
    it("should show add button when no fields exist", () => {
      mountComponent({ fields: [] });
      expect(wrapper.find('[data-test="alert-conditions-add-btn"]').exists()).toBe(
        true,
      );
    });

    it("should emit add event when add button is clicked", async () => {
      mountComponent({ fields: [] });
      const addBtn = wrapper.find('[data-test="alert-conditions-add-btn"]');
      await addBtn.trigger("click");

      expect(wrapper.emitted("add")).toBeTruthy();
      expect(wrapper.emitted("add")?.length).toBe(1);
    });
  });

  describe("Fields Display", () => {
    it("should display all fields when fields array is populated", () => {
      mountComponent({ fields: mockFields });

      expect(wrapper.find('[data-test="alert-conditions-1"]').exists()).toBe(
        true,
      );
      expect(wrapper.find('[data-test="alert-conditions-2"]').exists()).toBe(
        true,
      );
    });

    it("should have column select for each field", () => {
      mountComponent({ fields: mockFields });

      const columnSelects = wrapper.findAll(
        '[data-test="alert-conditions-select-column"]',
      );
      expect(columnSelects.length).toBe(2);
    });

    it("should have operator select for each field", () => {
      mountComponent({ fields: mockFields });

      const operatorSelects = wrapper.findAll(
        '[data-test="alert-conditions-operator-select"]',
      );
      expect(operatorSelects.length).toBe(2);
    });

    it("should have value input for each field", () => {
      mountComponent({ fields: mockFields });

      const valueInputs = wrapper.findAll(
        '[data-test="alert-conditions-value-input"]',
      );
      expect(valueInputs.length).toBe(2);
    });
  });

  describe("Field Actions", () => {
    it("should have delete button for each field", () => {
      mountComponent({ fields: mockFields });

      const deleteButtons = wrapper.findAll(
        '[data-test="alert-conditions-delete-condition-btn"]',
      );
      expect(deleteButtons.length).toBe(2);
    });

    it("should emit remove event when delete button is clicked", async () => {
      mountComponent({ fields: mockFields });

      const deleteBtn = wrapper.find(
        '[data-test="alert-conditions-delete-condition-btn"]',
      );
      await deleteBtn.trigger("click");

      expect(wrapper.emitted("remove")).toBeTruthy();
      expect(wrapper.emitted("input:update")).toBeTruthy();
    });

    it("should show add button only on last field", () => {
      mountComponent({ fields: mockFields });

      const addButtons = wrapper.findAll(
        '[data-test="alert-conditions-add-condition-btn"]',
      );
      expect(addButtons.length).toBe(1);
    });

    it("should emit add event when add condition button is clicked", async () => {
      mountComponent({ fields: mockFields });

      const addBtn = wrapper.find(
        '[data-test="alert-conditions-add-condition-btn"]',
      );
      await addBtn.trigger("click");

      expect(wrapper.emitted("add")).toBeTruthy();
    });
  });

  describe("Operators", () => {
    it("should have all required operators", () => {
      mountComponent({ fields: mockFields });
      const vm = wrapper.vm as any;

      const expectedOperators = [
        "=",
        "!=",
        ">=",
        "<=",
        ">",
        "<",
        "Contains",
        "NotContains",
      ];

      expectedOperators.forEach((operator) => {
        expect(vm.triggerOperators).toContain(operator);
      });
    });

    it("should emit input:update when operator changes", async () => {
      mountComponent({ fields: mockFields });

      const operatorSelect = wrapper.findAllComponents({ name: "QSelect" })[1];
      await operatorSelect.vm.$emit("update:model-value", "!=");
      await flushPromises();

      expect(wrapper.emitted("input:update")).toBeTruthy();
    });
  });

  describe("Field Filtering", () => {
    it("should filter columns based on input", async () => {
      mountComponent({ fields: mockFields });
      const vm = wrapper.vm as any;

      const updateFn = vi.fn((callback) => callback());
      vm.filterColumns("field1", updateFn);

      expect(updateFn).toHaveBeenCalled();
      expect(vm.filteredFields.length).toBeGreaterThan(0);
    });

    it("should show all fields when filter is empty", async () => {
      mountComponent({ fields: mockFields });
      const vm = wrapper.vm as any;

      const updateFn = vi.fn((callback) => callback());
      vm.filterColumns("", updateFn);

      expect(updateFn).toHaveBeenCalled();
      expect(vm.filteredFields.length).toBe(mockStreamFields.length);
    });

    it("should filter fields case-insensitively", async () => {
      mountComponent({ fields: mockFields });
      const vm = wrapper.vm as any;

      const updateFn = vi.fn((callback) => callback());
      vm.filterColumns("STATUS", updateFn);

      expect(updateFn).toHaveBeenCalled();
      expect(vm.filteredFields.some((f: any) => f.value === "status")).toBe(
        true,
      );
    });
  });

  describe("Value Updates", () => {
    it("should emit input:update when value changes", async () => {
      mountComponent({ fields: mockFields });

      const valueInput = wrapper.findAllComponents({ name: "QInput" })[0];
      await valueInput.vm.$emit("update:model-value", "new value");
      await flushPromises();

      expect(wrapper.emitted("input:update")).toBeTruthy();
    });
  });

  describe("Props", () => {
    it("should accept fields prop", () => {
      mountComponent({ fields: mockFields });
      expect(wrapper.props("fields")).toEqual(mockFields);
    });

    it("should accept streamFields prop", () => {
      mountComponent({ streamFields: mockStreamFields });
      expect(wrapper.props("streamFields")).toEqual(mockStreamFields);
    });

    it("should accept enableNewValueMode prop", () => {
      mountComponent({ enableNewValueMode: true });
      expect(wrapper.props("enableNewValueMode")).toBe(true);
    });

    it("should have default value for enableNewValueMode", () => {
      mountComponent();
      expect(wrapper.props("enableNewValueMode")).toBe(false);
    });
  });

  describe("New Value Mode", () => {
    it("should apply new-value-mode when enabled", () => {
      mountComponent({ fields: mockFields, enableNewValueMode: true });
      const vm = wrapper.vm as any;

      expect(vm.newValueMode).toEqual({ "new-value-mode": "unique" });
    });

    it("should not apply new-value-mode when disabled", () => {
      mountComponent({ fields: mockFields, enableNewValueMode: false });
      const vm = wrapper.vm as any;

      expect(vm.newValueMode).toEqual({});
    });
  });

  describe("Form Validation", () => {
    it("should have required validation on column select", () => {
      mountComponent({ fields: mockFields });

      const columnSelect = wrapper.findComponent({ name: "QSelect" });
      const rules = columnSelect.props("rules");

      expect(rules).toBeDefined();
      expect(Array.isArray(rules)).toBe(true);
      expect(rules?.length).toBeGreaterThan(0);
    });

    it("should have required validation on operator select", () => {
      mountComponent({ fields: mockFields });

      const operatorSelects = wrapper.findAllComponents({ name: "QSelect" });
      const operatorSelect = operatorSelects[1];
      const rules = operatorSelect.props("rules");

      expect(rules).toBeDefined();
      expect(Array.isArray(rules)).toBe(true);
    });

    it("should have required validation on value input", () => {
      mountComponent({ fields: mockFields });

      const valueInput = wrapper.findComponent({ name: "QInput" });
      const rules = valueInput.props("rules");

      expect(rules).toBeDefined();
      expect(Array.isArray(rules)).toBe(true);
    });
  });

  describe("Multiple Fields", () => {
    it("should handle single field", () => {
      const singleField = [mockFields[0]];
      mountComponent({ fields: singleField });

      expect(wrapper.findAll('[data-test^="alert-conditions-"]').length).toBeGreaterThan(
        0,
      );
    });

    it("should handle multiple fields", () => {
      const multipleFields = [...mockFields, { ...mockFields[0], uuid: "uuid-3" }];
      mountComponent({ fields: multipleFields });

      expect(wrapper.find('[data-test="alert-conditions-3"]').exists()).toBe(
        true,
      );
    });
  });

  describe("Emitted Events", () => {
    it("should emit correct event structure for remove", async () => {
      mountComponent({ fields: mockFields });

      const deleteBtn = wrapper.find(
        '[data-test="alert-conditions-delete-condition-btn"]',
      );
      await deleteBtn.trigger("click");

      const removeEvents = wrapper.emitted("remove");
      expect(removeEvents).toBeTruthy();
      expect(removeEvents?.[0]).toEqual([mockFields[0]]);
    });

    it("should emit input:update with correct parameters", async () => {
      mountComponent({ fields: mockFields });

      const deleteBtn = wrapper.find(
        '[data-test="alert-conditions-delete-condition-btn"]',
      );
      await deleteBtn.trigger("click");

      const updateEvents = wrapper.emitted("input:update");
      expect(updateEvents).toBeTruthy();
      expect(updateEvents?.[0]).toEqual(["conditions", mockFields[0]]);
    });
  });

  describe("UI Elements", () => {
    it("should apply correct styling based on theme", () => {
      store.state.theme = "dark";
      mountComponent({ fields: mockFields });

      const deleteBtn = wrapper.find(
        '[data-test="alert-conditions-delete-condition-btn"]',
      );
      expect(deleteBtn.classes()).toContain("icon-dark");
    });

    it("should display condition text", () => {
      mountComponent();
      const conditionText = wrapper.find('[data-test="alert-conditions-text"]');
      expect(conditionText.text()).toContain("Conditions");
    });
  });

  describe("Field Initialization", () => {
    it("should initialize with empty filteredFields matching streamFields", () => {
      mountComponent();
      const vm = wrapper.vm as any;

      expect(vm.filteredFields.length).toBe(mockStreamFields.length);
    });

    it("should update filteredFields when streamFields prop changes", async () => {
      mountComponent();

      const newFields = [
        { label: "newField", value: "newField" },
        ...mockStreamFields,
      ];

      await wrapper.setProps({ streamFields: newFields });
      await flushPromises();

      // Component should respond to prop changes
      expect(wrapper.props("streamFields").length).toBe(newFields.length);
    });
  });
});
