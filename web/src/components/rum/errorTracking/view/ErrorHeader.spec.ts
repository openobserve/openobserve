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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import ErrorHeader from "@/components/rum/errorTracking/view/ErrorHeader.vue";
import i18n from "@/locales";

// Attach a mount target once for the whole file
const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

// Hoist mock helpers so vi.mock factories can reference them
const { mockRouterBack, mockCopyToClipboard } = vi.hoisted(() => ({
  mockRouterBack: vi.fn(),
  mockCopyToClipboard: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ back: mockRouterBack }),
}));

vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: mockCopyToClipboard,
}));

describe("ErrorHeader", () => {
  let wrapper: ReturnType<typeof mount>;

  const mockError = {
    error_id: "error-abc123",
    type: "TypeError",
    error_message: "Cannot read property 'foo' of undefined",
    error_handling: "unhandled",
    timestamp: "2024-01-01 10:00:00 UTC",
  };

  const mountComponent = (error = mockError) =>
    mount(ErrorHeader, {
      attachTo: "#app",
      props: { error },
      global: {
        plugins: [i18n],
        stubs: {
          OIcon: {
            template: '<i data-test="OIcon" :class="name" @click="$emit(\'click\')"></i>',
            props: ["name", "size"],
            emits: ["click"],
          },
        },
      },
    });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.restoreAllMocks();
  });

  describe("back button", () => {
    it("renders the back button element", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      // Assert
      expect(wrapper.find('[data-test="back-button"]').exists()).toBe(true);
    });

    it("has a Back title attribute on the back button", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      // Assert — OPageHeader's back button uses the standard "Back" label.
      expect(wrapper.find('[data-test="back-button"]').attributes("title")).toBe("Back");
    });

    it("calls router.back() when the back button is clicked", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      // Act
      await wrapper.find('[data-test="back-button"]').trigger("click");

      // Assert
      expect(mockRouterBack).toHaveBeenCalledTimes(1);
    });
  });

  describe("error ID display", () => {
    it("renders the error ID element", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      // Assert
      expect(wrapper.find('[data-test="error-id"]').exists()).toBe(true);
    });

    it("shows the error ID text", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("error-abc123");
    });

    it("has a title attribute matching the error ID", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      // Assert
      expect(wrapper.find('[data-test="error-id"]').attributes("title")).toBe("error-abc123");
    });

    it("shows the Event ID label", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("Event ID");
    });
  });

  describe("copy icon", () => {
    it("renders a copy icon", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      // Assert
      expect(wrapper.find('[data-test="OIcon"].content-copy').exists()).toBe(true);
    });

    it("calls copyToClipboard with the error ID when the copy icon is clicked", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      // Act
      await wrapper.find('[data-test="OIcon"].content-copy').trigger("click");

      // Assert
      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        "error-abc123",
        expect.objectContaining({ successMessage: "Copied to clipboard" }),
      );
    });

    it("copies the updated error ID after prop change", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();
      await wrapper.setProps({ error: { ...mockError, error_id: "different-id" } });

      // Act
      await wrapper.find('[data-test="OIcon"].content-copy').trigger("click");

      // Assert
      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        "different-id",
        expect.objectContaining({ successMessage: "Copied to clipboard" }),
      );
    });
  });

  describe("timestamp display", () => {
    it("shows the timestamp text", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("2024-01-01 10:00:00 UTC");
    });
  });

  describe("error type display", () => {
    it("shows the error type text", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      // Assert
      expect(wrapper.find('[data-test="error-header-error-type"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="error-header-error-type"]').text()).toBe("TypeError");
    });
  });

  describe("error message display", () => {
    it("shows the error message text", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("Cannot read property 'foo' of undefined");
    });
  });

  describe("unhandled error badge", () => {
    it("shows the unhandled badge when error_handling is unhandled", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      // Assert
      expect(wrapper.find('[data-test="error-header-unhandled-badge"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="error-header-unhandled-badge"]').text()).toBe("unhandled");
    });

    it("does not show the unhandled badge when error_handling is handled", async () => {
      // Arrange
      wrapper = mountComponent({ ...mockError, error_handling: "handled" });
      await flushPromises();

      // Assert
      expect(wrapper.find('[data-test="error-header-unhandled-badge"]').exists()).toBe(false);
    });

    it("does not show the unhandled badge when error_handling is absent", async () => {
      // Arrange
      const errorWithoutHandling = { ...mockError };
      delete (errorWithoutHandling as any).error_handling;
      wrapper = mountComponent(errorWithoutHandling as any);
      await flushPromises();

      // Assert
      expect(wrapper.find('[data-test="error-header-unhandled-badge"]').exists()).toBe(false);
    });
  });

  describe("prop updates", () => {
    it("reflects new error data when the error prop is changed", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      // Act
      await wrapper.setProps({
        error: {
          error_id: "custom-error-456",
          type: "ReferenceError",
          error_message: "Variable is not defined",
          error_handling: "handled",
          timestamp: "2024-02-01 15:30:00 UTC",
        },
      });

      // Assert
      expect(wrapper.find('[data-test="error-id"]').attributes("title")).toBe("custom-error-456");
      expect(wrapper.find('[data-test="error-header-error-type"]').text()).toBe("ReferenceError");
      expect(wrapper.text()).toContain("Variable is not defined");
      expect(wrapper.text()).toContain("2024-02-01 15:30:00 UTC");
    });

    it("updates error type correctly across multiple prop changes", async () => {
      // Arrange
      wrapper = mountComponent();
      await flushPromises();

      const errors = [
        { ...mockError, error_id: "error1", type: "TypeError", timestamp: "Time 1" },
        { ...mockError, error_id: "error2", type: "ReferenceError", timestamp: "Time 2" },
        { ...mockError, error_id: "error3", type: "SyntaxError", timestamp: "Time 3" },
      ];

      // Act & Assert
      for (const error of errors) {
        await wrapper.setProps({ error });
        expect(wrapper.find('[data-test="error-header-error-type"]').text()).toBe(error.type);
        expect(wrapper.text()).toContain(error.timestamp);
      }
    });
  });

  describe("edge cases", () => {
    it("renders without crash when error properties are null", async () => {
      // Arrange
      wrapper = mountComponent({
        error_id: null,
        type: null,
        error_message: null,
        error_handling: null,
        timestamp: null,
      } as any);
      await flushPromises();

      // Assert
      expect(wrapper.exists()).toBe(true);
    });

    it("renders without crash when error properties are undefined", async () => {
      // Arrange
      wrapper = mountComponent({
        error_id: undefined,
        type: undefined,
        error_message: undefined,
        error_handling: undefined,
        timestamp: undefined,
      } as any);
      await flushPromises();

      // Assert
      expect(wrapper.exists()).toBe(true);
    });

    it("handles a very long error ID without crashing", async () => {
      // Arrange
      const longId = "very-long-error-id-that-might-cause-layout-issues-12345678901234567890";
      wrapper = mountComponent({ ...mockError, error_id: longId });
      await flushPromises();

      // Assert
      expect(wrapper.find('[data-test="error-id"]').attributes("title")).toBe(longId);
    });
  });
});
