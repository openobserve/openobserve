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

import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import CustomConfirmDialog from "./CustomConfirmDialog.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createStore } from "vuex";

installQuasar();

describe("CustomConfirmDialog", () => {
  let store: any;

  beforeEach(() => {
    store = createStore({
      state: {
        theme: "light",
      },
    });
  });

  it("should render the component", () => {
    const wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.exists()).toBe(true);
  });

  it("should render dialog when modelValue is true", () => {
    const wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
    });

    const dialog = wrapper.find('[data-test="custom-confirm-dialog"]');
    expect(dialog.exists()).toBe(true);
  });

  it("should display custom title", () => {
    const wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
        title: "Delete Item?",
      },
      global: {
        plugins: [store],
      },
    });

    const title = wrapper.find('[data-test="dialog-title"]');
    expect(title.text()).toBe("Delete Item?");
  });

  it("should display default title when not provided", () => {
    const wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
    });

    const title = wrapper.find('[data-test="dialog-title"]');
    expect(title.text()).toBe("Confirm Action");
  });

  it("should display custom message", () => {
    const wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
        message: "Are you sure you want to proceed?",
      },
      global: {
        plugins: [store],
      },
    });

    const message = wrapper.find('[data-test="dialog-message"]');
    expect(message.text()).toBe("Are you sure you want to proceed?");
  });

  it("should render cancel button", () => {
    const wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
    });

    const cancelButton = wrapper.find('[data-test="custom-cancel-button"]');
    expect(cancelButton.exists()).toBe(true);
    expect(cancelButton.text()).toBe("Cancel");
  });

  it("should render confirm button", () => {
    const wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
    });

    const confirmButton = wrapper.find('[data-test="custom-confirm-button"]');
    expect(confirmButton.exists()).toBe(true);
    expect(confirmButton.text()).toBe("Clear & Continue");
  });

  it("should emit cancel event when cancel button is clicked", async () => {
    const wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
    });

    const cancelButton = wrapper.find('[data-test="custom-cancel-button"]');
    await cancelButton.trigger("click");

    expect(wrapper.emitted("cancel")).toBeTruthy();
  });

  it("should emit confirm event when confirm button is clicked", async () => {
    const wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
    });

    const confirmButton = wrapper.find('[data-test="custom-confirm-button"]');
    await confirmButton.trigger("click");

    expect(wrapper.emitted("confirm")).toBeTruthy();
  });

  it("should emit update:modelValue with false when cancel is clicked", async () => {
    const wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
    });

    const cancelButton = wrapper.find('[data-test="custom-cancel-button"]');
    await cancelButton.trigger("click");

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
  });

  it("should emit update:modelValue with false when confirm is clicked", async () => {
    const wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
    });

    const confirmButton = wrapper.find('[data-test="custom-confirm-button"]');
    await confirmButton.trigger("click");

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
  });

  it("should apply dark mode class when theme is dark", () => {
    const darkStore = createStore({
      state: {
        theme: "dark",
      },
    });

    const wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [darkStore],
      },
    });

    const card = wrapper.find('[data-test="custom-confirm-card"]');
    expect(card.classes()).toContain("dark-mode");
  });

  it("should apply light mode class when theme is light", () => {
    const wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
    });

    const card = wrapper.find('[data-test="custom-confirm-card"]');
    expect(card.classes()).toContain("light-mode");
  });

  it("should have persistent dialog attribute", () => {
    const wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
    });

    const dialog = wrapper.find('[data-test="custom-confirm-dialog"]');
    expect(dialog.attributes("persistent")).toBeDefined();
  });

  it("should update isVisible when modelValue prop changes", async () => {
    const wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: false,
      },
      global: {
        plugins: [store],
      },
    });

    await wrapper.setProps({ modelValue: true });
    expect(wrapper.vm.isVisible).toBe(true);

    await wrapper.setProps({ modelValue: false });
    expect(wrapper.vm.isVisible).toBe(false);
  });

  it("should render dialog header section", () => {
    const wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
    });

    const header = wrapper.find('[data-test="dialog-header"]');
    expect(header.exists()).toBe(true);
  });

  it("should render dialog content section", () => {
    const wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
    });

    const content = wrapper.find('[data-test="dialog-content"]');
    expect(content.exists()).toBe(true);
  });

  it("should render dialog actions section", () => {
    const wrapper = mount(CustomConfirmDialog, {
      props: {
        modelValue: true,
      },
      global: {
        plugins: [store],
      },
    });

    const actions = wrapper.find('[data-test="dialog-actions"]');
    expect(actions.exists()).toBe(true);
  });
});
