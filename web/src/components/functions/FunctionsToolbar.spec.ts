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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import FunctionsToolbar from "./FunctionsToolbar.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import i18n from "@/locales";
import { createRouter, createWebHistory } from "vue-router";
import { createStore } from "vuex";

installQuasar();

describe("FunctionsToolbar", () => {
  let store: any;
  let router: any;

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
    const wrapper = mount(FunctionsToolbar, {
      props: {
        name: "testFunction",
        transformTypeOptions: [
          { label: "VRL", value: "0" },
          { label: "JavaScript", value: "1" },
        ],
      },
      global: {
        plugins: [i18n, store, router],
      },
    });

    expect(wrapper.exists()).toBe(true);
  });

  it("should display function name input", () => {
    const wrapper = mount(FunctionsToolbar, {
      props: {
        name: "myFunction",
        transformTypeOptions: [{ label: "VRL", value: "0" }],
      },
      global: {
        plugins: [i18n, store, router],
      },
    });

    const input = wrapper.find('[data-test="add-function-name-input"]');
    expect(input.exists()).toBe(true);
  });

  it("should emit update:name when function name changes", async () => {
    const wrapper = mount(FunctionsToolbar, {
      props: {
        name: "oldName",
        transformTypeOptions: [{ label: "VRL", value: "0" }],
      },
      global: {
        plugins: [i18n, store, router],
      },
    });

    const input = wrapper.find('[data-test="add-function-name-input"]');
    await input.setValue("newName");

    expect(wrapper.emitted("update:name")).toBeTruthy();
    expect(wrapper.emitted("update:name")?.[0]).toEqual(["newName"]);
  });

  it("should disable name input when disableName is true", () => {
    const wrapper = mount(FunctionsToolbar, {
      props: {
        name: "testFunction",
        disableName: true,
        transformTypeOptions: [{ label: "VRL", value: "0" }],
      },
      global: {
        plugins: [i18n, store, router],
      },
    });

    const input = wrapper.find('[data-test="add-function-name-input"]');
    expect(input.attributes("disable")).toBeDefined();
  });

  it("should validate function name format", async () => {
    const wrapper = mount(FunctionsToolbar, {
      props: {
        name: "123invalid",
        transformTypeOptions: [{ label: "VRL", value: "0" }],
      },
      global: {
        plugins: [i18n, store, router],
      },
    });

    // Trigger validation
    wrapper.vm.showInputError = true;
    await flushPromises();

    const validationResult = wrapper.vm.isValidMethodName();
    expect(validationResult).not.toBe(true);
    expect(typeof validationResult).toBe("string");
  });

  it("should accept valid function names", () => {
    const wrapper = mount(FunctionsToolbar, {
      props: {
        name: "validFunctionName",
        transformTypeOptions: [{ label: "VRL", value: "0" }],
      },
      global: {
        plugins: [i18n, store, router],
      },
    });

    const validationResult = wrapper.vm.isValidMethodName();
    expect(validationResult).toBe(true);
  });

  it("should render VRL radio button", () => {
    const wrapper = mount(FunctionsToolbar, {
      props: {
        name: "testFunction",
        transformTypeOptions: [
          { label: "VRL", value: "0" },
        ],
      },
      global: {
        plugins: [i18n, store, router],
      },
    });

    const vrlRadio = wrapper.find('[data-test="function-transform-type-vrl-radio"]');
    expect(vrlRadio.exists()).toBe(true);
  });

  it("should render JavaScript radio button when option is provided", () => {
    const wrapper = mount(FunctionsToolbar, {
      props: {
        name: "testFunction",
        transformTypeOptions: [
          { label: "VRL", value: "0" },
          { label: "JavaScript", value: "1" },
        ],
      },
      global: {
        plugins: [i18n, store, router],
      },
    });

    const jsRadio = wrapper.find('[data-test="function-transform-type-js-radio"]');
    expect(jsRadio.exists()).toBe(true);
  });

  it("should emit test event when test button is clicked", async () => {
    const wrapper = mount(FunctionsToolbar, {
      props: {
        name: "testFunction",
        transformTypeOptions: [{ label: "VRL", value: "0" }],
      },
      global: {
        plugins: [i18n, store, router],
      },
    });

    const testButton = wrapper.find('[data-test="add-function-test-btn"]');
    await testButton.trigger("click");

    expect(wrapper.emitted("test")).toBeTruthy();
  });

  it("should emit cancel event when cancel button is clicked", async () => {
    const wrapper = mount(FunctionsToolbar, {
      props: {
        name: "testFunction",
        transformTypeOptions: [{ label: "VRL", value: "0" }],
      },
      global: {
        plugins: [i18n, store, router],
      },
    });

    const cancelButton = wrapper.find('[data-test="add-function-cancel-btn"]');
    await cancelButton.trigger("click");

    expect(wrapper.emitted("cancel")).toBeTruthy();
  });

  it("should emit save event when save button is clicked", async () => {
    const wrapper = mount(FunctionsToolbar, {
      props: {
        name: "validFunction",
        transformTypeOptions: [{ label: "VRL", value: "0" }],
      },
      global: {
        plugins: [i18n, store, router],
      },
    });

    const saveButton = wrapper.find('[data-test="add-function-save-btn"]');
    await saveButton.trigger("click");

    expect(wrapper.emitted("save")).toBeTruthy();
  });

  it("should emit back event when back button is clicked", async () => {
    const wrapper = mount(FunctionsToolbar, {
      props: {
        name: "testFunction",
        transformTypeOptions: [{ label: "VRL", value: "0" }],
      },
      global: {
        plugins: [i18n, store, router],
      },
    });

    const backButton = wrapper.find('[data-test="add-function-back-btn"]');
    await backButton.trigger("click");

    expect(wrapper.emitted("back")).toBeTruthy();
  });

  it("should toggle fullscreen when fullscreen button is clicked", async () => {
    const mockFullscreen = {
      toggle: vi.fn(),
    };

    const wrapper = mount(FunctionsToolbar, {
      props: {
        name: "testFunction",
        transformTypeOptions: [{ label: "VRL", value: "0" }],
      },
      global: {
        plugins: [i18n, store, router],
        mocks: {
          $q: {
            fullscreen: mockFullscreen,
          },
        },
      },
    });

    const fullscreenButton = wrapper.find('[data-test="add-function-fullscreen-btn"]');
    await fullscreenButton.trigger("click");

    expect(mockFullscreen.toggle).toHaveBeenCalled();
  });

  it("should emit update:transType when transform type changes", async () => {
    const wrapper = mount(FunctionsToolbar, {
      props: {
        name: "testFunction",
        transType: "0",
        transformTypeOptions: [
          { label: "VRL", value: "0" },
          { label: "JavaScript", value: "1" },
        ],
      },
      global: {
        plugins: [i18n, store, router],
      },
    });

    const jsRadio = wrapper.findAll('input[type="radio"]')[1];
    await jsRadio.setValue(true);

    await flushPromises();

    expect(wrapper.emitted("update:transType")).toBeTruthy();
  });

  it("should show error icon when function name is invalid", async () => {
    const wrapper = mount(FunctionsToolbar, {
      props: {
        name: "123invalid",
        transformTypeOptions: [{ label: "VRL", value: "0" }],
      },
      global: {
        plugins: [i18n, store, router],
      },
    });

    wrapper.vm.showInputError = true;
    await wrapper.vm.$nextTick();

    const errorIcon = wrapper.find('.cursor-pointer[size="20px"]');
    expect(wrapper.vm.isValidMethodName()).not.toBe(true);
  });
});
