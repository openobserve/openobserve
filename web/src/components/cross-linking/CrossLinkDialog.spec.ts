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
          // Stub ONLY the ODialog overlay so its body slot renders inline
          // (and unmounts via v-if='open' like the real reka-ui DialogContent).
          // The OForm + OFormInput fields stay REAL so the schema wiring is
          // exercised (playbook §5 / R22).
          ODialog: {
            name: "ODialog",
            template:
              "<div class='o-dialog' v-if='open'><slot name='header-right' /><slot /><slot name='footer' /></div>",
            props: [
              "open",
              "persistent",
              "size",
              "title",
              "showClose",
              "formId",
              "primaryButtonLabel",
              "secondaryButtonLabel",
            ],
            emits: [
              "update:open",
              "click:primary",
              "click:secondary",
              "click:neutral",
            ],
          },
          // OFormCombobox (chip-builder scratch input) renders REAL so the
          // newFieldName form-field binding + forwarded clear() are exercised.
        },
      },
    });
  };

  const getForm = (w: any) =>
    (w.findComponent({ name: "OForm" }).vm as any).form;

  // newFieldName is now an OForm-owned scratch field (not a vm ref).
  const setNewField = (w: any, v: string) =>
    getForm(w).setFieldValue("newFieldName", v);
  const newFieldVal = (w: any) => getForm(w).state.values.newFieldName;

  // `fields` is now a form-owned array (the old `fieldsModel` mirror was
  // removed) — read/seed it THROUGH the form, the single source of truth.
  const fieldsVal = (w: any) => getForm(w).state.values.fields ?? [];
  const setFields = (w: any, v: Array<{ name: string }>) =>
    getForm(w).setFieldValue("fields", v);

  const submit = async (w: any) => {
    await getForm(w).handleSubmit();
    await flushPromises();
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

    it("should accept link prop", () => {
      wrapper = createWrapper({ link: existingLink });
      expect(wrapper.props("link")).toEqual(existingLink);
    });

    it("should wire the dialog footer to the form via form-id", () => {
      wrapper = createWrapper();
      const dialog = wrapper.findComponent({ name: "ODialog" });
      expect(dialog.props("formId")).toBe("cross-link-form");
    });

    it("should expose availableFieldOptions empty when availableFields is empty", () => {
      wrapper = createWrapper({ availableFields: [] });
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

  describe("Edit prefill (default-values on open)", () => {
    it("seeds an empty form when opened without a link", async () => {
      wrapper = createWrapper({ modelValue: false, link: null });
      await wrapper.setProps({ modelValue: true });
      await flushPromises();

      const form = getForm(wrapper);
      expect(form.state.values.name).toBe("");
      expect(form.state.values.url).toBe("");
      expect(fieldsVal(wrapper)).toEqual([]);
    });

    it("seeds the form from an existing link on open", async () => {
      wrapper = createWrapper({ modelValue: false, link: existingLink });
      await wrapper.setProps({ modelValue: true });
      await flushPromises();

      const form = getForm(wrapper);
      expect(form.state.values.name).toBe("View Trace");
      expect(form.state.values.url).toBe(
        "https://example.com/trace/${trace_id}",
      );
      expect(fieldsVal(wrapper)).toEqual([
        { name: "trace_id" },
        { name: "span_id" },
      ]);
    });

    it("seeds an empty newFieldName on a fresh open", async () => {
      wrapper = createWrapper({ modelValue: false, link: existingLink });
      await wrapper.setProps({ modelValue: true });
      await flushPromises();
      expect(newFieldVal(wrapper)).toBe("");
    });

    it("should handle a link with no fields", async () => {
      const linkNoFields = {
        name: "No Fields Link",
        url: "https://example.com",
        fields: null as any,
      };
      wrapper = createWrapper({ modelValue: false, link: linkNoFields });
      await wrapper.setProps({ modelValue: true });
      await nextTick();
      expect(fieldsVal(wrapper)).toEqual([]);
    });
  });

  describe("addField Function", () => {
    it("should add a field when newFieldName (form field) is set", () => {
      wrapper = createWrapper();
      setNewField(wrapper, "trace_id");
      wrapper.vm.addField();
      expect(fieldsVal(wrapper)).toEqual([{ name: "trace_id" }]);
    });

    it("should not add duplicate fields", () => {
      wrapper = createWrapper();
      setFields(wrapper, [{ name: "trace_id" }]);
      setNewField(wrapper, "trace_id");
      wrapper.vm.addField();
      expect(fieldsVal(wrapper)).toEqual([{ name: "trace_id" }]);
    });

    it("should not add empty field names", () => {
      wrapper = createWrapper();
      setNewField(wrapper, "");
      wrapper.vm.addField();
      expect(fieldsVal(wrapper)).toEqual([]);
    });

    it("should trim whitespace from field names", () => {
      wrapper = createWrapper();
      setNewField(wrapper, "  trace_id  ");
      wrapper.vm.addField();
      expect(fieldsVal(wrapper)).toEqual([{ name: "trace_id" }]);
    });

    it("should clear newFieldName after adding field", async () => {
      wrapper = createWrapper();
      setNewField(wrapper, "trace_id");
      wrapper.vm.addField();
      await nextTick();
      expect(newFieldVal(wrapper)).toBe("");
    });
  });

  describe("onFieldSelect Function", () => {
    it("should add selected field to the form-owned fields", () => {
      wrapper = createWrapper();
      wrapper.vm.onFieldSelect("trace_id");
      expect(fieldsVal(wrapper)).toEqual([{ name: "trace_id" }]);
    });

    it("should clear newFieldName after selection", async () => {
      wrapper = createWrapper();
      setNewField(wrapper, "trace_id");
      wrapper.vm.onFieldSelect("trace_id");
      await nextTick();
      expect(newFieldVal(wrapper)).toBe("");
    });

    it("should not add field for empty string value", () => {
      wrapper = createWrapper();
      wrapper.vm.onFieldSelect("");
      expect(fieldsVal(wrapper)).toEqual([]);
    });
  });

  describe("availableFieldOptions Computed", () => {
    it("should return all fields as option objects when none have been added", () => {
      wrapper = createWrapper({
        availableFields: ["trace_id", "span_id", "service_name", "host"],
      });
      expect(wrapper.vm.availableFieldOptions).toEqual([
        { label: "trace_id", value: "trace_id" },
        { label: "span_id", value: "span_id" },
        { label: "service_name", value: "service_name" },
        { label: "host", value: "host" },
      ]);
    });

    it("should exclude already-added fields from suggestions", async () => {
      wrapper = createWrapper({
        availableFields: ["trace_id", "span_id", "service_name", "host"],
      });
      setFields(wrapper, [{ name: "trace_id" }]);
      await nextTick();
      const values = wrapper.vm.availableFieldOptions.map((o: any) => o.value);
      expect(values).not.toContain("trace_id");
      expect(values).toContain("span_id");
    });

    it("should return empty array when availableFields is empty", () => {
      wrapper = createWrapper({ availableFields: [] });
      expect(wrapper.vm.availableFieldOptions).toEqual([]);
    });
  });

  describe("Field Chip Removal", () => {
    it("should remove field when chip remove button is clicked", async () => {
      wrapper = createWrapper();
      setFields(wrapper, [
        { name: "trace_id" },
        { name: "span_id" },
        { name: "service_name" },
      ]);
      await nextTick();

      const removeBtn = wrapper.find(
        '[data-test="cross-link-field-chip-remove-1"]',
      );
      expect(removeBtn.exists()).toBe(true);
      await removeBtn.trigger("click");

      expect(fieldsVal(wrapper)).toEqual([
        { name: "trace_id" },
        { name: "service_name" },
      ]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Real-OForm validation wiring (playbook §5 / R22): the Zod schema — not a
  // disabled button — gates an empty submit, and the restored required rules
  // (name + url) block save.
  describe("OForm schema validation (real form)", () => {
    it("emits save with the validated payload on submit", async () => {
      wrapper = createWrapper();
      const form = getForm(wrapper);
      form.setFieldValue("name", "My Link");
      form.setFieldValue("url", "https://example.com/${trace_id}");
      setFields(wrapper, [{ name: "trace_id" }]);
      await nextTick();

      await submit(wrapper);

      expect(form.state.isValid).toBe(true);
      expect(wrapper.emitted("save")).toBeTruthy();
      expect(wrapper.emitted("save")[0][0]).toEqual({
        name: "My Link",
        url: "https://example.com/${trace_id}",
        fields: [{ name: "trace_id" }],
      });
    });

    it("blocks submit + does NOT emit save when name is empty", async () => {
      wrapper = createWrapper();
      const form = getForm(wrapper);
      form.setFieldValue("name", "");
      form.setFieldValue("url", "https://example.com");
      await nextTick();

      await submit(wrapper);

      expect(form.state.isValid).toBe(false);
      expect(wrapper.emitted("save")).toBeFalsy();
    });

    it("blocks submit + does NOT emit save when url is empty", async () => {
      wrapper = createWrapper();
      const form = getForm(wrapper);
      form.setFieldValue("name", "My Link");
      form.setFieldValue("url", "");
      await nextTick();

      await submit(wrapper);

      expect(form.state.isValid).toBe(false);
      expect(wrapper.emitted("save")).toBeFalsy();
    });

    it("auto-adds a pending typed field on submit", async () => {
      wrapper = createWrapper();
      const form = getForm(wrapper);
      form.setFieldValue("name", "My Link");
      form.setFieldValue("url", "https://example.com");
      setNewField(wrapper, "pending_field");
      await nextTick();

      await submit(wrapper);

      const saved = wrapper.emitted("save")[0][0];
      expect(saved.fields).toEqual([{ name: "pending_field" }]);
    });
  });

  describe("onCancel Function", () => {
    it("should emit cancel and update:modelValue false", () => {
      wrapper = createWrapper();
      wrapper.vm.onCancel();
      expect(wrapper.emitted("cancel")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")[0][0]).toBe(false);
    });

    it("emits cancel when ODialog emits click:secondary", async () => {
      wrapper = createWrapper();
      const dialog = wrapper.findComponent({ name: "ODialog" });
      await dialog.vm.$emit("click:secondary");
      expect(wrapper.emitted("cancel")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")[0][0]).toBe(false);
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
      expect(wrapper.emitted("update:modelValue")[0][0]).toBe(false);
    });
  });

  describe("ODialog Integration", () => {
    it("renders the editing title when link has a name", () => {
      wrapper = createWrapper({ link: existingLink });
      const dialog = wrapper.findComponent({ name: "ODialog" });
      expect(dialog.props("title")).toBe("Edit Cross-Link");
    });

    it("renders the add title when link is null", () => {
      wrapper = createWrapper({ link: null });
      const dialog = wrapper.findComponent({ name: "ODialog" });
      expect(dialog.props("title")).toBe("Add Cross-Link");
    });

    it("syncs open prop with modelValue", () => {
      wrapper = createWrapper({ modelValue: true });
      const dialog = wrapper.findComponent({ name: "ODialog" });
      expect(dialog.props("open")).toBe(true);
    });
  });

  describe("Add Field Button", () => {
    it("should add field when add button is clicked with a typed value", async () => {
      wrapper = createWrapper();
      setNewField(wrapper, "my_field");
      await nextTick();
      await wrapper
        .find('[data-test="cross-link-add-field-btn"]')
        .trigger("click");
      expect(fieldsVal(wrapper)).toEqual([{ name: "my_field" }]);
    });
  });

  describe("Field Input (real OFormCombobox)", () => {
    it("renders the combobox input with the preserved data-test", () => {
      wrapper = createWrapper();
      // OFormCombobox → OCombobox forwards data-test onto the root; the inner
      // <input> is `<data-test>-input` (e2e selectors unchanged).
      expect(
        wrapper.find('[data-test="cross-link-field-input"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="cross-link-field-input-input"]').exists(),
      ).toBe(true);
    });

    it("updates the newFieldName form field when typing in the combobox", async () => {
      wrapper = createWrapper();
      const input = wrapper.find('[data-test="cross-link-field-input-input"]');
      expect(input.exists()).toBe(true);
      await input.setValue("trace_id");
      await flushPromises();
      expect(newFieldVal(wrapper)).toBe("trace_id");
    });
  });
});
