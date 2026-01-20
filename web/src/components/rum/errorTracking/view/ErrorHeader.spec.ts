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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import ErrorHeader from "@/components/rum/errorTracking/view/ErrorHeader.vue";
import i18n from "@/locales";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

// Install Quasar plugins
installQuasar({
  plugins: [quasar.Dialog, quasar.Notify, quasar.Loading],
});

// Mock functions - using vi.hoisted to make them available in vi.mock
const { mockRouterBack, mockNotify, mockCopyToClipboard } = vi.hoisted(() => ({
  mockRouterBack: vi.fn(),
  mockNotify: vi.fn(),
  mockCopyToClipboard: vi.fn(),
}));

// Mock vue-router
vi.mock("vue-router", () => ({
  useRouter: () => ({
    back: mockRouterBack,
  }),
}));

vi.mock("quasar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("quasar")>();
  return {
    ...actual,
    useQuasar: () => ({
      notify: mockNotify,
    }),
    copyToClipboard: mockCopyToClipboard,
  };
});

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
          "q-icon": {
            template:
              '<i data-test="q-icon" :class="name" @click="$emit(\'click\')"></i>',
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
      const backButton = wrapper.find("[data-test='back-button']");
      expect(backButton.exists()).toBe(true);
      expect(backButton.classes()).toContain("flex");
      expect(backButton.classes()).toContain("justify-center");
      expect(backButton.classes()).toContain("items-center");
      expect(backButton.classes()).toContain("q-mr-md");
      expect(backButton.classes()).toContain("cursor-pointer");
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
      const backIcon = wrapper.find('[data-test="q-icon"].arrow_back_ios_new');
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
      const label = wrapper.find(".text-bold");
      expect(label.exists()).toBe(true);
      expect(label.text()).toBe("Event ID:");
    });

    it("should display error ID", () => {
      const errorIdElement = wrapper.find("span[title='error-abc123']");
      expect(errorIdElement.exists()).toBe(true);
      expect(errorIdElement.text()).toContain("error-abc123");
    });

    it("should have correct error ID classes", () => {
      const errorIdElement = wrapper.find("[data-test='error-id']");
      expect(errorIdElement.classes()).toContain("q-pl-xs");
      expect(errorIdElement.classes()).toContain("cursor-pointer");
    });

    it("should render copy icon for error ID", () => {
      const copyIcon = wrapper.find('[data-test="q-icon"].content_copy');
      expect(copyIcon.exists()).toBe(true);
    });

    it("should copy error ID when copy icon is clicked", async () => {
      const copyIcon = wrapper.find('[data-test="q-icon"].content_copy');
      await copyIcon.trigger("click");

      expect(mockCopyToClipboard).toHaveBeenCalledWith("error-abc123");
      expect(mockNotify).toHaveBeenCalledWith({
        type: "positive",
        message: "Copied to clipboard",
        timeout: 1500,
      });
    });
  });

  describe("Timestamp Display", () => {
    it("should display timestamp", () => {
      const timestamp = wrapper.find(".q-ml-lg");
      expect(timestamp.exists()).toBe(true);
      expect(timestamp.text()).toBe("2024-01-01 10:00:00 UTC");
    });

    it("should have correct timestamp styling", () => {
      const timestamp = wrapper.find(".q-ml-lg");
      expect(timestamp.classes()).toContain("q-ml-lg");
    });
  });

  describe("Error Type Display", () => {
    it("should display error type", () => {
      const errorType = wrapper.find(".error_type");
      expect(errorType.exists()).toBe(true);
      expect(errorType.text()).toBe("TypeError");
    });

    it("should have correct error type styling", () => {
      const errorType = wrapper.find(".error_type");
      expect(errorType.classes()).toContain("error_type");
      expect(errorType.classes()).toContain("text-bold");
    });

    it("should be in correct container", () => {
      const container = wrapper.find(".row.items-center.no-wrap.q-my-xs");
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
      expect(errorMessage.classes()).toContain("q-pt-xs");
      expect(errorMessage.classes()).toContain("row");
      expect(errorMessage.classes()).toContain("items-center");
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
      expect(unhandledBadge.classes()).toContain("q-px-xs");
      expect(unhandledBadge.classes()).toContain("q-mr-sm");
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
      const headerSection = wrapper.find(".q-pt-sm.q-pb-xs.flex.justify-start");
      expect(headerSection.exists()).toBe(true);
    });

    it("should have correct flex layout classes", () => {
      const headerSection = wrapper.find(".flex.justify-start");
      expect(headerSection.classes()).toContain("flex");
      expect(headerSection.classes()).toContain("justify-start");
      expect(headerSection.classes()).toContain("q-pt-sm");
      expect(headerSection.classes()).toContain("q-pb-xs");
    });

    it("should maintain proper element spacing", () => {
      const backButton = wrapper.find("[data-test='back-button']");
      const label = wrapper.find(".text-bold");
      const errorId = wrapper.find("span[title]");
      const timestamp = wrapper.find(".q-ml-lg");

      expect(backButton.classes()).toContain("q-mr-md");
      expect(errorId.classes()).toContain("q-pl-xs");
      expect(timestamp.classes()).toContain("q-ml-lg");
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
      expect(wrapper.find(".q-ml-lg").text()).toBe("2024-02-01 15:30:00 UTC");
    });
  });

  describe("Copy Functionality", () => {
    it("should have copyErrorId method", () => {
      expect(typeof wrapper.vm.copyErrorId).toBe("function");
    });

    it("should call copyErrorId with correct ID", async () => {
      const copyErrorIdSpy = vi.spyOn(wrapper.vm, "copyErrorId");

      const copyIcon = wrapper.find('[data-test="q-icon"].content_copy');
      await copyIcon.trigger("click");

      expect(copyErrorIdSpy).toHaveBeenCalledWith("error-abc123");
    });

    it("should handle copy operation for different error IDs", async () => {
      await wrapper.setProps({
        error: {
          ...mockError,
          error_id: "different-error-id",
        },
      });

      const copyIcon = wrapper.find('[data-test="q-icon"].content_copy');
      await copyIcon.trigger("click");

      expect(mockCopyToClipboard).toHaveBeenCalledWith("different-error-id");
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
      expect(wrapper.find(".q-ml-lg").text()).toBe("");
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
      const headerSection = wrapper.find(".flex.justify-start");
      expect(headerSection.classes()).toContain("flex");
      expect(headerSection.classes()).toContain("justify-start");
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
        expect(wrapper.find(".q-ml-lg").text()).toBe(error.timestamp);
      }
    });
  });
});
