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

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

// Mock functions - using vi.hoisted to make them available in vi.mock
const { mockRouterBack, mockCopyToClipboard } = vi.hoisted(() => ({
  mockRouterBack: vi.fn(),
  mockCopyToClipboard: vi.fn(),
}));

// Mock vue-router
vi.mock("vue-router", () => ({
  useRouter: () => ({
    back: mockRouterBack,
  }),
}));

// Mock clipboard utility used by the component
vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: mockCopyToClipboard,
}));

describe("ErrorHeader Component", () => {
  let wrapper: any;

  const mockError = {
    error_id: "error-abc123",
    type: "TypeError",
    error_message: "Cannot read property 'foo' of undefined",
    error_handling: "unhandled",
    timestamp: "2024-01-01 10:00:00 UTC",
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    wrapper = mount(ErrorHeader, {
      attachTo: "#app",
      props: {
        error: mockError,
      },
      global: {
        plugins: [i18n],
        stubs: {
          "OIcon": {
            template:
              '<i data-test="OIcon" :class="name" @click="$emit(\'click\')"></i>',
            props: ["name", "size"],
            emits: ["click"],
          },
        },
      },
    });

    await flushPromises();
    await wrapper.vm.$nextTick();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  describe("Component Mounting", () => {
    it("should mount successfully", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm).toBeTruthy();
    });

    it("should render main container", () => {
      const container = wrapper.find("div");
      expect(container.exists()).toBe(true);
    });
  });

  describe("Back Button", () => {
    it("should render back button with correct styling", () => {
      // Component uses Tailwind classes (tw: prefix) not Quasar classes
      const backButton = wrapper.find("[data-test='back-button']");
      expect(backButton.exists()).toBe(true);
      expect(backButton.classes()).toContain("tw:flex");
      expect(backButton.classes()).toContain("tw:justify-center");
      expect(backButton.classes()).toContain("tw:items-center");
      expect(backButton.classes()).toContain("tw:mr-3");
      expect(backButton.classes()).toContain("tw:cursor-pointer");
    });

    it("should have correct styling attributes", () => {
      const backButton = wrapper.find("[data-test='back-button']");
      const style = backButton.attributes("style");
      expect(style).toContain("border: 1.5px solid");
      expect(style).toContain("border-radius: 50%");
      expect(style).toContain("width: 22px");
      expect(style).toContain("height: 22px");
    });

    it("should have correct title attribute", () => {
      const backButton = wrapper.find("[data-test='back-button']");
      expect(backButton.attributes("title")).toBe("Go Back");
    });

    it("should render back arrow icon", () => {
      // OIcon stub uses :class="name" — component uses name="arrow-back-ios-new" (kebab-case)
      const backIcon = wrapper.find('[data-test="OIcon"].arrow-back-ios-new');
      expect(backIcon.exists()).toBe(true);
    });

    it("should call router.back() when clicked", async () => {
      const backButton = wrapper.find("[data-test='back-button']");
      await backButton.trigger("click");

      expect(mockRouterBack).toHaveBeenCalledTimes(1);
    });
  });

  describe("Error ID Display", () => {
    it("should display 'Event ID:' label", () => {
      // Component uses tw:font-bold (Tailwind) not text-bold (Quasar)
      const label = wrapper.find(".tw\\:font-bold");
      expect(label.exists()).toBe(true);
      expect(label.text()).toBe("Event ID:");
    });

    it("should display error ID", () => {
      const errorIdElement = wrapper.find("span[title='error-abc123']");
      expect(errorIdElement.exists()).toBe(true);
      expect(errorIdElement.text()).toContain("error-abc123");
    });

    it("should have correct error ID classes", () => {
      // Component uses tw:pl-1 and tw:cursor-pointer (Tailwind) not Quasar classes
      const errorIdElement = wrapper.find("[data-test='error-id']");
      expect(errorIdElement.classes()).toContain("tw:pl-1");
      expect(errorIdElement.classes()).toContain("tw:cursor-pointer");
    });

    it("should render copy icon for error ID", () => {
      // OIcon stub uses :class="name" — component uses name="content-copy" (kebab-case)
      const copyIcon = wrapper.find('[data-test="OIcon"].content-copy');
      expect(copyIcon.exists()).toBe(true);
    });

    it("should copy error ID when copy icon is clicked", async () => {
      const copyIcon = wrapper.find('[data-test="OIcon"].content-copy');
      await copyIcon.trigger("click");

      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        "error-abc123",
        expect.objectContaining({ successMessage: "Copied to clipboard" }),
      );
    });
  });

  describe("Timestamp Display", () => {
    it("should display timestamp", () => {
      // Component uses tw:ml-4 (Tailwind) not q-ml-lg (Quasar)
      const timestamp = wrapper.find(".tw\\:ml-4");
      expect(timestamp.exists()).toBe(true);
      expect(timestamp.text()).toBe("2024-01-01 10:00:00 UTC");
    });

    it("should have correct timestamp styling", () => {
      const timestamp = wrapper.find(".tw\\:ml-4");
      expect(timestamp.classes()).toContain("tw:ml-4");
    });
  });

  describe("Error Type Display", () => {
    it("should display error type", () => {
      const errorType = wrapper.find(".error_type");
      expect(errorType.exists()).toBe(true);
      expect(errorType.text()).toBe("TypeError");
    });

    it("should have correct error type styling", () => {
      // Component uses tw:font-bold (Tailwind) not text-bold (Quasar)
      const errorType = wrapper.find(".error_type");
      expect(errorType.classes()).toContain("error_type");
      expect(errorType.classes()).toContain("tw:font-bold");
    });

    it("should be in correct container", () => {
      // Component uses tw:flex tw:items-center tw:flex-nowrap tw:my-1 (Tailwind) not Quasar classes
      const container = wrapper.find(".tw\\:flex.tw\\:items-center.tw\\:flex-nowrap.tw\\:my-1");
      expect(container.exists()).toBe(true);

      const errorType = container.find(".error_type");
      expect(errorType.exists()).toBe(true);
    });
  });

  describe("Error Message Display", () => {
    it("should display error message", () => {
      const errorMessage = wrapper.find(".error_message");
      expect(errorMessage.exists()).toBe(true);
      expect(errorMessage.text()).toContain(
        "Cannot read property 'foo' of undefined",
      );
    });

    it("should have correct error message styling", () => {
      const errorMessage = wrapper.find(".error_message");
      expect(errorMessage.classes()).toContain("error_message");
      expect(errorMessage.classes()).toContain("tw:pt-1");
      expect(errorMessage.classes()).toContain("tw:flex");
      expect(errorMessage.classes()).toContain("tw:items-center");
    });
  });

  describe("Error Handling Status", () => {
    it("should display unhandled error badge for unhandled errors", () => {
      const unhandledBadge = wrapper.find(".unhandled_error");
      expect(unhandledBadge.exists()).toBe(true);
      expect(unhandledBadge.text()).toBe("unhandled");
    });

    it("should have correct unhandled error styling", () => {
      const unhandledBadge = wrapper.find(".unhandled_error");
      expect(unhandledBadge.classes()).toContain("unhandled_error");
      expect(unhandledBadge.classes()).toContain("text-red-6");
      expect(unhandledBadge.classes()).toContain("tw:px-1");
      expect(unhandledBadge.classes()).toContain("tw:mr-2");
    });

    it("should not display badge for handled errors", async () => {
      await wrapper.setProps({
        error: {
          ...mockError,
          error_handling: "handled",
        },
      });

      const unhandledBadge = wrapper.find(".unhandled_error");
      expect(unhandledBadge.exists()).toBe(false);
    });

    it("should handle missing error_handling property", async () => {
      const errorWithoutHandling = { ...mockError };
      delete errorWithoutHandling.error_handling;

      await wrapper.setProps({
        error: errorWithoutHandling,
      });

      const unhandledBadge = wrapper.find(".unhandled_error");
      expect(unhandledBadge.exists()).toBe(false);
    });
  });

  describe("Layout Structure", () => {
    it("should have correct header layout", () => {
      const headerSection = wrapper.find(".tw\\:pt-2.tw\\:pb-1.tw\\:flex.tw\\:justify-start");
      expect(headerSection.exists()).toBe(true);
    });

    it("should have correct flex layout classes", () => {
      const headerSection = wrapper.find(".tw\\:flex.tw\\:justify-start");
      expect(headerSection.classes()).toContain("tw:flex");
      expect(headerSection.classes()).toContain("tw:justify-start");
      expect(headerSection.classes()).toContain("tw:pt-2");
      expect(headerSection.classes()).toContain("tw:pb-1");
    });

    it("should maintain proper element spacing", () => {
      const backButton = wrapper.find("[data-test='back-button']");
      const errorId = wrapper.find("span[title]");
      const timestamp = wrapper.find(".tw\\:ml-4");

      expect(backButton.classes()).toContain("tw:mr-3");
      expect(errorId.classes()).toContain("tw:pl-1");
      expect(timestamp.classes()).toContain("tw:ml-4");
    });
  });

  describe("Props Validation", () => {
    it("should handle different error structures", async () => {
      const customError = {
        error_id: "custom-error-456",
        type: "ReferenceError",
        error_message: "Variable is not defined",
        error_handling: "handled",
        timestamp: "2024-02-01 15:30:00 UTC",
      };

      await wrapper.setProps({ error: customError });

      expect(wrapper.find("span[title='custom-error-456']").exists()).toBe(
        true,
      );
      expect(wrapper.find(".error_type").text()).toBe("ReferenceError");
      expect(wrapper.find(".error_message").text()).toContain(
        "Variable is not defined",
      );
      expect(wrapper.find(".tw\\:ml-4").text()).toBe("2024-02-01 15:30:00 UTC");
    });
  });

  describe("Copy Functionality", () => {
    it("should have copyErrorId method", () => {
      expect(typeof wrapper.vm.copyErrorId).toBe("function");
    });

    it("should call copyErrorId with correct ID", async () => {
      const copyIcon = wrapper.find('[data-test="OIcon"].content-copy');
      await copyIcon.trigger("click");

      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        "error-abc123",
        expect.objectContaining({ successMessage: "Copied to clipboard" }),
      );
    });

    it("should handle copy operation for different error IDs", async () => {
      await wrapper.setProps({
        error: {
          ...mockError,
          error_id: "different-error-id",
        },
      });

      const copyIcon = wrapper.find('[data-test="OIcon"].content-copy');
      await copyIcon.trigger("click");

      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        "different-error-id",
        expect.objectContaining({ successMessage: "Copied to clipboard" }),
      );
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty error ID", async () => {
      await wrapper.setProps({
        error: {
          ...mockError,
          error_id: "",
        },
      });

      const errorIdElement = wrapper.find("span[title='']");
      expect(errorIdElement.exists()).toBe(true);
      expect(errorIdElement.text()).toContain("");
    });

    it("should handle null error properties", async () => {
      await wrapper.setProps({
        error: {
          error_id: null,
          type: null,
          error_message: null,
          error_handling: null,
          timestamp: null,
        },
      });

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".error_type").text()).toBe("");
      expect(wrapper.find(".tw\\:ml-4").text()).toBe("");
    });

    it("should handle undefined error properties", async () => {
      await wrapper.setProps({
        error: {
          error_id: undefined,
          type: undefined,
          error_message: undefined,
          error_handling: undefined,
          timestamp: undefined,
        },
      });

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Responsive Design", () => {
    it("should have responsive flex layout", () => {
      const headerSection = wrapper.find(".tw\\:flex.tw\\:justify-start");
      expect(headerSection.classes()).toContain("tw:flex");
      expect(headerSection.classes()).toContain("tw:justify-start");
    });

    it("should handle long error IDs gracefully", async () => {
      const longErrorId =
        "very-long-error-id-that-might-cause-layout-issues-12345678901234567890";

      await wrapper.setProps({
        error: {
          ...mockError,
          error_id: longErrorId,
        },
      });

      const errorIdElement = wrapper.find(`span[title='${longErrorId}']`);
      expect(errorIdElement.exists()).toBe(true);
    });
  });

  describe("Accessibility", () => {
    it("should provide title attribute for error ID", () => {
      const errorIdElement = wrapper.find("[data-test='error-id']");
      expect(errorIdElement.attributes("title")).toBe("error-abc123");
    });

    it("should provide title for back button", () => {
      const backButton = wrapper.find("[data-test='back-button']");
      expect(backButton.attributes("title")).toBe("Go Back");
    });
  });

  describe("Component Lifecycle", () => {
    it("should handle rapid prop changes", async () => {
      const errors = [
        {
          error_id: "error1",
          type: "TypeError",
          error_message: "Error 1",
          timestamp: "Time 1",
        },
        {
          error_id: "error2",
          type: "ReferenceError",
          error_message: "Error 2",
          timestamp: "Time 2",
        },
        {
          error_id: "error3",
          type: "SyntaxError",
          error_message: "Error 3",
          timestamp: "Time 3",
        },
      ];

      for (const error of errors) {
        await wrapper.setProps({ error });
        expect(wrapper.find(".error_type").text()).toBe(error.type);
        expect(wrapper.find(".tw\\:ml-4").text()).toBe(error.timestamp);
      }
    });
  });
});
