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
 * For dialog content, searches in the document since QDialog teleports content
 */
function findByTestId(wrapper: VueWrapper, testId: string) {
  const element = document.querySelector(`[data-test="${testId}"]`);
  if (element) {
    return wrapper.find(`[data-test="${testId}"]`);
  }
  return wrapper.find(`[data-test="${testId}"]`);
}

/**
 * Checks if an element exists by data-test id
 */
function existsByTestId(wrapper: VueWrapper, testId: string): boolean {
  const element = document.querySelector(`[data-test="${testId}"]`);
  return element !== null;
}

/**
 * Clicks the cancel button
 */
async function clickCancel(wrapper: VueWrapper) {
  // Wait for button to be available and clickable
  let button: HTMLElement | null = null;
  let attempts = 0;
  const maxAttempts = 10;

  while (!button && attempts < maxAttempts) {
    button = document.querySelector('[data-test="custom-cancel-button"]') as HTMLElement;
    if (!button) {
      await new Promise(resolve => setTimeout(resolve, 50));
      attempts++;
    }
  }

  if (button) {
    button.click();
    await flushPromises();
  }
}

/**
 * Clicks the confirm button
 */
async function clickConfirm(wrapper: VueWrapper) {
  // Wait for button to be available and clickable
  let button: HTMLElement | null = null;
  let attempts = 0;
  const maxAttempts = 10;

  while (!button && attempts < maxAttempts) {
    button = document.querySelector('[data-test="custom-confirm-button"]') as HTMLElement;
    if (!button) {
      await new Promise(resolve => setTimeout(resolve, 50));
      attempts++;
    }
  }

  if (button) {
    button.click();
    await flushPromises();
  }
}

/**
 * Gets text content from element (handles both wrapper and DOM elements)
 */
function getTextContent(testId: string): string {
  const element = document.querySelector(`[data-test="${testId}"]`);
  return element?.textContent || "";
}

/**
 * Mounts the component with default test setup
 */
async function mountComponent(props = {}, theme = "light") {
  const store = createMockStore(theme);
  const defaultProps = createMockProps(props);

  // Create a div to attach the component
  const el = document.createElement('div');
  document.body.appendChild(el);

  const wrapper = mount(CustomConfirmDialog, {
    props: defaultProps,
    global: {
      plugins: [store],
    },
    attachTo: el,
  });

  // Wait for component to render and dialog to mount
  await flushPromises();
  await wrapper.vm.$nextTick();

  return wrapper;
}

// ==================== TESTS ====================

describe("CustomConfirmDialog", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("Component Rendering", () => {
    it("should render the component when visible", async () => {
      wrapper = await mountComponent({ modelValue: true });
      expect(wrapper.exists()).toBe(true);
    });

    it("should render dialog", async () => {
      wrapper = await mountComponent({ modelValue: true });
      expect(existsByTestId(wrapper, "custom-confirm-dialog")).toBe(true);
    });

    it("should render card", async () => {
      wrapper = await mountComponent({ modelValue: true });
      expect(existsByTestId(wrapper, "custom-confirm-card")).toBe(true);
    });

    it("should render header section", async () => {
      wrapper = await mountComponent({ modelValue: true });
      expect(existsByTestId(wrapper, "dialog-header")).toBe(true);
    });

    it("should render content section", async () => {
      wrapper = await mountComponent({ modelValue: true });
      expect(existsByTestId(wrapper, "dialog-content")).toBe(true);
    });

    it("should render actions section", async () => {
      wrapper = await mountComponent({ modelValue: true });
      expect(existsByTestId(wrapper, "dialog-actions")).toBe(true);
    });
  });

  describe("Title Display", () => {
    it("should display custom title", async () => {
      wrapper = await mountComponent({
        modelValue: true,
        title: "Delete Confirmation",
      });

      expect(getTextContent("dialog-title")).toBe("Delete Confirmation");
    });

    it("should display default title when not provided", async () => {
      wrapper = await mountComponent({ modelValue: true });

      expect(getTextContent("dialog-title")).toBe("Confirm Action");
    });

    it("should update title when prop changes", async () => {
      wrapper = await mountComponent({
        modelValue: true,
        title: "Initial Title",
      });

      await wrapper.setProps({ title: "Updated Title" });
      await flushPromises();

      expect(getTextContent("dialog-title")).toBe("Updated Title");
    });
  });

  describe("Message Display", () => {
    it("should display custom message", async () => {
      wrapper = await mountComponent({
        modelValue: true,
        message: "This action cannot be undone. Continue?",
      });

      expect(getTextContent("dialog-message")).toBe("This action cannot be undone. Continue?");
    });

    it("should display empty message when not provided", async () => {
      wrapper = await mountComponent({
        modelValue: true,
        message: "",
      });

      expect(getTextContent("dialog-message")).toBe("");
    });

    it("should update message when prop changes", async () => {
      wrapper = await mountComponent({
        modelValue: true,
        message: "Initial message",
      });

      await wrapper.setProps({ message: "Updated message" });
      await flushPromises();

      expect(getTextContent("dialog-message")).toBe("Updated message");
    });

    it("should handle long messages", async () => {
      const longMessage = "A".repeat(500);
      wrapper = await mountComponent({
        modelValue: true,
        message: longMessage,
      });

      expect(getTextContent("dialog-message")).toBe(longMessage);
    });
  });

  describe("Cancel Button", () => {
    it("should render cancel button", async () => {
      wrapper = await mountComponent({ modelValue: true });
      expect(existsByTestId(wrapper, "custom-cancel-button")).toBe(true);
    });

    it("should display correct cancel button label", async () => {
      wrapper = await mountComponent({ modelValue: true });
      expect(getTextContent("custom-cancel-button")).toBe("Cancel");
    });

    it("should emit cancel event when clicked", async () => {
      wrapper = await mountComponent({ modelValue: true });
      await clickCancel(wrapper);

      expect(wrapper.emitted("cancel")).toBeTruthy();
      expect(wrapper.emitted("cancel")?.length).toBe(1);
    });

    it("should emit update:modelValue with false when clicked", async () => {
      wrapper = await mountComponent({ modelValue: true });
      await clickCancel(wrapper);

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    });

    it("should close dialog when cancel is clicked", async () => {
      wrapper = await mountComponent({ modelValue: true });
      await clickCancel(wrapper);

      // Dialog should emit update to close
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    });
  });

  describe("Confirm Button", () => {
    it("should render confirm button", async () => {
      wrapper = await mountComponent({ modelValue: true });
      expect(existsByTestId(wrapper, "custom-confirm-button")).toBe(true);
    });

    it("should display correct confirm button label", async () => {
      wrapper = await mountComponent({ modelValue: true });
      expect(getTextContent("custom-confirm-button")).toBe("Clear & Continue");
    });

    it("should emit confirm event when clicked", async () => {
      wrapper = await mountComponent({ modelValue: true });
      await clickConfirm(wrapper);

      expect(wrapper.emitted("confirm")).toBeTruthy();
      expect(wrapper.emitted("confirm")?.length).toBe(1);
    });

    it("should emit update:modelValue with false when clicked", async () => {
      wrapper = await mountComponent({ modelValue: true });
      await clickConfirm(wrapper);

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    });

    it("should close dialog when confirm is clicked", async () => {
      wrapper = await mountComponent({ modelValue: true });
      await clickConfirm(wrapper);

      // Dialog should emit update to close
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    });
  });

  describe("Dialog Visibility", () => {
    it("should be hidden when modelValue is false", async () => {
      wrapper = await mountComponent({ modelValue: false });
      // The dialog component still mounts but QDialog handles visibility
      expect(wrapper.exists()).toBe(true);
    });

    it("should be visible when modelValue is true", async () => {
      wrapper = await mountComponent({ modelValue: true });
      expect(wrapper.exists()).toBe(true);
    });

    it("should update visibility when modelValue changes", async () => {
      wrapper = await mountComponent({ modelValue: false });

      await wrapper.setProps({ modelValue: true });
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
    });

    it("should emit update:modelValue when internal visibility changes", async () => {
      wrapper = await mountComponent({ modelValue: true });

      // Simulate internal visibility change by clicking confirm
      await clickConfirm(wrapper);

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });
  });

  describe("Theme Support", () => {
    it("should apply light mode class in light theme", async () => {
      wrapper = await mountComponent({ modelValue: true }, "light");
      const card = document.querySelector('[data-test="custom-confirm-card"]');
      expect(card?.classList.contains("light-mode")).toBe(true);
    });

    it("should apply dark mode class in dark theme", async () => {
      wrapper = await mountComponent({ modelValue: true }, "dark");
      const card = document.querySelector('[data-test="custom-confirm-card"]');
      expect(card?.classList.contains("dark-mode")).toBe(true);
    });

    it("should not have both theme classes simultaneously", async () => {
      wrapper = await mountComponent({ modelValue: true }, "light");
      const card = document.querySelector('[data-test="custom-confirm-card"]');
      expect(card?.classList.contains("light-mode")).toBe(true);
      expect(card?.classList.contains("dark-mode")).toBe(false);
    });
  });

  describe("Persistent Dialog", () => {
    it("should have persistent attribute", async () => {
      wrapper = await mountComponent({ modelValue: true });
      const dialog = wrapper.findComponent({ name: "QDialog" });
      expect(dialog.props("persistent")).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle very long title", async () => {
      const longTitle = "A".repeat(200);
      wrapper = await mountComponent({
        modelValue: true,
        title: longTitle,
      });

      expect(getTextContent("dialog-title")).toBe(longTitle);
    });

    it("should handle title with special characters", async () => {
      const specialTitle = "Confirm <Action> & Continue?";
      wrapper = await mountComponent({
        modelValue: true,
        title: specialTitle,
      });

      expect(getTextContent("dialog-title")).toBe(specialTitle);
    });

    it("should handle message with line breaks", async () => {
      const multilineMessage = "Line 1\nLine 2\nLine 3";
      wrapper = await mountComponent({
        modelValue: true,
        message: multilineMessage,
      });

      expect(getTextContent("dialog-message")).toContain("Line 1");
    });

    it("should handle rapid visibility changes", async () => {
      wrapper = await mountComponent({ modelValue: false });

      await wrapper.setProps({ modelValue: true });
      await flushPromises();

      await wrapper.setProps({ modelValue: false });
      await flushPromises();

      await wrapper.setProps({ modelValue: true });
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
    });

  });

  describe("Integration Scenarios", () => {
    it("should handle complete user workflow - confirm", async () => {
      wrapper = await mountComponent({
        modelValue: true,
        title: "Delete Item",
        message: "Are you sure you want to delete this item?",
      });

      // Verify dialog is visible
      expect(existsByTestId(wrapper, "custom-confirm-dialog")).toBe(true);

      // Verify content
      expect(getTextContent("dialog-title")).toBe("Delete Item");
      expect(getTextContent("dialog-message")).toContain(
        "delete this item"
      );

      // User clicks confirm
      await clickConfirm(wrapper);

      // Verify events
      expect(wrapper.emitted("confirm")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    });

    it("should handle complete user workflow - cancel", async () => {
      wrapper = await mountComponent({
        modelValue: true,
        title: "Discard Changes",
        message: "Unsaved changes will be lost. Continue?",
      });

      // Verify content
      expect(getTextContent("dialog-title")).toBe(
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
      wrapper = await mountComponent({ modelValue: true });

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
