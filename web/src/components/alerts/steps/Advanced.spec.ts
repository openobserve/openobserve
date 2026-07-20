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

// Behavior spec for the Advanced step. The step is a DESCENDANT of the ONE
// AddAlert <OForm>: an ancestor form provides FORM_CONTEXT_KEY and the fields
// bind by nested `name=` (template / context_attributes[i].* / description /
// row_template / row_template_type) into it. The host below mirrors that
// wiring with the same composed schema fragment AddAlert.schema.ts exports.
//
// Includes the MANDATORY Rule-① field-array delete test: with ≥3 context-variable
// rows, deleting a NON-last row must leave the RENDERED inputs (not just
// form.state.values) shifted correctly — proving the v-for `:key` is the array
// index, not a stable id.

import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import Advanced from "./Advanced.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import { createAdvancedSchema } from "@/components/alerts/AddAlert.schema";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("@/utils/zincutils", async () => {
  const actual: any = await vi.importActual("@/utils/zincutils");
  let n = 0;
  return {
    ...actual,
    getUUID: vi.fn(() => `uuid-${++n}`),
  };
});

// The help drawer pulls extra deps we do not exercise here.
const globalCfg = {
  global: {
    plugins: [i18n, store],
    stubs: { AlertSettingsHelpDrawer: true },
  },
};

// ── DESCENDANT host (binds into an ancestor OForm — the app wiring) ─────────

function makeDescendantHost(initialRows: any[] = []) {
  return defineComponent({
    components: { OForm, Advanced },
    setup() {
      const schema = createAdvancedSchema();
      const defaultValues = {
        template: "",
        context_attributes: initialRows,
        description: "",
        row_template: "",
        row_template_type: "String",
      };
      return { schema, defaultValues };
    },
    template: `
      <OForm :schema="schema" :default-values="defaultValues" @submit="() => {}">
        <Advanced :context-attributes="[]" />
      </OForm>
    `,
  });
}

function mountDescendant(initialRows: any[] = []) {
  return mount(makeDescendantHost(initialRows), globalCfg);
}

const hostForm = (host: any) =>
  (host.findComponent({ name: "OForm" }).vm as any).form;

describe("Advanced — descendant (binds into ancestor OForm) mode", () => {
  it("does NOT render its own <OForm> — fields bind into the parent", () => {
    const host = mountDescendant();
    expect(host.findAllComponents({ name: "OForm" }).length).toBe(1);
    expect(host.findComponent(Advanced).exists()).toBe(true);
    expect(host.find(".step-advanced").exists()).toBe(true);
  });

  it("typing a variable key updates the PARENT form's state", async () => {
    const host = mountDescendant([{ id: "1", key: "", value: "" }]);
    const parentForm = hostForm(host);

    await host
      .find('[data-test="alert-variables-key-input"] input')
      .setValue("env");
    await flushPromises();

    expect(parentForm.state.values.context_attributes[0].key).toBe("env");
  });

  it("shows the empty-state add button; adding pushes a row into the PARENT form (no emit)", async () => {
    const host = mountDescendant();
    const parentForm = hostForm(host);

    expect(host.find('[data-test="alert-variables-add-btn"]').exists()).toBe(
      true,
    );
    await host.find('[data-test="alert-variables-add-btn"]').trigger("click");
    await flushPromises();

    expect(parentForm.state.values.context_attributes.length).toBe(1);
    // descendant mode is form-owned → no emit
    expect(host.findComponent(Advanced).emitted("update:contextAttributes"))
      .toBeFalsy();
  });

  it("typing description / row template writes into the PARENT form", async () => {
    const host = mountDescendant();
    const parentForm = hostForm(host);

    const textareas = host.findAll("textarea");
    // first textarea = description, second = row template
    await textareas[0].setValue("a description");
    await flushPromises();
    expect(parentForm.state.values.description).toBe("a description");

    await host
      .find('[data-test="add-alert-row-input-textarea"] textarea')
      .setValue("row tmpl");
    await flushPromises();
    expect(parentForm.state.values.row_template).toBe("row tmpl");
  });

  it("template select + row-template-type toggle write into the PARENT form", async () => {
    const host = mountDescendant();
    const parentForm = hostForm(host);

    // The OForm* wrappers bind the inner control's update:model-value to
    // field.handleChange — drive that path directly.
    host
      .findComponent('[data-test="advanced-template-override-select"]')
      .vm.$emit("update:model-value", "tmpl-a");
    await flushPromises();
    expect(parentForm.state.values.template).toBe("tmpl-a");

    host
      .findComponent('[data-test="add-alert-row-template-type-toggle"]')
      .vm.$emit("update:model-value", "Json");
    await flushPromises();
    expect(parentForm.state.values.row_template_type).toBe("Json");
  });

  it("applying a template from the help drawer writes into the PARENT form", async () => {
    const host = mountDescendant();
    const parentForm = hostForm(host);

    (host.findComponent(Advanced).vm as any).onApplyTemplate("tmpl-b");
    await flushPromises();

    expect(parentForm.state.values.template).toBe("tmpl-b");
    expect(host.findComponent(Advanced).emitted("update:template")).toBeFalsy();
  });

  it("preserves every data-test", () => {
    const host = mountDescendant([{ id: "1", key: "env", value: "prod" }]);
    for (const dt of [
      "advanced-template-info-btn",
      "advanced-variables-info-btn",
      "advanced-template-override-select",
      "alert-variables-key-input",
      "alert-variables-value-input",
      "alert-variables-delete-variable-btn",
      "alert-variables-add-variable-btn",
      "add-alert-row-input-info-btn",
      "add-alert-row-template-type-toggle",
      "add-alert-row-input-textarea",
    ]) {
      expect(host.find(`[data-test="${dt}"]`).exists()).toBe(true);
    }
  });

  // ── MANDATORY Rule-① field-array delete test ───────────────────────────────
  it("deleting a NON-last row leaves the RENDERED inputs correct (:key=index)", async () => {
    const host = mountDescendant([
      { id: "a", key: "env", value: "prod" },
      { id: "b", key: "region", value: "us" },
      { id: "c", key: "tier", value: "gold" },
    ]);
    const parentForm = hostForm(host);

    const renderedKeys = () =>
      host
        .findAllComponents(OFormInput)
        .filter((c: any) =>
          /^context_attributes\[\d+\]\.key$/.test(c.props("name")),
        )
        .map((c: any) => c.findComponent(OInput).props("modelValue"));
    const renderedValues = () =>
      host
        .findAllComponents(OFormInput)
        .filter((c: any) =>
          /^context_attributes\[\d+\]\.value$/.test(c.props("name")),
        )
        .map((c: any) => c.findComponent(OInput).props("modelValue"));

    expect(renderedKeys()).toEqual(["env", "region", "tier"]);

    // delete the MIDDLE row (index 1 = "region")
    await host
      .findAll('[data-test="alert-variables-delete-variable-btn"]')[1]
      .trigger("click");
    await flushPromises();
    await nextTick();

    // form data is correct...
    expect(
      parentForm.state.values.context_attributes.map((r: any) => r.key),
    ).toEqual(["env", "tier"]);
    // ...AND the RENDERED inputs shifted correctly (would be ["env",""] with a
    // stable-id :key — the exact bug this test guards against).
    expect(renderedKeys()).toEqual(["env", "tier"]);
    expect(renderedValues()).toEqual(["prod", "gold"]);
  });
});
