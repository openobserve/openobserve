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
// helpers
// ---------------------------------------------------------------------------

function buildWrapper(props: Record<string, any> = {}): VueWrapper<any> {
  return mount(VariablesInput, {
    props: {
      variables: [],
      ...props,
    },
    global: {
      plugins: [i18n, store],
    },
  });
}

const twoVars = [
  { uuid: "1", key: "var1", value: "value1" },
  { uuid: "2", key: "var2", value: "value2" },
];

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("VariablesInput", () => {
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

    it("renders the 'Variable' section heading", () => {
      wrapper = buildWrapper();

      expect(wrapper.text()).toContain("Variable");
    });

    it("renders the info-outline icon in the heading area", () => {
      wrapper = buildWrapper();

      const icons = wrapper.findAllComponents({ name: "OIcon" });
      expect(icons.some((i) => i.props("name") === "info-outline")).toBe(true);
    });
  });

  // ── Empty variables state (v-if branch) ──────────────────────────────────

  describe("empty variables state", () => {
    it("shows the Add Variable button when variables is empty", () => {
      wrapper = buildWrapper({ variables: [] });

      expect(wrapper.find('[data-test="alert-variables-add-btn"]').exists()).toBe(true);
    });

    it("Add Variable button contains the expected text", () => {
      wrapper = buildWrapper({ variables: [] });

      expect(wrapper.find('[data-test="alert-variables-add-btn"]').text()).toContain("Add Variable");
    });

    it("does not show individual variable rows when variables is empty", () => {
      wrapper = buildWrapper({ variables: [] });

      expect(wrapper.find('[data-test="alert-variables-1"]').exists()).toBe(false);
    });

    it("emits 'add:variable' when the add button is clicked in empty state", async () => {
      wrapper = buildWrapper({ variables: [] });

      await wrapper.find('[data-test="alert-variables-add-btn"]').trigger("click");

      expect(wrapper.emitted("add:variable")).toBeTruthy();
      expect(wrapper.emitted("add:variable")!.length).toBe(1);
    });
  });

  // ── Non-empty variables state (v-else branch) ─────────────────────────────

  describe("non-empty variables state", () => {
    it("hides the Add Variable button when variables is non-empty", () => {
      wrapper = buildWrapper({ variables: twoVars });

      expect(wrapper.find('[data-test="alert-variables-add-btn"]').exists()).toBe(false);
    });

    it("renders one row per variable", () => {
      wrapper = buildWrapper({ variables: twoVars });

      expect(wrapper.find('[data-test="alert-variables-1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="alert-variables-2"]').exists()).toBe(true);
    });

    it("renders a key input for each variable", () => {
      wrapper = buildWrapper({ variables: twoVars });

      const keyInputs = wrapper.findAll('[data-test="alert-variables-key-input"]');
      expect(keyInputs).toHaveLength(2);
    });

    it("renders a value input for each variable", () => {
      wrapper = buildWrapper({ variables: twoVars });

      const valueInputs = wrapper.findAll('[data-test="alert-variables-value-input"]');
      expect(valueInputs).toHaveLength(2);
    });

    it("reflects variable key data in the rendered HTML", () => {
      wrapper = buildWrapper({ variables: twoVars });

      expect(wrapper.html()).toContain("var1");
      expect(wrapper.html()).toContain("var2");
    });

    it("reflects variable value data in the rendered HTML", () => {
      wrapper = buildWrapper({ variables: twoVars });

      expect(wrapper.html()).toContain("value1");
      expect(wrapper.html()).toContain("value2");
    });
  });

  // ── Delete variable ───────────────────────────────────────────────────────

  describe("delete variable", () => {
    it("renders a delete button for every variable row", () => {
      wrapper = buildWrapper({ variables: twoVars });

      const deleteBtns = wrapper.findAll('[data-test="alert-variables-delete-variable-btn"]');
      expect(deleteBtns).toHaveLength(2);
    });

    it("emits 'remove:variable' when a delete button is clicked", async () => {
      wrapper = buildWrapper({ variables: twoVars });

      await wrapper.find('[data-test="alert-variables-delete-variable-btn"]').trigger("click");

      expect(wrapper.emitted("remove:variable")).toBeTruthy();
      expect(wrapper.emitted("remove:variable")!.length).toBe(1);
    });

    it("emits 'remove:variable' with the correct variable object", async () => {
      wrapper = buildWrapper({ variables: twoVars });

      await wrapper.find('[data-test="alert-variables-delete-variable-btn"]').trigger("click");

      expect(wrapper.emitted("remove:variable")![0]).toEqual([twoVars[0]]);
    });
  });

  // ── Add variable inline button ────────────────────────────────────────────

  describe("add variable inline button", () => {
    it("shows the inline add button only on the last row", () => {
      wrapper = buildWrapper({ variables: twoVars });

      const addBtns = wrapper.findAll('[data-test="alert-variables-add-variable-btn"]');
      expect(addBtns).toHaveLength(1);
    });

    it("emits 'add:variable' when the inline add button is clicked", async () => {
      wrapper = buildWrapper({ variables: twoVars });

      await wrapper.find('[data-test="alert-variables-add-variable-btn"]').trigger("click");

      expect(wrapper.emitted("add:variable")).toBeTruthy();
      expect(wrapper.emitted("add:variable")!.length).toBe(1);
    });
  });

  // ── Input placeholders ────────────────────────────────────────────────────

  describe("input placeholders", () => {
    it("key input has a defined placeholder", () => {
      wrapper = buildWrapper({ variables: [twoVars[0]] });

      const keyInput = wrapper
        .findAllComponents({ name: "OInput" })
        .find((c) => c.attributes("data-test") === "alert-variables-key-input");
      expect(keyInput?.props("placeholder")).toBeDefined();
    });

    it("value input has a defined placeholder", () => {
      wrapper = buildWrapper({ variables: [twoVars[0]] });

      const valueInput = wrapper
        .findAllComponents({ name: "OInput" })
        .find((c) => c.attributes("data-test") === "alert-variables-value-input");
      expect(valueInput?.props("placeholder")).toBeDefined();
    });
  });

  // ── Component methods ─────────────────────────────────────────────────────

  describe("component method exposure", () => {
    it("exposes removeVariable as a function", () => {
      wrapper = buildWrapper();

      expect(typeof wrapper.vm.removeVariable).toBe("function");
    });

    it("exposes addVariable as a function", () => {
      wrapper = buildWrapper();

      expect(typeof wrapper.vm.addVariable).toBe("function");
    });
  });

  // ── Props reactivity ──────────────────────────────────────────────────────

  describe("props reactivity", () => {
    it("switches to list view when variables prop changes from empty to non-empty", async () => {
      wrapper = buildWrapper({ variables: [] });

      await wrapper.setProps({ variables: [twoVars[0]] });

      expect(wrapper.find('[data-test="alert-variables-1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="alert-variables-add-btn"]').exists()).toBe(false);
    });

    it("switches back to add-btn view when variables prop changes to empty", async () => {
      wrapper = buildWrapper({ variables: twoVars });

      await wrapper.setProps({ variables: [] });

      expect(wrapper.find('[data-test="alert-variables-add-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="alert-variables-1"]').exists()).toBe(false);
    });

    it("renders correct number of rows for 3 variables", () => {
      const threeVars = [
        { uuid: "1", key: "k1", value: "v1" },
        { uuid: "2", key: "k2", value: "v2" },
        { uuid: "3", key: "k3", value: "v3" },
      ];
      wrapper = buildWrapper({ variables: threeVars });

      const keyInputs = wrapper.findAll('[data-test="alert-variables-key-input"]');
      expect(keyInputs.length).toBe(3);
    });
  });

  // ── Emit event names ──────────────────────────────────────────────────────

  describe("all emitted event names", () => {
    it("emits 'remove:variable' and 'add:variable' with correct names", async () => {
      wrapper = buildWrapper({ variables: [twoVars[0]] });

      await wrapper.find('[data-test="alert-variables-delete-variable-btn"]').trigger("click");
      await wrapper.find('[data-test="alert-variables-add-variable-btn"]').trigger("click");

      expect(Object.keys(wrapper.emitted())).toContain("remove:variable");
      expect(Object.keys(wrapper.emitted())).toContain("add:variable");
    });
  });
});

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
