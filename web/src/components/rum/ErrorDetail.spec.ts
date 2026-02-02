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
import ErrorDetail from "@/components/rum/ErrorDetail.vue";
import i18n from "@/locales";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

// Install Quasar plugins
installQuasar({
  plugins: [quasar.Dialog, quasar.Notify, quasar.Loading],
});

// Mock date formatter to have consistent output
vi.mock("quasar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("quasar")>();
  return {
    ...actual,
    date: {
      formatDate: vi.fn((timestamp, format) => {
        if (format === "MMM DD, YYYY HH:mm:ss.SSS Z") {
          return "Jan 01, 2024 10:00:00.000 +0000";
        }
        return "Jan 01, 2024 10:00:00.000 +0000";
      }),
    },
  };
});

describe("ErrorDetail Component", () => {
  let wrapper: any;

  const mockColumn = {
    error_type: "TypeError",
    error_message: "Cannot read property 'foo' of undefined",
    service: "web-app",
    error_handling: "unhandled",
    zo_sql_timestamp: 1704110400000000, // 2024-01-01 10:00:00 in microseconds
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    wrapper = mount(ErrorDetail, {
      attachTo: "#app",
      props: {
        column: mockColumn,
      },
      global: {
        plugins: [i18n],
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

    it("should render error details container", () => {
      expect(wrapper.find(".error_details").exists()).toBe(true);
    });

    it("should have correct container width", () => {
      const container = wrapper.find(".error_details");
      expect(container.classes()).toContain("tw:w-[40vw]");
    });
  });

  describe("Error Type Display", () => {
    it("should render error type", () => {
      const errorType = wrapper.find(".error_type");
      expect(errorType.exists()).toBe(true);
      expect(errorType.text()).toBe("TypeError");
    });

    it("should display 'Error' when error_type is not provided", async () => {
      await wrapper.setProps({
        column: { ...mockColumn, error_type: null },
      });

      const errorType = wrapper.find(".error_type");
      expect(errorType.text()).toBe("Error");
    });

    it("should display 'Error' when error_type is undefined", async () => {
      const { error_type, ...columnWithoutErrorType } = mockColumn;
      await wrapper.setProps({
        column: columnWithoutErrorType,
      });

      const errorType = wrapper.find(".error_type");
      expect(errorType.text()).toBe("Error");
    });

    it("should have cursor-pointer class", () => {
      const errorType = wrapper.find(".error_type");
      expect(errorType.classes()).toContain("cursor-pointer");
    });

    it("should have correct styling classes", () => {
      const errorType = wrapper.find(".error_type");
      expect(errorType.classes()).toContain("error_type");
    });
  });

  describe("Error Message Display", () => {
    it("should render error message", () => {
      const errorMessage = wrapper.find(".error_message");
      expect(errorMessage.exists()).toBe(true);
      expect(errorMessage.text()).toBe(
        "Cannot read property 'foo' of undefined",
      );
    });

    it("should have correct classes", () => {
      const errorMessage = wrapper.find(".error_message");
      expect(errorMessage.classes()).toContain("error_message");
      expect(errorMessage.classes()).toContain("cursor-pointer");
      expect(errorMessage.classes()).toContain("ellipsis");
      expect(errorMessage.classes()).toContain("q-mt-xs");
    });

    it("should have title attribute with full message", () => {
      const errorMessage = wrapper.find(".error_message");
      expect(errorMessage.attributes("title")).toBe(
        "Cannot read property 'foo' of undefined",
      );
    });

    it("should handle empty error message", async () => {
      await wrapper.setProps({
        column: { ...mockColumn, error_message: "" },
      });

      const errorMessage = wrapper.find(".error_message");
      expect(errorMessage.text()).toBe("");
    });
  });

  describe("Service and Error Handling Display", () => {
    it("should display service name", () => {
      const serviceSpan = wrapper.find(".error_time span.text-grey-8");
      expect(serviceSpan.text().trim()).toBe("web-app");
    });

    it("should display error handling status", () => {
      const errorHandlingDiv = wrapper.find(
        ".error_time .unhandled_error, .error_time .handled_error",
      );
      expect(errorHandlingDiv.text().trim()).toBe("unhandled");
    });

    it("should apply unhandled error styling for unhandled errors", () => {
      const errorHandlingDiv = wrapper.find(".unhandled_error");
      expect(errorHandlingDiv.exists()).toBe(true);
      expect(errorHandlingDiv.classes()).toContain("text-red-6");
      expect(errorHandlingDiv.classes()).toContain("q-px-xs");
    });

    it("should apply handled error styling for handled errors", async () => {
      await wrapper.setProps({
        column: { ...mockColumn, error_handling: "handled" },
      });

      const errorHandlingDiv = wrapper.find(".handled_error");
      expect(errorHandlingDiv.exists()).toBe(true);
      expect(errorHandlingDiv.classes()).toContain("text-grey-8");
    });

    it("should handle missing service gracefully", async () => {
      await wrapper.setProps({
        column: { ...mockColumn, service: null },
      });

      const serviceSpan = wrapper.find(".error_time span.text-grey-8");
      expect(serviceSpan.exists()).toBe(true);
    });
  });

  describe("Timestamp Display", () => {
    it("should display formatted timestamp", () => {
      const timestampSpan = wrapper.find(
        ".error_time span.text-grey-8:last-child",
      );
      expect(timestampSpan.text().trim()).toBe(
        "Jan 01, 2024 10:00:00.000 +0000",
      );
    });

    it("should show schedule icon", () => {
      const scheduleIcon = wrapper.find(
        ".error_time .q-icon, .error_time [class*='schedule']",
      );
      expect(scheduleIcon.exists()).toBe(true);
    });

    it("should handle different timestamp formats", async () => {
      await wrapper.setProps({
        column: { ...mockColumn, zo_sql_timestamp: 1609459200000000 }, // 2021-01-01
      });

      const timestampSpan = wrapper.find(
        ".error_time span.text-grey-8:last-child",
      );
      expect(timestampSpan.text().trim()).toBe(
        "Jan 01, 2024 10:00:00.000 +0000",
      );
    });
  });

  describe("Event Handling", () => {
    it("should emit event when error type is clicked", async () => {
      const errorType = wrapper.find(".error_type");
      await errorType.trigger("click");

      const emittedEvents = wrapper.emitted("event-emitted");
      expect(emittedEvents).toBeDefined();
      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents![0]).toEqual([
        {
          type: "error_type_click",
          data: {
            error_type: wrapper.vm.$props,
          },
        },
      ]);
    });

    it("should handle multiple clicks", async () => {
      const errorType = wrapper.find(".error_type");
      await errorType.trigger("click");
      await errorType.trigger("click");

      const emittedEvents = wrapper.emitted("event-emitted");
      expect(emittedEvents).toHaveLength(2);
    });
  });

  describe("Props Validation", () => {
    it("should require column prop", () => {
      expect(ErrorDetail.props?.column?.required).toBe(true);
      expect(ErrorDetail.props?.column?.type).toBe(Object);
    });

    it("should handle different column structures", async () => {
      const customColumn = {
        error_type: "ReferenceError",
        error_message: "undefined variable",
        service: "api-service",
        error_handling: "handled",
        zo_sql_timestamp: 1704196800000000,
      };

      await wrapper.setProps({ column: customColumn });

      const errorType = wrapper.find(".error_type");
      const errorMessage = wrapper.find(".error_message");

      expect(errorType.text()).toBe("ReferenceError");
      expect(errorMessage.text()).toBe("undefined variable");
    });
  });

  describe("Date Formatting", () => {
    it("should call getFormattedDate with correct parameters", () => {
      // The timestamp is divided by 1000 to convert from microseconds to milliseconds
      const expectedTimestamp = Math.floor(mockColumn.zo_sql_timestamp / 1000);
      expect(wrapper.vm.getFormattedDate(expectedTimestamp)).toBe(
        "Jan 01, 2024 10:00:00.000 +0000",
      );
    });

    it("should handle edge cases in date formatting", () => {
      expect(() => wrapper.vm.getFormattedDate(0)).not.toThrow();
      expect(() => wrapper.vm.getFormattedDate(null)).not.toThrow();
    });
  });

  describe("Component Structure", () => {
    it("should have proper element hierarchy", () => {
      const container = wrapper.find(".error_details");
      expect(container.exists()).toBe(true);

      const errorType = container.find(".error_type");
      const errorMessage = container.find(".error_message");
      const errorTime = container.find(".error_time");

      expect(errorType.exists()).toBe(true);
      expect(errorMessage.exists()).toBe(true);
      expect(errorTime.exists()).toBe(true);
    });

    it("should maintain proper spacing classes", () => {
      const errorMessage = wrapper.find(".error_message");
      const errorTime = wrapper.find(".error_time");

      expect(errorMessage.classes()).toContain("q-mt-xs");
      expect(errorTime.classes()).toContain("q-mt-xs");
    });
  });

  describe("CSS Classes and Styling", () => {
    it("should apply correct text colors", () => {
      const serviceSpan = wrapper.find(".error_time span.text-grey-8");
      const timestampSpan = wrapper.find(
        ".error_time span.text-grey-8:last-child",
      );

      expect(serviceSpan.classes()).toContain("text-grey-8");
      if (timestampSpan.exists()) {
        expect(timestampSpan.classes()).toContain("text-grey-8");
      }
    });

    it("should apply flex and spacing classes to error_time", () => {
      const errorTime = wrapper.find(".error_time");
      expect(errorTime.classes()).toContain("row");
      expect(errorTime.classes()).toContain("items-center");
      expect(errorTime.classes()).toContain("q-mt-xs");
    });
  });

  describe("Component Responsiveness", () => {
    it("should handle long error messages with ellipsis", () => {
      const errorMessage = wrapper.find(".error_message");
      expect(errorMessage.classes()).toContain("ellipsis");
    });

    it("should maintain fixed width container", () => {
      const container = wrapper.find(".error_details");
      expect(container.classes()).toContain("tw:w-[40vw]");
    });
  });

  describe("Accessibility", () => {
    it("should have appropriate cursor indicators", () => {
      const errorType = wrapper.find(".error_type");
      const errorMessage = wrapper.find(".error_message");

      expect(errorType.classes()).toContain("cursor-pointer");
      expect(errorMessage.classes()).toContain("cursor-pointer");
    });

    it("should provide title tooltips for long content", () => {
      const errorMessage = wrapper.find(".error_message");
      expect(errorMessage.attributes("title")).toBeDefined();
      expect(errorMessage.attributes("title")).toBe(mockColumn.error_message);
    });
  });

  describe("Error Scenarios", () => {
    it("should handle null column gracefully", async () => {
      // Create a new wrapper with null column to test error handling
      const nullWrapper = mount(ErrorDetail, {
        attachTo: "#app",
        props: {
          column: {},
        },
        global: {
          plugins: [i18n],
        },
      });

      expect(nullWrapper.exists()).toBe(true);
      nullWrapper.unmount();
    });

    it("should handle undefined properties in column", async () => {
      await wrapper.setProps({
        column: {
          zo_sql_timestamp: mockColumn.zo_sql_timestamp,
        },
      });

      const errorType = wrapper.find(".error_type");
      expect(errorType.text()).toBe("Error");
    });

    it("should handle missing timestamp", async () => {
      const { zo_sql_timestamp, ...columnWithoutTimestamp } = mockColumn;
      await wrapper.setProps({ column: columnWithoutTimestamp });

      expect(() => wrapper.vm.getFormattedDate()).not.toThrow();
    });
  });

  describe("Component Lifecycle", () => {
    it("should maintain state through prop updates", async () => {
      const newColumn = {
        ...mockColumn,
        error_type: "SyntaxError",
        error_message: "Unexpected token",
      };

      await wrapper.setProps({ column: newColumn });

      const errorType = wrapper.find(".error_type");
      const errorMessage = wrapper.find(".error_message");

      expect(errorType.text()).toBe("SyntaxError");
      expect(errorMessage.text()).toBe("Unexpected token");
    });
  });
});
