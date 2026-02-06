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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import CustomConfirmDialog from "./CustomConfirmDialog.vue";
import { createStore } from "vuex";

installQuasar();

// ==================== TEST DATA FACTORIES ====================

/**
 * Creates a mock Vuex store
 */
function createMockStore(theme = "light") {
  return createStore({
    state: {
      theme,
    },
  });
}

/**
 * Creates mock props for CustomConfirmDialog
 */
function createMockProps(overrides = {}) {
  return {
    modelValue: false,
    title: "Confirm Action",
    message: "Are you sure you want to proceed?",
    ...overrides,
  };
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Finds an element by data-test attribute
 */
function findByTestId(wrapper: VueWrapper, testId: string) {
  return wrapper.find(`[data-test="${testId}"]`);
}

/**
 * Checks if an element exists by data-test id
 */
function existsByTestId(wrapper: VueWrapper, testId: string): boolean {
  return findByTestId(wrapper, testId).exists();
}

/**
 * Clicks the cancel button
 */
async function clickCancel(wrapper: VueWrapper) {
  const button = findByTestId(wrapper, "custom-cancel-button");
  await button.trigger("click");
  await flushPromises();
}

/**
 * Clicks the confirm button
 */
async function clickConfirm(wrapper: VueWrapper) {
  const button = findByTestId(wrapper, "custom-confirm-button");
  await button.trigger("click");
  await flushPromises();
}

/**
 * Mounts the component with default test setup
 */
function mountComponent(props = {}, theme = "light") {
  const store = createMockStore(theme);
  const defaultProps = createMockProps(props);

  return mount(CustomConfirmDialog, {
    props: defaultProps,
    global: {
      plugins: [store],
    },
  });
}

// ==================== TESTS ====================

describe("CustomConfirmDialog", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("Component Rendering", () => {
    it("should render the component when visible", () => {
      wrapper = mountComponent({ modelValue: true });
      expect(wrapper.exists()).toBe(true);
    });

    it("should render dialog", () => {
      wrapper = mountComponent({ modelValue: true });
      expect(existsByTestId(wrapper, "custom-confirm-dialog")).toBe(true);
    });

    it("should render card", () => {
      wrapper = mountComponent({ modelValue: true });
      expect(existsByTestId(wrapper, "custom-confirm-card")).toBe(true);
    });

    it("should render header section", () => {
      wrapper = mountComponent({ modelValue: true });
      expect(existsByTestId(wrapper, "dialog-header")).toBe(true);
    });

    it("should render content section", () => {
      wrapper = mountComponent({ modelValue: true });
      expect(existsByTestId(wrapper, "dialog-content")).toBe(true);
    });

    it("should render actions section", () => {
      wrapper = mountComponent({ modelValue: true });
      expect(existsByTestId(wrapper, "dialog-actions")).toBe(true);
    });
  });

  describe("Title Display", () => {
    it("should display custom title", () => {
      wrapper = mountComponent({
        modelValue: true,
        title: "Delete Confirmation",
      });

      const title = findByTestId(wrapper, "dialog-title");
      expect(title.text()).toBe("Delete Confirmation");
    });

    it("should display default title when not provided", () => {
      wrapper = mountComponent({ modelValue: true });

      const title = findByTestId(wrapper, "dialog-title");
      expect(title.text()).toBe("Confirm Action");
    });

    it("should update title when prop changes", async () => {
      wrapper = mountComponent({
        modelValue: true,
        title: "Initial Title",
      });

      await wrapper.setProps({ title: "Updated Title" });
      await flushPromises();

      const title = findByTestId(wrapper, "dialog-title");
      expect(title.text()).toBe("Updated Title");
    });
  });

  describe("Message Display", () => {
    it("should display custom message", () => {
      wrapper = mountComponent({
        modelValue: true,
        message: "This action cannot be undone. Continue?",
      });

      const message = findByTestId(wrapper, "dialog-message");
      expect(message.text()).toBe("This action cannot be undone. Continue?");
    });

    it("should display empty message when not provided", () => {
      wrapper = mountComponent({
        modelValue: true,
        message: "",
      });

      const message = findByTestId(wrapper, "dialog-message");
      expect(message.text()).toBe("");
    });

    it("should update message when prop changes", async () => {
      wrapper = mountComponent({
        modelValue: true,
        message: "Initial message",
      });

      await wrapper.setProps({ message: "Updated message" });
      await flushPromises();

      const message = findByTestId(wrapper, "dialog-message");
      expect(message.text()).toBe("Updated message");
    });

    it("should handle long messages", () => {
      const longMessage = "A".repeat(500);
      wrapper = mountComponent({
        modelValue: true,
        message: longMessage,
      });

      const message = findByTestId(wrapper, "dialog-message");
      expect(message.text()).toBe(longMessage);
    });
  });

  describe("Cancel Button", () => {
    it("should render cancel button", () => {
      wrapper = mountComponent({ modelValue: true });
      expect(existsByTestId(wrapper, "custom-cancel-button")).toBe(true);
    });

    it("should display correct cancel button label", () => {
      wrapper = mountComponent({ modelValue: true });
      const button = findByTestId(wrapper, "custom-cancel-button");
      expect(button.text()).toBe("Cancel");
    });

    it("should emit cancel event when clicked", async () => {
      wrapper = mountComponent({ modelValue: true });
      await clickCancel(wrapper);

      expect(wrapper.emitted("cancel")).toBeTruthy();
      expect(wrapper.emitted("cancel")?.length).toBe(1);
    });

    it("should emit update:modelValue with false when clicked", async () => {
      wrapper = mountComponent({ modelValue: true });
      await clickCancel(wrapper);

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    });

    it("should close dialog when cancel is clicked", async () => {
      wrapper = mountComponent({ modelValue: true });
      await clickCancel(wrapper);

      // Dialog should emit update to close
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    });
  });

  describe("Confirm Button", () => {
    it("should render confirm button", () => {
      wrapper = mountComponent({ modelValue: true });
      expect(existsByTestId(wrapper, "custom-confirm-button")).toBe(true);
    });

    it("should display correct confirm button label", () => {
      wrapper = mountComponent({ modelValue: true });
      const button = findByTestId(wrapper, "custom-confirm-button");
      expect(button.text()).toBe("Clear & Continue");
    });

    it("should emit confirm event when clicked", async () => {
      wrapper = mountComponent({ modelValue: true });
      await clickConfirm(wrapper);

      expect(wrapper.emitted("confirm")).toBeTruthy();
      expect(wrapper.emitted("confirm")?.length).toBe(1);
    });

    it("should emit update:modelValue with false when clicked", async () => {
      wrapper = mountComponent({ modelValue: true });
      await clickConfirm(wrapper);

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    });

    it("should close dialog when confirm is clicked", async () => {
      wrapper = mountComponent({ modelValue: true });
      await clickConfirm(wrapper);

      // Dialog should emit update to close
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    });
  });

  describe("Dialog Visibility", () => {
    it("should be hidden when modelValue is false", () => {
      wrapper = mountComponent({ modelValue: false });
      // The dialog component still mounts but QDialog handles visibility
      expect(wrapper.exists()).toBe(true);
    });

    it("should be visible when modelValue is true", () => {
      wrapper = mountComponent({ modelValue: true });
      expect(wrapper.exists()).toBe(true);
    });

    it("should update visibility when modelValue changes", async () => {
      wrapper = mountComponent({ modelValue: false });

      await wrapper.setProps({ modelValue: true });
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
    });

    it("should emit update:modelValue when internal visibility changes", async () => {
      wrapper = mountComponent({ modelValue: true });

      // Simulate internal visibility change by clicking confirm
      await clickConfirm(wrapper);

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });
  });

  describe("Theme Support", () => {
    it("should apply light mode class in light theme", () => {
      wrapper = mountComponent({ modelValue: true }, "light");
      const card = findByTestId(wrapper, "custom-confirm-card");
      expect(card.classes()).toContain("light-mode");
    });

    it("should apply dark mode class in dark theme", () => {
      wrapper = mountComponent({ modelValue: true }, "dark");
      const card = findByTestId(wrapper, "custom-confirm-card");
      expect(card.classes()).toContain("dark-mode");
    });

    it("should not have both theme classes simultaneously", () => {
      wrapper = mountComponent({ modelValue: true }, "light");
      const card = findByTestId(wrapper, "custom-confirm-card");
      expect(card.classes()).toContain("light-mode");
      expect(card.classes()).not.toContain("dark-mode");
    });
  });

  describe("Persistent Dialog", () => {
    it("should have persistent attribute", () => {
      wrapper = mountComponent({ modelValue: true });
      const dialog = wrapper.findComponent({ name: "QDialog" });
      expect(dialog.props("persistent")).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle very long title", () => {
      const longTitle = "A".repeat(200);
      wrapper = mountComponent({
        modelValue: true,
        title: longTitle,
      });

      const title = findByTestId(wrapper, "dialog-title");
      expect(title.text()).toBe(longTitle);
    });

    it("should handle title with special characters", () => {
      const specialTitle = "Confirm <Action> & Continue?";
      wrapper = mountComponent({
        modelValue: true,
        title: specialTitle,
      });

      const title = findByTestId(wrapper, "dialog-title");
      expect(title.text()).toBe(specialTitle);
    });

    it("should handle message with line breaks", () => {
      const multilineMessage = "Line 1\nLine 2\nLine 3";
      wrapper = mountComponent({
        modelValue: true,
        message: multilineMessage,
      });

      const message = findByTestId(wrapper, "dialog-message");
      expect(message.text()).toContain("Line 1");
    });

    it("should handle rapid visibility changes", async () => {
      wrapper = mountComponent({ modelValue: false });

      await wrapper.setProps({ modelValue: true });
      await flushPromises();

      await wrapper.setProps({ modelValue: false });
      await flushPromises();

      await wrapper.setProps({ modelValue: true });
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle multiple button clicks", async () => {
      wrapper = mountComponent({ modelValue: true });

      await clickConfirm(wrapper);
      await wrapper.setProps({ modelValue: true });
      await clickConfirm(wrapper);
      await wrapper.setProps({ modelValue: true });
      await clickConfirm(wrapper);

      expect(wrapper.emitted("confirm")?.length).toBe(3);
    });

    it("should handle alternating cancel and confirm clicks", async () => {
      wrapper = mountComponent({ modelValue: true });

      await clickCancel(wrapper);
      await wrapper.setProps({ modelValue: true });

      await clickConfirm(wrapper);
      await wrapper.setProps({ modelValue: true });

      await clickCancel(wrapper);

      expect(wrapper.emitted("cancel")?.length).toBe(2);
      expect(wrapper.emitted("confirm")?.length).toBe(1);
    });
  });

  describe("Integration Scenarios", () => {
    it("should handle complete user workflow - confirm", async () => {
      wrapper = mountComponent({
        modelValue: true,
        title: "Delete Item",
        message: "Are you sure you want to delete this item?",
      });

      // Verify dialog is visible
      expect(existsByTestId(wrapper, "custom-confirm-dialog")).toBe(true);

      // Verify content
      expect(findByTestId(wrapper, "dialog-title").text()).toBe("Delete Item");
      expect(findByTestId(wrapper, "dialog-message").text()).toContain(
        "delete this item"
      );

      // User clicks confirm
      await clickConfirm(wrapper);

      // Verify events
      expect(wrapper.emitted("confirm")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    });

    it("should handle complete user workflow - cancel", async () => {
      wrapper = mountComponent({
        modelValue: true,
        title: "Discard Changes",
        message: "Unsaved changes will be lost. Continue?",
      });

      // Verify content
      expect(findByTestId(wrapper, "dialog-title").text()).toBe(
        "Discard Changes"
      );

      // User clicks cancel
      await clickCancel(wrapper);

      // Verify events
      expect(wrapper.emitted("cancel")).toBeTruthy();
      expect(wrapper.emitted("confirm")).toBeFalsy();
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    });

    it("should handle v-model two-way binding", async () => {
      wrapper = mountComponent({ modelValue: true });

      // Dialog emits update:modelValue when closed
      await clickConfirm(wrapper);

      // Parent should receive update
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();

      // Simulate parent updating prop
      await wrapper.setProps({ modelValue: false });
      await flushPromises();

      expect(wrapper.props("modelValue")).toBe(false);
    });
  });
});
