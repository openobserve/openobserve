import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";

import CrossLinkDialog from "./CrossLinkDialog.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

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
          ODialog: {
            name: "ODialog",
            template:
              "<div class='o-dialog' v-if='open'><slot name='header-right' /><slot /><slot name='footer' /></div>",
            props: [
              "open",
              "persistent",
              "size",
              "title",
              "subTitle",
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
            emits: [
              "update:open",
              "click:primary",
              "click:secondary",
              "click:neutral",
            ],
          },
          // OCombobox: stubbed so we can test at the field-input data-test level
          OCombobox: {
            name: "OCombobox",
            template:
              '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" :data-test="$attrs[\'data-test\']" />',
            props: ["modelValue", "items", "placeholder"],
            emits: ["update:modelValue", "select"],
            methods: {
              clear: vi.fn(),
            },
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

    it("should expose availableFieldOptions computed when availableFields is empty", () => {
      // availableFieldOptions is the computed property that replaces the old filteredFieldOptions
      wrapper = createWrapper({ availableFields: [] });

      expect(wrapper.vm.availableFieldOptions).toBeDefined();
      expect(wrapper.vm.availableFieldOptions).toEqual([]);
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
      expect(wrapper.vm.form.url).toBe("https://example.com/trace/${trace_id}");
      expect(wrapper.vm.form.fields).toEqual([
        { name: "trace_id" },
        { name: "span_id" },
      ]);
    });

    it("should clear newFieldName when dialog opens", async () => {
      wrapper = createWrapper({ modelValue: false });
      // Set via the public vm ref since there is no UI interaction that seeds
      // newFieldName without also committing the field
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
    it("should add a field when newFieldName is set", () => {
      // The component no longer uses a separate fieldInputValue — newFieldName
      // is the single source of truth read by addField().
      wrapper = createWrapper();
      wrapper.vm.newFieldName = "trace_id";

      wrapper.vm.addField();

      expect(wrapper.vm.form.fields).toEqual([{ name: "trace_id" }]);
    });

    it("should not add duplicate fields", () => {
      wrapper = createWrapper();
      wrapper.vm.form.fields = [{ name: "trace_id" }];
      wrapper.vm.newFieldName = "trace_id";

      wrapper.vm.addField();

      expect(wrapper.vm.form.fields).toEqual([{ name: "trace_id" }]);
    });

    it("should not add empty field names", () => {
      wrapper = createWrapper();
      wrapper.vm.newFieldName = "";

      wrapper.vm.addField();

      expect(wrapper.vm.form.fields).toEqual([]);
    });

    it("should trim whitespace from field names", () => {
      wrapper = createWrapper();
      wrapper.vm.newFieldName = "  trace_id  ";

      wrapper.vm.addField();

      expect(wrapper.vm.form.fields).toEqual([{ name: "trace_id" }]);
    });

    it("should clear newFieldName after adding field", () => {
      wrapper = createWrapper();
      wrapper.vm.newFieldName = "trace_id";

      wrapper.vm.addField();

      // After addField, newFieldName is cleared (fieldInputValue no longer
      // exists in this component — there is only newFieldName)
      expect(wrapper.vm.newFieldName).toBe("");
    });
  });

  describe("onFieldSelect Function", () => {
    // The method was renamed from onFieldSelected → onFieldSelect in the
    // refactored component. It sets newFieldName and immediately calls addField.
    it("should add selected field to form", () => {
      wrapper = createWrapper();

      wrapper.vm.onFieldSelect("trace_id");

      expect(wrapper.vm.form.fields).toEqual([{ name: "trace_id" }]);
    });

    it("should not add duplicate when selecting existing field", () => {
      wrapper = createWrapper();
      wrapper.vm.form.fields = [{ name: "trace_id" }];

      wrapper.vm.onFieldSelect("trace_id");

      expect(wrapper.vm.form.fields).toEqual([{ name: "trace_id" }]);
    });

    it("should clear newFieldName after selection", () => {
      wrapper = createWrapper();

      wrapper.vm.onFieldSelect("trace_id");

      expect(wrapper.vm.newFieldName).toBe("");
    });

    it("should not add field for empty string value", () => {
      wrapper = createWrapper();

      wrapper.vm.onFieldSelect("");

      expect(wrapper.vm.form.fields).toEqual([]);
    });
  });

  describe("availableFieldOptions Computed", () => {
    // filterFieldOptions was removed; filtering is now done inside the
    // availableFieldOptions computed. Tests drive it via props.
    it("should return all fields as option objects when none have been added", () => {
      wrapper = createWrapper({ availableFields: ["trace_id", "span_id", "service_name", "host"] });

      expect(wrapper.vm.availableFieldOptions).toEqual([
        { label: "trace_id", value: "trace_id" },
        { label: "span_id", value: "span_id" },
        { label: "service_name", value: "service_name" },
        { label: "host", value: "host" },
      ]);
    });

    it("should exclude already-added fields from suggestions", () => {
      wrapper = createWrapper({ availableFields: ["trace_id", "span_id", "service_name", "host"] });
      wrapper.vm.form.fields = [{ name: "trace_id" }];

      // Need nextTick for the computed to re-evaluate
      return nextTick().then(() => {
        const values = wrapper.vm.availableFieldOptions.map((o: any) => o.value);
        expect(values).not.toContain("trace_id");
        expect(values).toContain("span_id");
        expect(values).toContain("service_name");
        expect(values).toContain("host");
      });
    });

    it("should return empty array when all fields have been added", () => {
      wrapper = createWrapper({ availableFields: ["trace_id"] });
      wrapper.vm.form.fields = [{ name: "trace_id" }];

      return nextTick().then(() => {
        expect(wrapper.vm.availableFieldOptions).toEqual([]);
      });
    });

    it("should return empty array when availableFields is empty", () => {
      wrapper = createWrapper({ availableFields: [] });

      expect(wrapper.vm.availableFieldOptions).toEqual([]);
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

    it("should auto-add pending field typed in newFieldName on submit", () => {
      // The component calls addField() before emit("save"), and addField reads
      // newFieldName (not the old fieldInputValue which no longer exists).
      wrapper = createWrapper();
      wrapper.vm.form.name = "My Link";
      wrapper.vm.form.url = "https://example.com";
      wrapper.vm.newFieldName = "pending_field";

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
    it("should remove field when chip remove button is clicked", async () => {
      wrapper = createWrapper();
      wrapper.vm.form.fields = [
        { name: "trace_id" },
        { name: "span_id" },
        { name: "service_name" },
      ];
      await nextTick();

      // The chip remove button uses splice(idx, 1) on click; drive it through
      // the data-test attribute on the remove button
      const removeBtn = wrapper.find('[data-test="cross-link-field-chip-remove-1"]');
      expect(removeBtn.exists()).toBe(true);
      await removeBtn.trigger("click");

      expect(wrapper.vm.form.fields).toEqual([
        { name: "trace_id" },
        { name: "service_name" },
      ]);
    });

    it("should remove correct field by index via splice", () => {
      // Drive via the vm.form directly (no UI interaction needed, behavior
      // is the same as clicking the chip remove button internally)
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

  describe("ODialog Integration", () => {
    it("should render ODialog with editing title when link has name", () => {
      wrapper = createWrapper({ link: existingLink });

      const dialog = wrapper.findComponent({ name: "ODialog" });

      expect(dialog.exists()).toBe(true);
      expect(dialog.props("title")).toBe("Edit Cross-Link");
    });

    it("should render ODialog with add title when link is null", () => {
      wrapper = createWrapper({ link: null });

      const dialog = wrapper.findComponent({ name: "ODialog" });

      expect(dialog.props("title")).toBe("Add Cross-Link");
    });

    it("should pass primaryButtonDisabled true when form is invalid", () => {
      wrapper = createWrapper();

      const dialog = wrapper.findComponent({ name: "ODialog" });

      expect(dialog.props("primaryButtonDisabled")).toBe(true);
    });

    it("should pass primaryButtonDisabled false when form is valid", async () => {
      wrapper = createWrapper();
      wrapper.vm.form.name = "My Link";
      wrapper.vm.form.url = "https://example.com";
      await nextTick();

      const dialog = wrapper.findComponent({ name: "ODialog" });

      expect(dialog.props("primaryButtonDisabled")).toBe(false);
    });

    it("should emit save when ODialog emits click:primary with valid form", async () => {
      wrapper = createWrapper();
      wrapper.vm.form.name = "My Link";
      wrapper.vm.form.url = "https://example.com";
      await nextTick();

      const dialog = wrapper.findComponent({ name: "ODialog" });
      await dialog.vm.$emit("click:primary");

      expect(wrapper.emitted("save")).toBeTruthy();
      expect(wrapper.emitted("save")[0][0]).toEqual({
        name: "My Link",
        url: "https://example.com",
        fields: [],
      });
    });

    it("should emit cancel when ODialog emits click:secondary", async () => {
      wrapper = createWrapper();

      const dialog = wrapper.findComponent({ name: "ODialog" });
      await dialog.vm.$emit("click:secondary");

      expect(wrapper.emitted("cancel")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")[0][0]).toBe(false);
    });

    it("should sync open prop with modelValue", () => {
      wrapper = createWrapper({ modelValue: true });

      const dialog = wrapper.findComponent({ name: "ODialog" });

      expect(dialog.props("open")).toBe(true);
    });
  });

  describe("Save Button Disable State", () => {
    it("should be disabled when name is empty", async () => {
      wrapper = createWrapper();
      wrapper.vm.form.name = "";
      wrapper.vm.form.url = "https://example.com";
      await nextTick();

      const dialog = wrapper.findComponent({ name: "ODialog" });

      expect(dialog.props("primaryButtonDisabled")).toBe(true);
    });

    it("should be disabled when url is empty", async () => {
      wrapper = createWrapper();
      wrapper.vm.form.name = "My Link";
      wrapper.vm.form.url = "";
      await nextTick();

      const dialog = wrapper.findComponent({ name: "ODialog" });

      expect(dialog.props("primaryButtonDisabled")).toBe(true);
    });

    it("should be enabled when both name and url are provided", async () => {
      wrapper = createWrapper();
      wrapper.vm.form.name = "My Link";
      wrapper.vm.form.url = "https://example.com";
      await nextTick();

      const dialog = wrapper.findComponent({ name: "ODialog" });

      expect(dialog.props("primaryButtonDisabled")).toBe(false);
    });
  });

  describe("Add Field Button", () => {
    it("should be disabled when newFieldName is empty", async () => {
      wrapper = createWrapper();
      wrapper.vm.newFieldName = "";
      await nextTick();

      const addBtn = wrapper.find('[data-test="cross-link-add-field-btn"]');

      expect(addBtn.exists()).toBe(true);
      expect(addBtn.attributes("disabled")).toBeDefined();
    });

    it("should add field when add button is clicked with a typed value", async () => {
      wrapper = createWrapper();
      wrapper.vm.newFieldName = "my_field";
      await nextTick();

      await wrapper.find('[data-test="cross-link-add-field-btn"]').trigger("click");

      expect(wrapper.vm.form.fields).toEqual([{ name: "my_field" }]);
    });
  });

  describe("Field Input", () => {
    it("should update newFieldName when typing in the field input", async () => {
      wrapper = createWrapper();

      const input = wrapper.find('[data-test="cross-link-field-input"]');
      expect(input.exists()).toBe(true);
      await input.setValue("trace_id");

      expect(wrapper.vm.newFieldName).toBe("trace_id");
    });
  });
});
