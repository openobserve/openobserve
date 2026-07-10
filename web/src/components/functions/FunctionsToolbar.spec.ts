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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import FunctionsToolbar from "./FunctionsToolbar.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { makeAddFunctionSchema } from "./AddFunction.schema";
import i18n from "@/locales";
import { createRouter, createWebHistory } from "vue-router";
import { createStore } from "vuex";

// The schema is a factory taking vue-i18n's `t`; use the real i18n so messages
// resolve exactly as they do in the app.
const addFunctionSchema = makeAddFunctionSchema((k: string) =>
  i18n.global.t(k as never),
);

describe("FunctionsToolbar", () => {
  let store: any;
  let router: any;

  // The toolbar's name + transType fields are form-owned (OForm*), so they only
  // render inside an <OForm>. The harness provides that context (mirroring how
  // AddFunction.vue hosts the toolbar) and exposes the form + the submit spy.
  const mountToolbar = (
    toolbarProps: Record<string, any> = {},
    defaults: Record<string, any> = { name: "", transType: "0" },
    onSubmit: (v: any) => void = vi.fn(),
  ) => {
    const Harness = {
      components: { OForm, FunctionsToolbar },
      props: ["toolbarProps", "defaults"],
      setup(props: any) {
        return { schema: addFunctionSchema, onSubmit, props };
      },
      template: `
        <OForm
          id="add-function-form"
          :schema="schema"
          :default-values="props.defaults"
          @submit="onSubmit"
          v-slot="{ isSubmitting }"
        >
          <FunctionsToolbar v-bind="props.toolbarProps" :is-submitting="isSubmitting" />
        </OForm>
      `,
    };

    return mount(Harness, {
      props: { toolbarProps, defaults },
      global: { plugins: [i18n, store, router] },
    });
  };

  const getForm = (w: any) => (w.findComponent(OForm).vm as any).form;
  const getToolbar = (w: any) => w.findComponent(FunctionsToolbar);

  beforeEach(() => {
    store = createStore({
      state: {
        theme: "light",
        isAiChatEnabled: false,
        zoConfig: {
          ai_enabled: true,
        },
      },
    });

    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/functions", name: "functions", component: { template: "<div>Functions</div>" } },
      ],
    });

    router.push("/functions");
  });

  it("should render the component", () => {
    const wrapper = mountToolbar({
      transformTypeOptions: [
        { label: "VRL", value: "0" },
        { label: "JavaScript", value: "1" },
      ],
    });
    expect(getToolbar(wrapper).exists()).toBe(true);
  });

  it("should display function name input (form-owned)", () => {
    const wrapper = mountToolbar({
      transformTypeOptions: [{ label: "VRL", value: "0" }],
    });
    expect(wrapper.find('[data-test="add-function-name-input"]').exists()).toBe(true);
  });

  it("should update the form's name when the input changes", async () => {
    const wrapper = mountToolbar({
      transformTypeOptions: [{ label: "VRL", value: "0" }],
    });
    const input = wrapper.find('[data-test="add-function-name-input-field"]');
    await input.setValue("newName");

    expect(getForm(wrapper).state.values.name).toBe("newName");
  });

  it("should disable name input when disableName is true", () => {
    const wrapper = mountToolbar({
      disableName: true,
      transformTypeOptions: [{ label: "VRL", value: "0" }],
    });
    const input = wrapper.find('[data-test="add-function-name-input-field"]');
    expect(input.attributes("disabled")).toBeDefined();
  });

  it("should render VRL radio button", () => {
    const wrapper = mountToolbar({
      transformTypeOptions: [{ label: "VRL", value: "0" }],
    });
    expect(wrapper.find('[data-test="function-transform-type-vrl-radio"]').exists()).toBe(true);
  });

  it("should render JavaScript radio button when option is provided", () => {
    const wrapper = mountToolbar({
      transformTypeOptions: [
        { label: "VRL", value: "0" },
        { label: "JavaScript", value: "1" },
      ],
    });
    expect(wrapper.find('[data-test="function-transform-type-js-radio"]').exists()).toBe(true);
  });

  it("should NOT render the JavaScript radio when only one option is provided", () => {
    const wrapper = mountToolbar({
      transformTypeOptions: [{ label: "VRL", value: "0" }],
    });
    expect(wrapper.find('[data-test="function-transform-type-js-radio"]').exists()).toBe(false);
  });

  it("should emit test event when test button is clicked", async () => {
    const wrapper = mountToolbar({
      transformTypeOptions: [{ label: "VRL", value: "0" }],
    });
    await wrapper.find('[data-test="add-function-test-btn"]').trigger("click");
    expect(getToolbar(wrapper).emitted("test")).toBeTruthy();
  });

  it("should emit cancel event when cancel button is clicked", async () => {
    const wrapper = mountToolbar({
      transformTypeOptions: [{ label: "VRL", value: "0" }],
    });
    await wrapper.find('[data-test="add-function-cancel-btn"]').trigger("click");
    expect(getToolbar(wrapper).emitted("cancel")).toBeTruthy();
  });

  it("should emit back event when back button is clicked", async () => {
    const wrapper = mountToolbar({
      transformTypeOptions: [{ label: "VRL", value: "0" }],
    });
    await wrapper.find('[data-test="add-function-back-btn"]').trigger("click");
    expect(getToolbar(wrapper).emitted("back")).toBeTruthy();
  });

  it("should keep the Save button enabled (no :disabled binding)", () => {
    const wrapper = mountToolbar({
      transformTypeOptions: [{ label: "VRL", value: "0" }],
    });
    const saveBtn = wrapper.find('[data-test="add-function-save-btn"]');
    expect(saveBtn.exists()).toBe(true);
    expect(saveBtn.attributes("disabled")).toBeUndefined();
    // The Save button submits the form natively.
    expect(saveBtn.attributes("type")).toBe("submit");
  });

  it("blocks submit for an invalid (empty) name — save NOT called", async () => {
    const onSubmit = vi.fn();
    const wrapper = mountToolbar(
      { transformTypeOptions: [{ label: "VRL", value: "0" }] },
      { name: "", transType: "0" },
      onSubmit,
    );
    await getForm(wrapper).handleSubmit();
    await flushPromises();

    expect(getForm(wrapper).state.isValid).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("blocks submit for an invalid method name — save NOT called", async () => {
    const onSubmit = vi.fn();
    const wrapper = mountToolbar(
      { transformTypeOptions: [{ label: "VRL", value: "0" }] },
      { name: "123-invalid", transType: "0" },
      onSubmit,
    );
    await getForm(wrapper).handleSubmit();
    await flushPromises();

    expect(getForm(wrapper).state.isValid).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits a valid function name", async () => {
    const onSubmit = vi.fn();
    const wrapper = mountToolbar(
      { transformTypeOptions: [{ label: "VRL", value: "0" }] },
      { name: "validFunctionName", transType: "0" },
      onSubmit,
    );
    await getForm(wrapper).handleSubmit();
    await flushPromises();

    expect(onSubmit).toHaveBeenCalled();
    expect(onSubmit.mock.calls[0][0].name).toBe("validFunctionName");
  });
});
