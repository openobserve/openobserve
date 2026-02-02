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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers";
import { Dialog, Notify } from "quasar";
import Advanced, { type Variable } from "./Advanced.vue";
import i18n from "@/locales";

installQuasar({
  plugins: [Dialog, Notify],
});

// Mock getUUID
vi.mock("@/utils/zincutils", () => ({
  getUUID: vi.fn(() => "mock-uuid-" + Math.random()),
  b64EncodeUnicode: vi.fn((str: string) => btoa(str)),
  b64DecodeUnicode: vi.fn((str: string) => atob(str)),
}));

const createMockStore = (overrides = {}) => ({
  state: {
    theme: "light",
    zoConfig: {
      build_type: "opensource",
    },
    ...overrides,
  },
  dispatch: vi.fn(),
  commit: vi.fn(),
});

describe("Advanced.vue", () => {
  let wrapper: VueWrapper<any>;
  let mockStore: any;

  beforeEach(() => {
    mockStore = createMockStore();
    wrapper = mount(Advanced, {
      global: {
        mocks: {
          $store: mockStore,
        },
        provide: {
          store: mockStore,
        },
        plugins: [i18n],
      },
      props: {
        contextAttributes: [],
        description: "",
        rowTemplate: "",
        rowTemplateType: "String",
      },
    });
  });

  describe("Initialization", () => {
    it("should mount component successfully", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm).toBeTruthy();
    });

    it("should render with correct theme class (light mode)", () => {
      expect(wrapper.classes()).toContain("light-mode");
    });

    it("should render with correct theme class (dark mode)", async () => {
      mockStore = createMockStore({ theme: "dark" });
      wrapper = mount(Advanced, {
        global: {
          mocks: { $store: mockStore },
          provide: { store: mockStore },
          plugins: [i18n],
        },
        props: {
          contextAttributes: [],
          description: "",
          rowTemplate: "",
          rowTemplateType: "String",
        },
      });
      expect(wrapper.classes()).toContain("dark-mode");
    });

    it("should initialize with empty variables", () => {
      expect(wrapper.vm.localVariables).toEqual([]);
    });

    it("should initialize with empty description", () => {
      expect(wrapper.vm.localDescription).toBe("");
    });

    it("should initialize with empty row template", () => {
      expect(wrapper.vm.localRowTemplate).toBe("");
    });

    it("should initialize row template type as String", () => {
      expect(wrapper.vm.localRowTemplateType).toBe("String");
    });
  });

  describe("Props", () => {
    it("should accept contextAttributes prop", async () => {
      const variables: Variable[] = [
        { id: "1", key: "env", value: "production" },
      ];
      await wrapper.setProps({ contextAttributes: variables });
      expect(wrapper.vm.localVariables).toEqual(variables);
    });

    it("should accept description prop", async () => {
      await wrapper.setProps({ description: "Test description" });
      expect(wrapper.vm.localDescription).toBe("Test description");
    });

    it("should accept rowTemplate prop", async () => {
      await wrapper.setProps({ rowTemplate: "Alert: {message}" });
      expect(wrapper.vm.localRowTemplate).toBe("Alert: {message}");
    });

    it("should accept rowTemplateType prop", async () => {
      await wrapper.setProps({ rowTemplateType: "Json" });
      expect(wrapper.vm.localRowTemplateType).toBe("Json");
    });

    it("should use default empty array for contextAttributes", () => {
      expect(wrapper.props("contextAttributes")).toEqual([]);
    });

    it("should use default empty string for description", () => {
      expect(wrapper.props("description")).toBe("");
    });

    it("should use default empty string for rowTemplate", () => {
      expect(wrapper.props("rowTemplate")).toBe("");
    });

    it("should use default String for rowTemplateType", () => {
      expect(wrapper.props("rowTemplateType")).toBe("String");
    });

    it("should handle contextAttributes prop updates", async () => {
      const variables: Variable[] = [
        { id: "1", key: "env", value: "staging" },
      ];
      await wrapper.setProps({ contextAttributes: variables });
      await flushPromises();
      expect(wrapper.vm.localVariables).toEqual(variables);
    });

    it("should handle description prop updates", async () => {
      await wrapper.setProps({ description: "Updated description" });
      await flushPromises();
      expect(wrapper.vm.localDescription).toBe("Updated description");
    });

    it("should handle rowTemplate prop updates", async () => {
      await wrapper.setProps({ rowTemplate: "New template" });
      await flushPromises();
      expect(wrapper.vm.localRowTemplate).toBe("New template");
    });

    it("should handle rowTemplateType prop updates", async () => {
      await wrapper.setProps({ rowTemplateType: "Json" });
      await flushPromises();
      expect(wrapper.vm.localRowTemplateType).toBe("Json");
    });
  });

  describe("Variables Management", () => {
    it("should add a new variable", async () => {
      await wrapper.vm.addVariable();
      expect(wrapper.vm.localVariables.length).toBe(1);
      expect(wrapper.vm.localVariables[0]).toHaveProperty("id");
      expect(wrapper.vm.localVariables[0]).toHaveProperty("key", "");
      expect(wrapper.vm.localVariables[0]).toHaveProperty("value", "");
    });

    it("should remove a variable", async () => {
      await wrapper.vm.addVariable();
      const variable = wrapper.vm.localVariables[0];
      await wrapper.vm.removeVariable(variable);
      expect(wrapper.vm.localVariables.length).toBe(0);
    });

    it("should add multiple variables", async () => {
      await wrapper.vm.addVariable();
      await wrapper.vm.addVariable();
      await wrapper.vm.addVariable();
      expect(wrapper.vm.localVariables.length).toBe(3);
    });

    it("should remove specific variable by id", async () => {
      await wrapper.vm.addVariable();
      await wrapper.vm.addVariable();
      const firstVariable = wrapper.vm.localVariables[0];
      await wrapper.vm.removeVariable(firstVariable);
      expect(wrapper.vm.localVariables.length).toBe(1);
      expect(wrapper.vm.localVariables[0].id).not.toBe(firstVariable.id);
    });

    it("should generate unique ids for variables", async () => {
      await wrapper.vm.addVariable();
      await wrapper.vm.addVariable();
      const ids = wrapper.vm.localVariables.map((v: Variable) => v.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe("User Interactions - Variables", () => {
    it("should show add variable button when no variables exist", () => {
      const addBtn = wrapper.find('[data-test="alert-variables-add-btn"]');
      expect(addBtn.exists()).toBe(true);
    });

    it("should hide initial add button when variables exist", async () => {
      await wrapper.setProps({
        contextAttributes: [{ id: "1", key: "test", value: "value" }],
      });
      await flushPromises();
      const addBtn = wrapper.find('[data-test="alert-variables-add-btn"]');
      expect(addBtn.exists()).toBe(false);
    });

    it("should render variable inputs when variables exist", async () => {
      await wrapper.setProps({
        contextAttributes: [{ id: "1", key: "env", value: "prod" }],
      });
      await flushPromises();
      const keyInput = wrapper.find('[data-test="alert-variables-key-input"]');
      const valueInput = wrapper.find('[data-test="alert-variables-value-input"]');
      expect(keyInput.exists()).toBe(true);
      expect(valueInput.exists()).toBe(true);
    });

    it("should show delete button for each variable", async () => {
      await wrapper.setProps({
        contextAttributes: [
          { id: "1", key: "env", value: "prod" },
          { id: "2", key: "region", value: "us-west" },
        ],
      });
      await flushPromises();
      const deleteBtns = wrapper.findAll('[data-test="alert-variables-delete-variable-btn"]');
      expect(deleteBtns.length).toBe(2);
    });

    it("should show add button only for last variable", async () => {
      await wrapper.setProps({
        contextAttributes: [
          { id: "1", key: "env", value: "prod" },
          { id: "2", key: "region", value: "us-west" },
        ],
      });
      await flushPromises();
      const addBtns = wrapper.findAll('[data-test="alert-variables-add-variable-btn"]');
      expect(addBtns.length).toBe(1);
    });
  });

  describe("User Interactions - Description", () => {
    it("should update description on input", async () => {
      const description = "This is a test alert description";
      wrapper.vm.localDescription = description;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.localDescription).toBe(description);
    });

    it("should render description textarea", () => {
      const textarea = wrapper.find('textarea');
      expect(textarea.exists()).toBe(true);
    });
  });

  describe("User Interactions - Row Template", () => {
    it("should update row template on input", async () => {
      const template = "Alert triggered at {timestamp}";
      wrapper.vm.localRowTemplate = template;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.localRowTemplate).toBe(template);
    });

    it("should render row template textarea", () => {
      const textarea = wrapper.find('[data-test="add-alert-row-input-textarea"]');
      expect(textarea.exists()).toBe(true);
    });

    it("should render row template type toggle", () => {
      const toggle = wrapper.find('[data-test="add-alert-row-template-type-toggle"]');
      expect(toggle.exists()).toBe(true);
    });

    it("should have String and JSON options for row template type", () => {
      expect(wrapper.vm.rowTemplateTypeOptions).toEqual([
        { label: "String", value: "String" },
        { label: "JSON", value: "Json" },
      ]);
    });

    it("should change row template type", async () => {
      wrapper.vm.localRowTemplateType = "Json";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.localRowTemplateType).toBe("Json");
    });
  });

  describe("Computed - Row Template Placeholder", () => {
    it("should show String placeholder by default", () => {
      expect(wrapper.vm.rowTemplatePlaceholder).toContain("Alert was triggered");
    });

    it("should show JSON placeholder when type is Json", async () => {
      wrapper.vm.localRowTemplateType = "Json";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.rowTemplatePlaceholder).toContain("user");
      expect(wrapper.vm.rowTemplatePlaceholder).toContain("timestamp");
    });

    it("should update placeholder when type changes", async () => {
      expect(wrapper.vm.rowTemplatePlaceholder).toContain("Alert was triggered");
      wrapper.vm.localRowTemplateType = "Json";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.rowTemplatePlaceholder).toContain("user");
    });
  });

  describe("Emit Events", () => {
    it("should emit all updates when emitUpdate is called", () => {
      wrapper.vm.localVariables = [{ id: "1", key: "test", value: "val" }];
      wrapper.vm.localDescription = "Test desc";
      wrapper.vm.localRowTemplate = "Template";
      wrapper.vm.localRowTemplateType = "Json";
      wrapper.vm.emitUpdate();

      expect(wrapper.emitted("update:contextAttributes")).toBeTruthy();
      expect(wrapper.emitted("update:description")).toBeTruthy();
      expect(wrapper.emitted("update:rowTemplate")).toBeTruthy();
      expect(wrapper.emitted("update:rowTemplateType")).toBeTruthy();
    });

    it("should emit correct contextAttributes data", () => {
      const variables: Variable[] = [{ id: "1", key: "env", value: "prod" }];
      wrapper.vm.localVariables = variables;
      wrapper.vm.emitUpdate();

      const emitted = wrapper.emitted("update:contextAttributes");
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual([variables]);
    });

    it("should emit correct description data", () => {
      wrapper.vm.localDescription = "Test description";
      wrapper.vm.emitUpdate();

      const emitted = wrapper.emitted("update:description");
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual(["Test description"]);
    });

    it("should emit correct rowTemplate data", () => {
      wrapper.vm.localRowTemplate = "Alert: {msg}";
      wrapper.vm.emitUpdate();

      const emitted = wrapper.emitted("update:rowTemplate");
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual(["Alert: {msg}"]);
    });

    it("should emit correct rowTemplateType data", () => {
      wrapper.vm.localRowTemplateType = "Json";
      wrapper.vm.emitUpdate();

      const emitted = wrapper.emitted("update:rowTemplateType");
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual(["Json"]);
    });

    it("should emit when adding a variable", async () => {
      await wrapper.vm.addVariable();
      expect(wrapper.emitted("update:contextAttributes")).toBeTruthy();
    });

    it("should emit when removing a variable", async () => {
      await wrapper.vm.addVariable();
      const variable = wrapper.vm.localVariables[0];
      await wrapper.vm.removeVariable(variable);
      expect(wrapper.emitted("update:contextAttributes")).toBeTruthy();
    });
  });

  describe("Watcher Behavior", () => {
    it("should update localVariables when contextAttributes prop changes", async () => {
      const variables: Variable[] = [{ id: "1", key: "test", value: "val" }];
      await wrapper.setProps({ contextAttributes: variables });
      await flushPromises();
      expect(wrapper.vm.localVariables).toEqual(variables);
    });

    it("should update localDescription when description prop changes", async () => {
      await wrapper.setProps({ description: "New description" });
      await flushPromises();
      expect(wrapper.vm.localDescription).toBe("New description");
    });

    it("should update localRowTemplate when rowTemplate prop changes", async () => {
      await wrapper.setProps({ rowTemplate: "New template" });
      await flushPromises();
      expect(wrapper.vm.localRowTemplate).toBe("New template");
    });

    it("should update localRowTemplateType when rowTemplateType prop changes", async () => {
      await wrapper.setProps({ rowTemplateType: "Json" });
      await flushPromises();
      expect(wrapper.vm.localRowTemplateType).toBe("Json");
    });

    it("should handle deep changes to contextAttributes", async () => {
      const variables: Variable[] = [{ id: "1", key: "env", value: "dev" }];
      await wrapper.setProps({ contextAttributes: variables });
      await flushPromises();

      const updatedVariables: Variable[] = [{ id: "1", key: "env", value: "prod" }];
      await wrapper.setProps({ contextAttributes: updatedVariables });
      await flushPromises();

      expect(wrapper.vm.localVariables).toEqual(updatedVariables);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty variables array", () => {
      expect(wrapper.vm.localVariables).toEqual([]);
      const addBtn = wrapper.find('[data-test="alert-variables-add-btn"]');
      expect(addBtn.exists()).toBe(true);
    });

    it("should handle very long description text", async () => {
      const longText = "A".repeat(10000);
      wrapper.vm.localDescription = longText;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.localDescription).toBe(longText);
    });

    it("should handle very long row template", async () => {
      const longTemplate = "Template: " + "X".repeat(5000);
      wrapper.vm.localRowTemplate = longTemplate;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.localRowTemplate).toBe(longTemplate);
    });

    it("should handle special characters in variable keys", async () => {
      await wrapper.vm.addVariable();
      wrapper.vm.localVariables[0].key = "special-key_123.test@value";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.localVariables[0].key).toBe("special-key_123.test@value");
    });

    it("should handle special characters in variable values", async () => {
      await wrapper.vm.addVariable();
      wrapper.vm.localVariables[0].value = '{"nested": "json", "value": 123}';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.localVariables[0].value).toContain("nested");
    });

    it("should handle removing all variables", async () => {
      await wrapper.vm.addVariable();
      await wrapper.vm.addVariable();
      const var1 = wrapper.vm.localVariables[0];
      const var2 = wrapper.vm.localVariables[1];
      await wrapper.vm.removeVariable(var1);
      await wrapper.vm.removeVariable(var2);
      expect(wrapper.vm.localVariables.length).toBe(0);
    });

    it("should handle rapid variable additions", async () => {
      for (let i = 0; i < 10; i++) {
        await wrapper.vm.addVariable();
      }
      expect(wrapper.vm.localVariables.length).toBe(10);
    });

    it("should handle empty string in description", async () => {
      wrapper.vm.localDescription = "";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.localDescription).toBe("");
    });
  });

  describe("UI Rendering", () => {
    it("should render Additional Variables label", () => {
      const html = wrapper.html();
      expect(html).toContain("Additional Variables");
    });

    it("should render Description label", () => {
      const html = wrapper.html();
      expect(html).toContain("Description");
    });

    it("should render Row Template label", () => {
      const html = wrapper.html();
      expect(html).toContain("Row Template");
    });

    it("should render info tooltips", () => {
      const infoBtns = wrapper.findAll('[data-test="add-alert-row-input-info-btn"]');
      expect(infoBtns.length).toBeGreaterThan(0);
    });

    it("should render template type toggle", () => {
      const toggle = wrapper.find('[data-test="add-alert-row-template-type-toggle"]');
      expect(toggle.exists()).toBe(true);
    });
  });

  describe("Accessibility", () => {
    it("should have proper structure for form inputs", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should have tooltips for info buttons", () => {
      const html = wrapper.html();
      expect(html).toContain("info_outline");
    });
  });

  describe("Boundary Conditions", () => {
    it("should handle zero variables", () => {
      expect(wrapper.vm.localVariables.length).toBe(0);
    });

    it("should handle large number of variables", async () => {
      const variables: Variable[] = [];
      for (let i = 0; i < 50; i++) {
        variables.push({ id: `id-${i}`, key: `key-${i}`, value: `value-${i}` });
      }
      await wrapper.setProps({ contextAttributes: variables });
      await flushPromises();
      expect(wrapper.vm.localVariables.length).toBe(50);
    });

    it("should handle empty strings for all fields", () => {
      expect(wrapper.vm.localDescription).toBe("");
      expect(wrapper.vm.localRowTemplate).toBe("");
    });

    it("should handle fully populated state", async () => {
      await wrapper.setProps({
        contextAttributes: [
          { id: "1", key: "env", value: "prod" },
          { id: "2", key: "region", value: "us-west" },
        ],
        description: "Full description",
        rowTemplate: "Alert: {message}",
        rowTemplateType: "Json",
      });
      await flushPromises();

      expect(wrapper.vm.localVariables.length).toBe(2);
      expect(wrapper.vm.localDescription).toBe("Full description");
      expect(wrapper.vm.localRowTemplate).toBe("Alert: {message}");
      expect(wrapper.vm.localRowTemplateType).toBe("Json");
    });
  });

  describe("Negative Cases", () => {
    it("should not crash when removing non-existent variable", async () => {
      const fakeVariable: Variable = { id: "non-existent", key: "", value: "" };
      await wrapper.vm.removeVariable(fakeVariable);
      expect(wrapper.vm.localVariables.length).toBe(0);
    });

    it("should handle undefined values gracefully", async () => {
      wrapper.vm.localDescription = undefined as any;
      wrapper.vm.localRowTemplate = undefined as any;
      await wrapper.vm.$nextTick();
      // Component should not crash
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Theme Switching", () => {
    it("should apply light mode theme", () => {
      expect(wrapper.classes()).toContain("light-mode");
    });

    it("should apply dark mode theme", async () => {
      mockStore = createMockStore({ theme: "dark" });
      const darkWrapper = mount(Advanced, {
        global: {
          mocks: { $store: mockStore },
          provide: { store: mockStore },
          plugins: [i18n],
        },
        props: {
          contextAttributes: [],
          description: "",
          rowTemplate: "",
          rowTemplateType: "String",
        },
      });
      expect(darkWrapper.classes()).toContain("dark-mode");
    });

    it("should toggle between themes", async () => {
      // Light mode
      expect(wrapper.classes()).toContain("light-mode");

      // Dark mode
      mockStore = createMockStore({ theme: "dark" });
      const darkWrapper = mount(Advanced, {
        global: {
          mocks: { $store: mockStore },
          provide: { store: mockStore },
          plugins: [i18n],
        },
        props: {
          contextAttributes: [],
          description: "",
          rowTemplate: "",
          rowTemplateType: "String",
        },
      });
      expect(darkWrapper.classes()).toContain("dark-mode");

      // Back to light mode
      mockStore = createMockStore({ theme: "light" });
      const lightWrapper = mount(Advanced, {
        global: {
          mocks: { $store: mockStore },
          provide: { store: mockStore },
          plugins: [i18n],
        },
        props: {
          contextAttributes: [],
          description: "",
          rowTemplate: "",
          rowTemplateType: "String",
        },
      });
      expect(lightWrapper.classes()).toContain("light-mode");
    });
  });

  describe("Variable ID Generation", () => {
    it("should generate unique IDs when adding variables", async () => {
      await wrapper.vm.addVariable();
      await wrapper.vm.addVariable();
      await wrapper.vm.addVariable();

      const ids = wrapper.vm.localVariables.map((v: Variable) => v.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);
    });

    it("should preserve IDs from props", async () => {
      const variables: Variable[] = [
        { id: "custom-id-1", key: "test1", value: "val1" },
        { id: "custom-id-2", key: "test2", value: "val2" },
      ];
      await wrapper.setProps({ contextAttributes: variables });
      await flushPromises();

      expect(wrapper.vm.localVariables[0].id).toBe("custom-id-1");
      expect(wrapper.vm.localVariables[1].id).toBe("custom-id-2");
    });
  });
});
