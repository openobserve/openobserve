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
//
// StreamFieldInputs is FORM-ONLY now: it injects the parent's TanStack form and
// renders indexed OForm* rows. So every test mounts it inside a REAL <OForm>
// (via a small harness) whose schema carries a `fields` array. This also lets us
// prove the schema gates empty rows AND the :key-must-be-index delete behavior.

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import { defineComponent } from "vue";
import { z } from "zod";
import StreamFieldInputs from "./StreamFieldInputs.vue";
import { makeStreamFieldRowSchema } from "./StreamFieldInputs.schema";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import { qLayoutInjections } from "@/test/unit/helpers/layout-injections";
import { createStore } from "vuex";
import i18n from "@/locales";

const harnessSchema = z.object({
  fields: z.array(makeStreamFieldRowSchema(i18n.global.t)).default([]),
});

const store = createStore({ state: { theme: "dark" } });

const mockFields = [
  { uuid: "1", name: "field1", type: "Utf8", index_type: ["fullTextSearchKey"] },
  { uuid: "2", name: "field2", type: "Int64", index_type: ["secondaryIndexKey"] },
];

// Renders the child inside a real <OForm> (form-only contract) and seeds the
// `fields` array from `initialFields`. Extra props (showHeader/visibleInputs)
// are forwarded to the child.
const makeHarness = (
  initialFields: any[] = [],
  childProps: Record<string, any> = {},
) => {
  const Harness = defineComponent({
    components: { OForm, StreamFieldInputs },
    setup() {
      const form = useOForm<{ fields: any[] }>({
        defaultValues: { fields: initialFields },
        schema: harnessSchema,
      });
      return { form, childProps };
    },
    template: `
      <OForm :form="form">
        <StreamFieldInputs form-field-name="fields" v-bind="childProps" />
      </OForm>
    `,
  });
  return mount(Harness, {
    global: { plugins: [i18n, store], provide: qLayoutInjections() },
  });
};

const getForm = (w: any) => (w.findComponent(OForm).vm as any).form;
const childVm = (w: any) => w.findComponent(StreamFieldInputs).vm as any;

// The RENDERED row-name inputs (model-value on each OInput), in render order.
const renderedRowNames = (w: any) =>
  w
    .findAllComponents(OFormInput)
    .filter((c: any) => /^fields\[\d+\]\.name$/.test(c.props("name")))
    .map((c: any) => c.findComponent(OInput).props("modelValue"));

describe("StreamFieldInputs (form-mode)", () => {
  describe("Component Initialization", () => {
    it("renders the fields section", async () => {
      const wrapper = makeHarness([]);
      await flushPromises();
      expect(
        wrapper.find('[data-test="add-stream-fields-section"]').exists(),
      ).toBe(true);
    });

    it("shows the header when showHeader is true (default)", async () => {
      const wrapper = makeHarness([]);
      await flushPromises();
      expect(
        wrapper.find('[data-test="alert-conditions-text"]').exists(),
      ).toBe(true);
    });

    it("hides the header when showHeader is false", async () => {
      const wrapper = makeHarness([], { showHeader: false });
      await flushPromises();
      expect(
        wrapper.find('[data-test="alert-conditions-text"]').exists(),
      ).toBe(false);
    });

    it("shows the add-field button when the array is empty", async () => {
      const wrapper = makeHarness([]);
      await flushPromises();
      const addBtn = wrapper.find('[data-test="add-stream-add-field-btn"]');
      expect(addBtn.exists()).toBe(true);
      expect(addBtn.element.tagName).toBe("BUTTON");
    });
  });

  describe("Fields Rendering", () => {
    it("renders a row per field", async () => {
      const wrapper = makeHarness(mockFields);
      await flushPromises();
      expect(
        wrapper.findAll('[data-test^="add-stream-field-row-"]'),
      ).toHaveLength(2);
    });

    it("renders a name input, index-type and data-type select per row", async () => {
      const wrapper = makeHarness(mockFields);
      await flushPromises();
      expect(
        wrapper.findAll('[data-test="add-stream-field-name-input"]'),
      ).toHaveLength(2);
      expect(
        wrapper.findAll('[data-test="add-stream-field-index-type-select"]'),
      ).toHaveLength(2);
      expect(
        wrapper.findAll('[data-test="add-stream-field-data-type-select"]'),
      ).toHaveLength(2);
    });

    it("binds each row's name to the rendered input", async () => {
      const wrapper = makeHarness(mockFields);
      await flushPromises();
      expect(renderedRowNames(wrapper)).toEqual(["field1", "field2"]);
    });

    it("shows the add button only on the last row + a delete button per row", async () => {
      const wrapper = makeHarness(mockFields);
      await flushPromises();
      expect(
        wrapper.findAll('[data-test="add-stream-add-field-btn"]'),
      ).toHaveLength(1);
      expect(
        wrapper.findAll('[data-test="add-stream-delete-field-btn"]'),
      ).toHaveLength(2);
    });
  });

  describe("Visible Inputs Configuration", () => {
    it("hides the index_type select when visibleInputs.index_type is false", async () => {
      const wrapper = makeHarness(mockFields, {
        visibleInputs: { name: true, data_type: true, index_type: false },
      });
      await flushPromises();
      expect(
        wrapper.find('[data-test="add-stream-field-index-type-select"]').exists(),
      ).toBe(false);
    });

    it("hides the data_type select when visibleInputs.data_type is false", async () => {
      const wrapper = makeHarness(mockFields, {
        visibleInputs: { name: true, data_type: false, index_type: true },
      });
      await flushPromises();
      expect(
        wrapper.find('[data-test="add-stream-field-data-type-select"]').exists(),
      ).toBe(false);
    });
  });

  describe("Row add / remove (form-owned)", () => {
    it("adds a blank row to the form when the add button is clicked", async () => {
      const wrapper = makeHarness(mockFields);
      await flushPromises();
      await wrapper
        .find('[data-test="add-stream-add-field-btn"]')
        .trigger("click");
      await flushPromises();
      expect(getForm(wrapper).state.values.fields).toHaveLength(3);
    });

    it("adds the first row from the empty state", async () => {
      const wrapper = makeHarness([]);
      await flushPromises();
      await wrapper
        .find('[data-test="add-stream-add-field-btn"]')
        .trigger("click");
      await flushPromises();
      expect(getForm(wrapper).state.values.fields).toHaveLength(1);
    });

    it("removes a row from the form when the delete button is clicked", async () => {
      const wrapper = makeHarness(mockFields);
      await flushPromises();
      await wrapper
        .findAll('[data-test="add-stream-delete-field-btn"]')[0]
        .trigger("click");
      await flushPromises();
      const rows = getForm(wrapper).state.values.fields;
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("field2");
    });

    // 🔑 The :key-must-be-index gate — delete a NON-last row and assert the
    // RENDERED inputs stay aligned (a stable-id :key would shift/blank them).
    it("keeps rendered inputs aligned after deleting a NON-last row", async () => {
      // Only the name inputs are read here, so hide the (heavy) selects to keep
      // the render light — the :key behavior is identical regardless.
      const wrapper = makeHarness(
        [
          { uuid: "a", name: "row_one", type: "Utf8", index_type: [] },
          { uuid: "b", name: "row_two", type: "Utf8", index_type: [] },
          { uuid: "c", name: "row_three", type: "Utf8", index_type: [] },
        ],
        { visibleInputs: { name: true, data_type: false, index_type: false } },
      );
      await flushPromises();
      expect(renderedRowNames(wrapper)).toEqual([
        "row_one",
        "row_two",
        "row_three",
      ]);

      childVm(wrapper).removeRow(1);
      await flushPromises();

      expect(renderedRowNames(wrapper)).toEqual(["row_one", "row_three"]);
      expect(
        getForm(wrapper).state.values.fields.map((r: any) => r.name),
      ).toEqual(["row_one", "row_three"]);
    }, 20000);
  });

  describe("Button States", () => {
    it("disables the add button when the last row name is empty", async () => {
      const wrapper = makeHarness([
        { uuid: "1", name: "", type: "", index_type: [] },
      ]);
      await flushPromises();
      const addBtn = wrapper.find('[data-test="add-stream-add-field-btn"]');
      expect(addBtn.element.hasAttribute("disabled")).toBe(true);
    });

    it("enables the add button when the last row name is filled", async () => {
      const wrapper = makeHarness([
        { uuid: "1", name: "test", type: "", index_type: [] },
      ]);
      await flushPromises();
      const addBtn = wrapper.find('[data-test="add-stream-add-field-btn"]');
      expect(addBtn.element.hasAttribute("disabled")).toBe(false);
    });
  });

  describe("Schema validation (through the real OForm)", () => {
    it("blocks submit and shows per-row errors for an empty row", async () => {
      const wrapper = makeHarness([
        { uuid: "1", name: "", type: "", index_type: [] },
      ]);
      await flushPromises();

      // Nothing validates before the first submit.
      expect(wrapper.text()).not.toContain("Field is required!");

      await getForm(wrapper).handleSubmit();
      await flushPromises();

      expect(getForm(wrapper).state.isValid).toBe(false);
      expect(wrapper.text()).toContain("Field is required!");
      expect(wrapper.text()).toContain("Data Type is required!");
    });

    it("rejects a row name with disallowed characters", async () => {
      const wrapper = makeHarness([
        { uuid: "1", name: "bad name!", type: "Utf8", index_type: [] },
      ]);
      await flushPromises();

      await getForm(wrapper).handleSubmit();
      await flushPromises();

      expect(getForm(wrapper).state.isValid).toBe(false);
    });

    // Regression: a schema `.trim()` would let a surrounding space PASS (the
    // regex judges the trimmed copy) while OForm saves the RAW row value. The
    // schema validates the RAW value (no `.trim()`), so " my_field " is rejected
    // by the character rule — mirroring `main` and the scalar `name` fix.
    it("rejects a row name with surrounding whitespace", async () => {
      const wrapper = makeHarness([
        { uuid: "1", name: " my_field ", type: "Utf8", index_type: [] },
      ]);
      await flushPromises();

      await getForm(wrapper).handleSubmit();
      await flushPromises();

      expect(getForm(wrapper).state.isValid).toBe(false);
      expect(wrapper.text()).toContain(
        "Use alphanumeric characters, underscore and colon only.",
      );
    });

    it("passes when every row has a valid name + type", async () => {
      const wrapper = makeHarness(mockFields);
      await flushPromises();

      await getForm(wrapper).handleSubmit();
      await flushPromises();

      expect(getForm(wrapper).state.isValid).toBe(true);
    });
  });

  describe("Exposed helpers", () => {
    it("exposes addRow / removeRow / getIndexTypeOptions / disableOptions", async () => {
      const wrapper = makeHarness([]);
      await flushPromises();
      const vm = childVm(wrapper);
      expect(typeof vm.addRow).toBe("function");
      expect(typeof vm.removeRow).toBe("function");
      expect(typeof vm.getIndexTypeOptions).toBe("function");
      expect(typeof vm.disableOptions).toBe("function");
    });
  });

  describe("Constants", () => {
    it("exposes the streamIndexType array (10 options)", async () => {
      const wrapper = makeHarness([]);
      await flushPromises();
      const streamIndexType = childVm(wrapper).streamIndexType;
      expect(streamIndexType).toHaveLength(10);
      expect(streamIndexType[0]).toEqual({
        label: "Full text search",
        value: "fullTextSearchKey",
      });
      expect(streamIndexType[1]).toEqual({
        label: "Secondary index",
        value: "secondaryIndexKey",
      });
      expect(streamIndexType[2]).toEqual({
        label: "Bloom filter",
        value: "bloomFilterKey",
      });
    });

    it("exposes the dataTypes array (5 options)", async () => {
      const wrapper = makeHarness([]);
      await flushPromises();
      const dataTypes = childVm(wrapper).dataTypes;
      expect(dataTypes).toHaveLength(5);
      expect(dataTypes.map((d: any) => d.value)).toEqual([
        "Utf8",
        "Int64",
        "Uint64",
        "Float64",
        "Boolean",
      ]);
    });
  });

  describe("disableOptions logic", () => {
    let disable: (schema: any, option: any) => boolean;

    const setup = async () => {
      const wrapper = makeHarness([]);
      await flushPromises();
      disable = childVm(wrapper).disableOptions;
      return wrapper;
    };

    it("returns false when no conflicting options selected", async () => {
      await setup();
      expect(
        disable({ index_type: ["fullTextSearchKey"] }, { value: "secondaryIndexKey" }),
      ).toBe(false);
    });

    it("disables keyPartition when prefixPartition is selected", async () => {
      await setup();
      expect(
        disable({ index_type: ["prefixPartition"] }, { value: "keyPartition" }),
      ).toBe(true);
    });

    it("disables prefixPartition when keyPartition is selected", async () => {
      await setup();
      expect(
        disable({ index_type: ["keyPartition"] }, { value: "prefixPartition" }),
      ).toBe(true);
    });

    it("disables a different hash partition when one is already selected", async () => {
      await setup();
      expect(
        disable({ index_type: ["hashPartition_8"] }, { value: "hashPartition_16" }),
      ).toBe(true);
    });

    it("allows the same hash partition that is already selected", async () => {
      await setup();
      expect(
        disable({ index_type: ["hashPartition_8"] }, { value: "hashPartition_8" }),
      ).toBe(false);
    });

    it("disables hash partition when keyPartition is selected", async () => {
      await setup();
      expect(
        disable({ index_type: ["keyPartition"] }, { value: "hashPartition_8" }),
      ).toBe(true);
    });

    it("disables hash partition when prefixPartition is selected", async () => {
      await setup();
      expect(
        disable({ index_type: ["prefixPartition"] }, { value: "hashPartition_8" }),
      ).toBe(true);
    });

    it("handles an empty index_type array", async () => {
      await setup();
      expect(disable({ index_type: [] }, { value: "fullTextSearchKey" })).toBe(
        false,
      );
    });

    it("handles an undefined index_type", async () => {
      await setup();
      expect(disable({}, { value: "fullTextSearchKey" })).toBe(false);
    });

    it("does not disable non-partition types when hashPartition is selected", async () => {
      await setup();
      const schema = { index_type: ["hashPartition_8"] };
      expect(disable(schema, { value: "fullTextSearchKey" })).toBe(false);
      expect(disable(schema, { value: "secondaryIndexKey" })).toBe(false);
      expect(disable(schema, { value: "bloomFilterKey" })).toBe(false);
    });

    it("disables other hash variants + partition types with a complex selection", async () => {
      await setup();
      const complexSchema = {
        index_type: ["hashPartition_8", "fullTextSearchKey", "bloomFilterKey"],
      };
      expect(disable(complexSchema, { value: "hashPartition_16" })).toBe(true);
      expect(disable(complexSchema, { value: "hashPartition_8" })).toBe(false);
      expect(disable(complexSchema, { value: "keyPartition" })).toBe(true);
      expect(disable(complexSchema, { value: "prefixPartition" })).toBe(true);
      expect(disable(complexSchema, { value: "fullTextSearchKey" })).toBe(false);
    });
  });
});
