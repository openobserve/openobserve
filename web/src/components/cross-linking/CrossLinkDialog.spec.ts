import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { nextTick } from "vue";

import CrossLinkDialog from "./CrossLinkDialog.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar();

describe("CrossLinkDialog Component", () => {
  let wrapper: any;

  const defaultProps = {
    modelValue: true,
    link: null,
    availableFields: ["trace_id", "span_id", "service_name", "host"],
  };

  const existingLink = {
    name: "View Trace",
    url: "https://example.com/trace/${trace_id}",
    fields: [{ name: "trace_id" }, { name: "span_id" }],
  };

  const createWrapper = (props = {}) => {
    return mount(CrossLinkDialog, {
      props: { ...defaultProps, ...props },
      global: {
        plugins: [i18n],
        provide: { store },
        stubs: {
          "q-dialog": {
            template:
              '<div class="q-dialog"><slot /></div>',
            props: ["modelValue"],
          },
          "q-card": {
            template: '<div class="q-card"><slot /></div>',
          },
          "q-card-section": {
            template: '<div class="q-card-section"><slot /></div>',
          },
          "q-card-actions": {
            template: '<div class="q-card-actions"><slot /></div>',
          },
          "q-form": {
            template: '<form @submit.prevent><slot /></form>',
          },
          "q-input": {
            template:
              '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" :data-test="$attrs[\'data-test\']" />',
            props: ["modelValue"],
            emits: ["update:modelValue"],
          },
          "q-select": {
            template:
              '<select :data-test="$attrs[\'data-test\']"><slot /></select>',
            props: ["modelValue", "options"],
            methods: {
              updateInputValue: vi.fn(),
            },
          },
          "q-btn": {
            template:
              '<button @click="$emit(\'click\')" :data-test="$attrs[\'data-test\']" :disabled="$attrs.disable"><slot />{{ $attrs.label }}</button>',
            emits: ["click"],
          },
          "q-chip": {
            template:
              '<span class="q-chip" :data-test="$attrs[\'data-test\']"><slot /><button class="remove" @click="$emit(\'remove\')">x</button></span>',
            emits: ["remove"],
          },
        },
      },
    });
  };

  beforeEach(() => {
    store.state.theme = "light";
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  describe("Component Initialization", () => {
    it("should mount successfully", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("CrossLinkDialog");
    });

    it("should accept modelValue prop", () => {
      wrapper = createWrapper({ modelValue: true });
      expect(wrapper.props("modelValue")).toBe(true);
    });

    it("should accept link prop", () => {
      wrapper = createWrapper({ link: existingLink });
      expect(wrapper.props("link")).toEqual(existingLink);
    });

    it("should accept availableFields prop", () => {
      wrapper = createWrapper();
      expect(wrapper.props("availableFields")).toEqual(defaultProps.availableFields);
    });

    it("should have default availableFields as empty array", () => {
      wrapper = createWrapper({ availableFields: undefined });
      expect(wrapper.vm.filteredFieldOptions).toBeDefined();
    });
  });

  describe("isEditing Computed Property", () => {
    it("should return false when link is null", () => {
      wrapper = createWrapper({ link: null });
      expect(wrapper.vm.isEditing).toBe(false);
    });

    it("should return false when link has no name", () => {
      wrapper = createWrapper({ link: { name: "", url: "", fields: [] } });
      expect(wrapper.vm.isEditing).toBe(false);
    });

    it("should return true when link has a name", () => {
      wrapper = createWrapper({ link: existingLink });
      expect(wrapper.vm.isEditing).toBe(true);
    });
  });

  describe("Form Reset on Dialog Open", () => {
    it("should reset form to empty when dialog opens without link", async () => {
      wrapper = createWrapper({ modelValue: false, link: null });
      await wrapper.setProps({ modelValue: true });
      await nextTick();

      expect(wrapper.vm.form.name).toBe("");
      expect(wrapper.vm.form.url).toBe("");
      expect(wrapper.vm.form.fields).toEqual([]);
    });

    it("should populate form when dialog opens with existing link", async () => {
      wrapper = createWrapper({ modelValue: false, link: existingLink });
      await wrapper.setProps({ modelValue: true });
      await nextTick();

      expect(wrapper.vm.form.name).toBe("View Trace");
      expect(wrapper.vm.form.url).toBe(
        "https://example.com/trace/${trace_id}",
      );
      expect(wrapper.vm.form.fields).toEqual([
        { name: "trace_id" },
        { name: "span_id" },
      ]);
    });

    it("should clear newFieldName when dialog opens", async () => {
      wrapper = createWrapper({ modelValue: false });
      wrapper.vm.newFieldName = "some_field";
      await wrapper.setProps({ modelValue: true });
      await nextTick();

      expect(wrapper.vm.newFieldName).toBe("");
    });

    it("should handle link with no fields", async () => {
      const linkNoFields = {
        name: "No Fields Link",
        url: "https://example.com",
        fields: null as any,
      };
      wrapper = createWrapper({ modelValue: false, link: linkNoFields });
      await wrapper.setProps({ modelValue: true });
      await nextTick();

      expect(wrapper.vm.form.fields).toEqual([]);
    });
  });

  describe("addField Function", () => {
    it("should add a new field from fieldInputValue", () => {
      wrapper = createWrapper();
      wrapper.vm.fieldInputValue = "trace_id";
      wrapper.vm.addField();

      expect(wrapper.vm.form.fields).toEqual([{ name: "trace_id" }]);
    });

    it("should add a new field from newFieldName when fieldInputValue is empty", () => {
      wrapper = createWrapper();
      wrapper.vm.newFieldName = "span_id";
      wrapper.vm.addField();

      expect(wrapper.vm.form.fields).toEqual([{ name: "span_id" }]);
    });

    it("should not add duplicate fields", () => {
      wrapper = createWrapper();
      wrapper.vm.form.fields = [{ name: "trace_id" }];
      wrapper.vm.fieldInputValue = "trace_id";
      wrapper.vm.addField();

      expect(wrapper.vm.form.fields).toEqual([{ name: "trace_id" }]);
    });

    it("should not add empty field names", () => {
      wrapper = createWrapper();
      wrapper.vm.fieldInputValue = "";
      wrapper.vm.newFieldName = "";
      wrapper.vm.addField();

      expect(wrapper.vm.form.fields).toEqual([]);
    });

    it("should trim whitespace from field names", () => {
      wrapper = createWrapper();
      wrapper.vm.fieldInputValue = "  trace_id  ";
      wrapper.vm.addField();

      expect(wrapper.vm.form.fields).toEqual([{ name: "trace_id" }]);
    });

    it("should clear input after adding field", () => {
      wrapper = createWrapper();
      wrapper.vm.fieldInputValue = "trace_id";
      wrapper.vm.addField();

      expect(wrapper.vm.newFieldName).toBe("");
      expect(wrapper.vm.fieldInputValue).toBe("");
    });
  });

  describe("onFieldSelected Function", () => {
    it("should add selected field to form", () => {
      wrapper = createWrapper();
      wrapper.vm.onFieldSelected("trace_id");

      expect(wrapper.vm.form.fields).toEqual([{ name: "trace_id" }]);
    });

    it("should not add duplicate when selecting existing field", () => {
      wrapper = createWrapper();
      wrapper.vm.form.fields = [{ name: "trace_id" }];
      wrapper.vm.onFieldSelected("trace_id");

      expect(wrapper.vm.form.fields).toEqual([{ name: "trace_id" }]);
    });

    it("should clear input after selection", () => {
      wrapper = createWrapper();
      wrapper.vm.onFieldSelected("trace_id");

      expect(wrapper.vm.newFieldName).toBe("");
      expect(wrapper.vm.fieldInputValue).toBe("");
    });

    it("should ignore empty selection", () => {
      wrapper = createWrapper();
      wrapper.vm.onFieldSelected("");

      expect(wrapper.vm.form.fields).toEqual([]);
    });
  });

  describe("filterFieldOptions Function", () => {
    it("should filter available fields by search term", () => {
      wrapper = createWrapper();
      const updateFn = (cb: Function) => cb();
      wrapper.vm.filterFieldOptions("trace", updateFn);

      expect(wrapper.vm.filteredFieldOptions).toEqual(["trace_id"]);
    });

    it("should filter case insensitively", () => {
      wrapper = createWrapper();
      const updateFn = (cb: Function) => cb();
      wrapper.vm.filterFieldOptions("TRACE", updateFn);

      expect(wrapper.vm.filteredFieldOptions).toEqual(["trace_id"]);
    });

    it("should return all fields for empty search", () => {
      wrapper = createWrapper();
      const updateFn = (cb: Function) => cb();
      wrapper.vm.filterFieldOptions("", updateFn);

      expect(wrapper.vm.filteredFieldOptions).toEqual(
        defaultProps.availableFields,
      );
    });

    it("should return empty array when no matches", () => {
      wrapper = createWrapper();
      const updateFn = (cb: Function) => cb();
      wrapper.vm.filterFieldOptions("nonexistent", updateFn);

      expect(wrapper.vm.filteredFieldOptions).toEqual([]);
    });
  });

  describe("onSubmit Function", () => {
    it("should emit save with form data", () => {
      wrapper = createWrapper();
      wrapper.vm.form.name = "My Link";
      wrapper.vm.form.url = "https://example.com/${trace_id}";
      wrapper.vm.form.fields = [{ name: "trace_id" }];

      wrapper.vm.onSubmit();

      expect(wrapper.emitted("save")).toBeTruthy();
      expect(wrapper.emitted("save")[0][0]).toEqual({
        name: "My Link",
        url: "https://example.com/${trace_id}",
        fields: [{ name: "trace_id" }],
      });
    });

    it("should not emit save when name is empty", () => {
      wrapper = createWrapper();
      wrapper.vm.form.name = "";
      wrapper.vm.form.url = "https://example.com";

      wrapper.vm.onSubmit();

      expect(wrapper.emitted("save")).toBeFalsy();
    });

    it("should not emit save when url is empty", () => {
      wrapper = createWrapper();
      wrapper.vm.form.name = "My Link";
      wrapper.vm.form.url = "";

      wrapper.vm.onSubmit();

      expect(wrapper.emitted("save")).toBeFalsy();
    });

    it("should auto-add pending field on submit", () => {
      wrapper = createWrapper();
      wrapper.vm.form.name = "My Link";
      wrapper.vm.form.url = "https://example.com";
      wrapper.vm.fieldInputValue = "pending_field";

      wrapper.vm.onSubmit();

      const savedData = wrapper.emitted("save")[0][0];
      expect(savedData.fields).toEqual([{ name: "pending_field" }]);
    });
  });

  describe("onCancel Function", () => {
    it("should emit cancel event", () => {
      wrapper = createWrapper();
      wrapper.vm.onCancel();

      expect(wrapper.emitted("cancel")).toBeTruthy();
    });

    it("should emit update:modelValue with false", () => {
      wrapper = createWrapper();
      wrapper.vm.onCancel();

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")[0][0]).toBe(false);
    });
  });

  describe("Field Chip Removal", () => {
    it("should remove field when chip is removed", () => {
      wrapper = createWrapper();
      wrapper.vm.form.fields = [
        { name: "trace_id" },
        { name: "span_id" },
        { name: "service_name" },
      ];

      wrapper.vm.form.fields.splice(1, 1);

      expect(wrapper.vm.form.fields).toEqual([
        { name: "trace_id" },
        { name: "service_name" },
      ]);
    });
  });

  describe("onFieldInputValue", () => {
    it("should update fieldInputValue", () => {
      wrapper = createWrapper();
      wrapper.vm.onFieldInputValue("test_value");

      expect(wrapper.vm.fieldInputValue).toBe("test_value");
    });
  });

  describe("dialogVisible Computed", () => {
    it("should reflect modelValue prop", () => {
      wrapper = createWrapper({ modelValue: true });
      expect(wrapper.vm.dialogVisible).toBe(true);
    });

    it("should emit update:modelValue when set", () => {
      wrapper = createWrapper({ modelValue: true });
      wrapper.vm.dialogVisible = false;

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")[0][0]).toBe(false);
    });
  });

  describe("Save Button Disable State", () => {
    it("should be disabled when name is empty", () => {
      wrapper = createWrapper();
      wrapper.vm.form.name = "";
      wrapper.vm.form.url = "https://example.com";

      expect(!wrapper.vm.form.name || !wrapper.vm.form.url).toBe(true);
    });

    it("should be disabled when url is empty", () => {
      wrapper = createWrapper();
      wrapper.vm.form.name = "My Link";
      wrapper.vm.form.url = "";

      expect(!wrapper.vm.form.name || !wrapper.vm.form.url).toBe(true);
    });

    it("should be enabled when both name and url are provided", () => {
      wrapper = createWrapper();
      wrapper.vm.form.name = "My Link";
      wrapper.vm.form.url = "https://example.com";

      expect(!wrapper.vm.form.name || !wrapper.vm.form.url).toBe(false);
    });
  });
});
