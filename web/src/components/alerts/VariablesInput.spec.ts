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

import { describe, it, expect, afterEach } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { defineComponent } from "vue";
import { z } from "zod";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import VariablesInput from "@/components/alerts/VariablesInput.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OInput from "@/lib/forms/Input/OInput.vue";

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// form mode (opt-in via `name-prefix` inside a REAL <OForm>)
// ---------------------------------------------------------------------------

const variableRowSchema = z.object({
  key: z.string(),
  value: z.string(),
});

const variablesHostSchema = z.object({
  variables: z.array(variableRowSchema),
});

// Host renders a REAL <OForm> (schema + default-values) around VariablesInput —
// form mode is driven purely by `name-prefix` + the injected form context.
const FormHost = defineComponent({
  components: { OForm, VariablesInput },
  props: {
    rows: { type: Array, default: () => [] },
  },
  setup(props) {
    return {
      hostSchema: variablesHostSchema,
      hostDefaults: { variables: JSON.parse(JSON.stringify(props.rows)) },
    };
  },
  template: `
    <OForm :schema="hostSchema" :default-values="hostDefaults" @submit="() => {}">
      <VariablesInput name-prefix="variables" />
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

/** RENDERED model-values (OFormInput → OInput) for a row field, in DOM order. */
const renderedField = (w: VueWrapper<any>, field: "key" | "value") =>
  w
    .findAllComponents(OFormInput)
    .filter(
      (c) =>
        /^variables\[\d+\]\.(key|value)$/.test(String(c.props("name"))) &&
        String(c.props("name")).endsWith(`.${field}`),
    )
    .map((c) => c.findComponent(OInput).props("modelValue"));

describe("VariablesInput — form mode (name-prefix inside a real <OForm>)", () => {
  let wrapper: VueWrapper<any> | null = null;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  const threeRows = [
    { key: "k1", value: "v1" },
    { key: "k2", value: "v2" },
    { key: "k3", value: "v3" },
  ];

  it("renders one row per form-state entry, carrying the bare-mode data-tests", () => {
    wrapper = buildFormWrapper(threeRows);

    expect(wrapper.find('[data-test="alert-variables-1"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-variables-2"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-variables-3"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-variables-add-btn"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-test="alert-variables-key-input"]')).toHaveLength(3);
    expect(wrapper.findAll('[data-test="alert-variables-value-input"]')).toHaveLength(3);
    expect(wrapper.findAll('[data-test="alert-variables-delete-variable-btn"]')).toHaveLength(3);
    // inline add button only on the last row
    expect(wrapper.findAll('[data-test="alert-variables-add-variable-btn"]')).toHaveLength(1);
  });

  it("renders the row inputs from the form state (name=-owned, no props)", () => {
    wrapper = buildFormWrapper(threeRows);

    expect(renderedField(wrapper, "key")).toEqual(["k1", "k2", "k3"]);
    expect(renderedField(wrapper, "value")).toEqual(["v1", "v2", "v3"]);
  });

  it("shows the empty-state Add Variable button and pushes a row into the form", async () => {
    wrapper = buildFormWrapper([]);

    expect(wrapper.find('[data-test="alert-variables-add-btn"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-variables-1"]').exists()).toBe(false);

    await wrapper.find('[data-test="alert-variables-add-btn"]').trigger("click");
    await flushPromises();

    expect(getForm(wrapper).state.values.variables).toEqual([{ key: "", value: "" }]);
    expect(wrapper.find('[data-test="alert-variables-1"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-variables-add-btn"]').exists()).toBe(false);
  });

  it("typing in a row's key/value inputs updates the form values", async () => {
    wrapper = buildFormWrapper([threeRows[0]]);

    await wrapper
      .find('[data-test="alert-variables-key-input"] input')
      .setValue("typedKey");
    await wrapper
      .find('[data-test="alert-variables-value-input"] input')
      .setValue("typedValue");
    await flushPromises();

    expect(getForm(wrapper).state.values.variables[0]).toEqual({
      key: "typedKey",
      value: "typedValue",
    });
  });

  it("the inline add button appends a row to the form array", async () => {
    wrapper = buildFormWrapper([threeRows[0]]);

    await wrapper.find('[data-test="alert-variables-add-variable-btn"]').trigger("click");
    await flushPromises();

    expect(getForm(wrapper).state.values.variables).toHaveLength(2);
    expect(wrapper.find('[data-test="alert-variables-2"]').exists()).toBe(true);
  });

  it("does not emit bare-mode events in form mode (form owns the rows)", async () => {
    wrapper = buildFormWrapper(threeRows);

    await wrapper.findAll('[data-test="alert-variables-delete-variable-btn"]')[0].trigger("click");
    await wrapper.find('[data-test="alert-variables-add-variable-btn"]').trigger("click");
    await flushPromises();

    const variablesInput = wrapper.findComponent(VariablesInput);
    expect(variablesInput.emitted("add:variable")).toBeUndefined();
    expect(variablesInput.emitted("remove:variable")).toBeUndefined();
  });

  // 🔑 Rule ① gate — delete a NON-last row and assert the RENDERED inputs
  // (OFormInput→OInput model-values), NOT just form.state.values: a stable-id
  // :key bug leaves the data correct while the inputs render shifted/blank.
  it("Rule ① — deleting a NON-last row keeps the RENDERED inputs in sync", async () => {
    wrapper = buildFormWrapper(threeRows);

    expect(renderedField(wrapper, "key")).toEqual(["k1", "k2", "k3"]);

    const deleteBtns = wrapper.findAll('[data-test="alert-variables-delete-variable-btn"]');
    expect(deleteBtns).toHaveLength(3);
    await deleteBtns[1].trigger("click"); // delete the MIDDLE row
    await flushPromises();

    // the RENDERED inputs must match the remaining rows, in order
    expect(renderedField(wrapper, "key")).toEqual(["k1", "k3"]);
    expect(renderedField(wrapper, "value")).toEqual(["v1", "v3"]);
    expect(wrapper.findAll('[data-test="alert-variables-key-input"]')).toHaveLength(2);
    expect(wrapper.find('[data-test="alert-variables-3"]').exists()).toBe(false);

    // and the form data agrees
    expect(getForm(wrapper).state.values.variables).toEqual([
      { key: "k1", value: "v1" },
      { key: "k3", value: "v3" },
    ]);
  });
});
