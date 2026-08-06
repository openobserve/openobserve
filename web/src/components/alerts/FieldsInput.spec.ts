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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { defineComponent } from "vue";
import { z } from "zod";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import FieldsInput from "@/components/alerts/FieldsInput.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const makeField = (overrides: Record<string, any> = {}) => ({
  uuid: Math.random().toString(36).slice(2),
  column: "",
  operator: "=",
  value: "",
  ...overrides,
});

const streamFields = [
  { label: "Host", value: "host" },
  { label: "Level", value: "level" },
  { label: "Message", value: "message" },
];

function buildWrapper(props: Record<string, any> = {}): VueWrapper<any> {
  return mount(FieldsInput, {
    props: {
      fields: [],
      streamFields,
      ...props,
    },
    global: { plugins: [i18n, store] },
  });
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("FieldsInput", () => {
  let wrapper: VueWrapper<any> | null = null;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  // ── Renders with minimum props ────────────────────────────────────────────

  describe("renders with minimum props", () => {
    it("mounts without error", () => {
      wrapper = buildWrapper();

      expect(wrapper.exists()).toBe(true);
    });

    it("renders the conditions title text element", () => {
      wrapper = buildWrapper();

      expect(wrapper.find('[data-test="alert-conditions-text"]').exists()).toBe(true);
    });

    it("shows the Add Condition button when fields is empty", () => {
      wrapper = buildWrapper({ fields: [] });

      expect(wrapper.find('[data-test="alert-conditions-add-btn"]').exists()).toBe(true);
    });

    it("does not show condition rows when fields is empty", () => {
      wrapper = buildWrapper({ fields: [] });

      expect(wrapper.find('[data-test="alert-conditions-1"]').exists()).toBe(false);
    });
  });

  // ── Empty / null edge cases ───────────────────────────────────────────────

  describe("edge cases — empty fields array", () => {
    it("hides the Add Condition button once a field is added", () => {
      wrapper = buildWrapper({ fields: [makeField()] });

      expect(wrapper.find('[data-test="alert-conditions-add-btn"]').exists()).toBe(false);
    });
  });

  // ── Rendering with fields ─────────────────────────────────────────────────

  describe("rendering with non-empty fields", () => {
    it("renders one condition row per field", () => {
      wrapper = buildWrapper({ fields: [makeField(), makeField()] });

      expect(wrapper.find('[data-test="alert-conditions-1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="alert-conditions-2"]').exists()).toBe(true);
    });

    it("renders a column select for each field", () => {
      wrapper = buildWrapper({ fields: [makeField()] });

      expect(wrapper.find('[data-test="alert-conditions-select-column"]').exists()).toBe(true);
    });

    it("renders an operator select for each field", () => {
      wrapper = buildWrapper({ fields: [makeField()] });

      expect(wrapper.find('[data-test="alert-conditions-operator-select"]').exists()).toBe(true);
    });

    it("renders a value input for each field", () => {
      wrapper = buildWrapper({ fields: [makeField()] });

      expect(wrapper.find('[data-test="alert-conditions-value-input"]').exists()).toBe(true);
    });

    it("renders a delete button for each field", () => {
      wrapper = buildWrapper({ fields: [makeField()] });

      expect(wrapper.find('[data-test="alert-conditions-delete-condition-btn"]').exists()).toBe(
        true,
      );
    });

    it("renders the add-condition inline button only on the last row", () => {
      wrapper = buildWrapper({ fields: [makeField(), makeField()] });

      const addBtns = wrapper.findAll('[data-test="alert-conditions-add-condition-btn"]');
      expect(addBtns).toHaveLength(1);
    });
  });

  // ── Interactive elements fire right events ────────────────────────────────

  describe("interactive elements", () => {
    it("clicking Add Condition button emits 'add'", async () => {
      wrapper = buildWrapper({ fields: [] });

      await wrapper.find('[data-test="alert-conditions-add-btn"]').trigger("click");

      expect(wrapper.emitted("add")).toBeTruthy();
      expect(wrapper.emitted("add")!.length).toBe(1);
    });

    it("clicking delete button emits 'remove' with the field object", async () => {
      const field = makeField({ column: "host" });
      wrapper = buildWrapper({ fields: [field] });

      await wrapper.find('[data-test="alert-conditions-delete-condition-btn"]').trigger("click");

      expect(wrapper.emitted("remove")).toBeTruthy();
      expect((wrapper.emitted("remove") as any[][])[0][0]).toMatchObject({ column: "host" });
    });

    it("clicking delete button also emits 'input:update'", async () => {
      const field = makeField({ column: "level" });
      wrapper = buildWrapper({ fields: [field] });

      await wrapper.find('[data-test="alert-conditions-delete-condition-btn"]').trigger("click");

      expect(wrapper.emitted("input:update")).toBeTruthy();
    });

    it("clicking the inline add-condition button emits 'add'", async () => {
      wrapper = buildWrapper({ fields: [makeField()] });

      await wrapper.find('[data-test="alert-conditions-add-condition-btn"]').trigger("click");

      expect(wrapper.emitted("add")).toBeTruthy();
    });
  });

  // ── v-if branching ────────────────────────────────────────────────────────

  describe("v-if branching", () => {
    it("shows the Add Condition button branch (v-if=!fields.length) when fields is empty", () => {
      wrapper = buildWrapper({ fields: [] });

      expect(wrapper.find('[data-test="alert-conditions-add-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="alert-conditions-1"]').exists()).toBe(false);
    });

    it("shows condition rows branch (v-else) and hides add-btn when fields is non-empty", () => {
      wrapper = buildWrapper({ fields: [makeField()] });

      expect(wrapper.find('[data-test="alert-conditions-add-btn"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="alert-conditions-1"]').exists()).toBe(true);
    });
  });

  // ── Props reactivity ──────────────────────────────────────────────────────

  describe("props reactivity", () => {
    it("switches to rows view when fields prop changes from empty to non-empty", async () => {
      wrapper = buildWrapper({ fields: [] });

      await wrapper.setProps({ fields: [makeField()] });

      expect(wrapper.find('[data-test="alert-conditions-1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="alert-conditions-add-btn"]').exists()).toBe(false);
    });

    it("switches back to add-btn view when fields prop changes to empty", async () => {
      wrapper = buildWrapper({ fields: [makeField()] });

      await wrapper.setProps({ fields: [] });

      expect(wrapper.find('[data-test="alert-conditions-add-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="alert-conditions-1"]').exists()).toBe(false);
    });

    it("renders correct number of rows after adding a second field", async () => {
      wrapper = buildWrapper({ fields: [makeField()] });

      await wrapper.setProps({ fields: [makeField(), makeField()] });

      expect(wrapper.find('[data-test="alert-conditions-2"]').exists()).toBe(true);
    });
  });

  // ── triggerOperators content ──────────────────────────────────────────────

  describe("triggerOperators data", () => {
    it("exposes triggerOperators on the component instance", () => {
      wrapper = buildWrapper();

      expect((wrapper.vm as any).triggerOperators).toBeDefined();
    });

    it("triggerOperators contains 8 operators", () => {
      wrapper = buildWrapper();

      expect((wrapper.vm as any).triggerOperators.length).toBe(8);
    });

    it("triggerOperators includes '='", () => {
      wrapper = buildWrapper();

      expect((wrapper.vm as any).triggerOperators).toContain("=");
    });

    it("triggerOperators includes '!='", () => {
      wrapper = buildWrapper();

      expect((wrapper.vm as any).triggerOperators).toContain("!=");
    });

    it("triggerOperators includes 'Contains'", () => {
      wrapper = buildWrapper();

      expect((wrapper.vm as any).triggerOperators).toContain("Contains");
    });

    it("triggerOperators includes 'NotContains'", () => {
      wrapper = buildWrapper();

      expect((wrapper.vm as any).triggerOperators).toContain("NotContains");
    });
  });
});

// ---------------------------------------------------------------------------
// form mode (opt-in via `name-prefix` inside a REAL <OForm>)
// ---------------------------------------------------------------------------

const conditionRowSchema = z.object({
  column: z.string(),
  operator: z.string(),
  value: z.string(),
});

const conditionsHostSchema = z.object({
  conditions: z.array(conditionRowSchema),
});

// Host renders a REAL <OForm> (schema + default-values) around FieldsInput —
// form mode is driven purely by `name-prefix` + the injected form context.
const FormHost = defineComponent({
  components: { OForm, FieldsInput },
  props: {
    rows: { type: Array, default: () => [] },
  },
  setup(props) {
    return {
      hostSchema: conditionsHostSchema,
      hostDefaults: { conditions: JSON.parse(JSON.stringify(props.rows)) },
      streamFields,
    };
  },
  template: `
    <OForm :schema="hostSchema" :default-values="hostDefaults" @submit="() => {}">
      <FieldsInput name-prefix="conditions" :stream-fields="streamFields" />
    </OForm>
  `,
});

function buildFormWrapper(rows: any[] = []): VueWrapper<any> {
  return mount(FormHost, {
    props: { rows },
    global: { plugins: [i18n, store] },
  });
}

const getForm = (w: VueWrapper<any>) => (w.findComponent(OForm).vm as any).form;

/** RENDERED value-input model-values (OFormInput → OInput), in DOM order. */
const renderedValues = (w: VueWrapper<any>) =>
  w
    .findAllComponents(OFormInput)
    .filter((c) => /^conditions\[\d+\]\.value$/.test(String(c.props("name"))))
    .map((c) => c.findComponent(OInput).props("modelValue"));

/** RENDERED column-select model-values (OFormSelect → OSelect), in DOM order. */
const renderedColumns = (w: VueWrapper<any>) =>
  w
    .findAllComponents(OFormSelect)
    .filter((c) => /^conditions\[\d+\]\.column$/.test(String(c.props("name"))))
    .map((c) => c.findComponent(OSelect).props("modelValue"));

describe("FieldsInput — form mode (name-prefix inside a real <OForm>)", () => {
  let wrapper: VueWrapper<any> | null = null;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  const threeRows = [
    { column: "host", operator: "=", value: "v1" },
    { column: "level", operator: "!=", value: "v2" },
    { column: "message", operator: ">", value: "v3" },
  ];

  it("renders one row per form-state entry, carrying the bare-mode data-tests", () => {
    wrapper = buildFormWrapper(threeRows);

    expect(wrapper.find('[data-test="alert-conditions-text"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-conditions-1"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-conditions-2"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-conditions-3"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-conditions-add-btn"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-test="alert-conditions-select-column"]')).toHaveLength(3);
    expect(wrapper.findAll('[data-test="alert-conditions-operator-select"]')).toHaveLength(3);
    expect(wrapper.findAll('[data-test="alert-conditions-value-input"]')).toHaveLength(3);
    expect(wrapper.findAll('[data-test="alert-conditions-delete-condition-btn"]')).toHaveLength(3);
    // inline add button only on the last row
    expect(wrapper.findAll('[data-test="alert-conditions-add-condition-btn"]')).toHaveLength(1);
  });

  it("renders the row inputs from the form state (name=-owned, no props)", () => {
    wrapper = buildFormWrapper(threeRows);

    expect(renderedValues(wrapper)).toEqual(["v1", "v2", "v3"]);
    expect(renderedColumns(wrapper)).toEqual(["host", "level", "message"]);
  });

  it("shows the empty-state Add Condition button and pushes a row into the form", async () => {
    wrapper = buildFormWrapper([]);

    expect(wrapper.find('[data-test="alert-conditions-add-btn"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-conditions-1"]').exists()).toBe(false);

    await wrapper.find('[data-test="alert-conditions-add-btn"]').trigger("click");
    await flushPromises();

    expect(getForm(wrapper).state.values.conditions).toEqual([
      { column: "", operator: "=", value: "" },
    ]);
    expect(wrapper.find('[data-test="alert-conditions-1"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-conditions-add-btn"]').exists()).toBe(false);
  });

  it("typing in a row's value input updates the form values", async () => {
    wrapper = buildFormWrapper([threeRows[0]]);

    await wrapper.find('[data-test="alert-conditions-value-input"] input').setValue("changed");
    await flushPromises();

    expect(getForm(wrapper).state.values.conditions[0].value).toBe("changed");
  });

  it("the inline add button appends a row to the form array", async () => {
    wrapper = buildFormWrapper([threeRows[0]]);

    await wrapper.find('[data-test="alert-conditions-add-condition-btn"]').trigger("click");
    await flushPromises();

    expect(getForm(wrapper).state.values.conditions).toHaveLength(2);
    expect(wrapper.find('[data-test="alert-conditions-2"]').exists()).toBe(true);
  });

  it("does not emit bare-mode events in form mode (form owns the rows)", async () => {
    wrapper = buildFormWrapper(threeRows);

    await wrapper
      .findAll('[data-test="alert-conditions-delete-condition-btn"]')[0]
      .trigger("click");
    await wrapper.find('[data-test="alert-conditions-add-condition-btn"]').trigger("click");
    await flushPromises();

    const fieldsInput = wrapper.findComponent(FieldsInput);
    expect(fieldsInput.emitted("add")).toBeUndefined();
    expect(fieldsInput.emitted("remove")).toBeUndefined();
    expect(fieldsInput.emitted("input:update")).toBeUndefined();
  });

  // 🔑 Rule ① gate — delete a NON-last row and assert the RENDERED inputs
  // (OFormInput→OInput / OFormSelect→OSelect model-values), NOT just
  // form.state.values: a stable-id :key bug leaves the data correct while the
  // inputs render shifted/blank.
  it("Rule ① — deleting a NON-last row keeps the RENDERED inputs in sync", async () => {
    wrapper = buildFormWrapper(threeRows);

    expect(renderedValues(wrapper)).toEqual(["v1", "v2", "v3"]);

    const deleteBtns = wrapper.findAll('[data-test="alert-conditions-delete-condition-btn"]');
    expect(deleteBtns).toHaveLength(3);
    await deleteBtns[1].trigger("click"); // delete the MIDDLE row
    await flushPromises();

    // the RENDERED inputs must match the remaining rows, in order
    expect(renderedValues(wrapper)).toEqual(["v1", "v3"]);
    expect(renderedColumns(wrapper)).toEqual(["host", "message"]);
    expect(wrapper.findAll('[data-test="alert-conditions-value-input"]')).toHaveLength(2);
    expect(wrapper.find('[data-test="alert-conditions-3"]').exists()).toBe(false);

    // and the form data agrees
    expect(getForm(wrapper).state.values.conditions).toEqual([
      { column: "host", operator: "=", value: "v1" },
      { column: "message", operator: ">", value: "v3" },
    ]);
  });
});
