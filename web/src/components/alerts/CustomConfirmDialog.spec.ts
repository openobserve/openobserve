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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import CustomConfirmDialog from "./CustomConfirmDialog.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createStore } from "vuex";

installQuasar();

describe("CustomConfirmDialog", () => {
  let store: any;
  let wrapper: VueWrapper<any> | null = null;

  beforeEach(() => {
    store = createStore({
      state: {
        theme: "light",
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
  });

  it("should render the component", () => {
    wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    expect(wrapper.exists()).toBe(true);
  });

  it("should render dialog when modelValue is true", async () => {
    wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    await nextTick();
    await flushPromises();

    const dialog = document.querySelector('[data-test="custom-confirm-dialog"]');
    expect(dialog).toBeTruthy();
  });

  it("should display custom title", async () => {
    wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
        title: "Delete Item?",
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    await nextTick();
    await flushPromises();

    const title = document.querySelector('[data-test="dialog-title"]');
    expect(title?.textContent).toBe("Delete Item?");
  });

  it("should display default title when not provided", async () => {
    wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    await nextTick();
    await flushPromises();

    const title = document.querySelector('[data-test="dialog-title"]');
    expect(title?.textContent).toBe("Confirm Action");
  });

  it("should display custom message", async () => {
    wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
        message: "Are you sure you want to proceed?",
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    await nextTick();
    await flushPromises();

    const message = document.querySelector('[data-test="dialog-message"]');
    expect(message?.textContent).toBe("Are you sure you want to proceed?");
  });

  it("should render cancel button", async () => {
    wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    await nextTick();
    await flushPromises();

    const cancelButton = document.querySelector('[data-test="custom-cancel-button"]');
    expect(cancelButton).toBeTruthy();
    expect(cancelButton?.textContent?.trim()).toBe("Cancel");
  });

  it("should render confirm button", async () => {
    wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    await nextTick();
    await flushPromises();

    const confirmButton = document.querySelector('[data-test="custom-confirm-button"]');
    expect(confirmButton).toBeTruthy();
    expect(confirmButton?.textContent?.trim()).toBe("Clear & Continue");
  });

  it("should emit cancel event when cancel button is clicked", async () => {
    wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    await nextTick();
    await flushPromises();

    const cancelButton = document.querySelector('[data-test="custom-cancel-button"]') as HTMLElement;
    cancelButton?.click();
    await nextTick();

    expect(wrapper.emitted("cancel")).toBeTruthy();
  });

  it("should emit confirm event when confirm button is clicked", async () => {
    wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    await nextTick();
    await flushPromises();

    const confirmButton = document.querySelector('[data-test="custom-confirm-button"]') as HTMLElement;
    confirmButton?.click();
    await nextTick();

    expect(wrapper.emitted("confirm")).toBeTruthy();
  });

  it("should emit update:modelValue with false when cancel is clicked", async () => {
    wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    await nextTick();
    await flushPromises();

    const cancelButton = document.querySelector('[data-test="custom-cancel-button"]') as HTMLElement;
    cancelButton?.click();
    await nextTick();

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
  });

  it("should emit update:modelValue with false when confirm is clicked", async () => {
    wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    await nextTick();
    await flushPromises();

    const confirmButton = document.querySelector('[data-test="custom-confirm-button"]') as HTMLElement;
    confirmButton?.click();
    await nextTick();

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
  });

  it("should apply dark mode class when theme is dark", async () => {
    const darkStore = createStore({
      state: {
        theme: "dark",
      },
    });

    wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [darkStore],
      },
      attachTo: document.body,
    });

    await nextTick();
    await flushPromises();

    const card = document.querySelector('[data-test="custom-confirm-card"]');
    expect(card?.classList.contains("dark-mode")).toBe(true);
  });

  it("should apply light mode class when theme is light", async () => {
    wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    await nextTick();
    await flushPromises();

    const card = document.querySelector('[data-test="custom-confirm-card"]');
    expect(card?.classList.contains("light-mode")).toBe(true);
  });

  it("should have persistent dialog attribute", async () => {
    wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    await nextTick();
    await flushPromises();

    // The persistent prop prevents dialog from closing on backdrop click
    // We verify the dialog component receives this prop in the template
    const dialogComponent = wrapper.findComponent({ name: "QDialog" });
    expect(dialogComponent.exists()).toBe(true);
    expect(dialogComponent.props("persistent")).toBe(true);
  });

  it("should update isVisible when modelValue prop changes", async () => {
    wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: false,
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    await wrapper.setProps({ modelValue: true });
    await nextTick();
    expect(wrapper.vm.isVisible).toBe(true);

    await wrapper.setProps({ modelValue: false });
    await nextTick();
    expect(wrapper.vm.isVisible).toBe(false);
  });

  it("should render dialog header section", async () => {
    wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    await nextTick();
    await flushPromises();

    const header = document.querySelector('[data-test="dialog-header"]');
    expect(header).toBeTruthy();
  });

  it("should render dialog content section", async () => {
    wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    await nextTick();
    await flushPromises();

    const content = document.querySelector('[data-test="dialog-content"]');
    expect(content).toBeTruthy();
  });

  it("should render dialog actions section", async () => {
    wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
      attachTo: document.body,
    });

    await nextTick();
    await flushPromises();

    const actions = document.querySelector('[data-test="dialog-actions"]');
    expect(actions).toBeTruthy();
  });
});
