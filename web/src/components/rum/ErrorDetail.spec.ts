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
import ErrorDetail from "@/components/rum/ErrorDetail.vue";
import i18n from "@/locales";

vi.mock("@/utils/date", () => ({
  formatDate: vi.fn((_timestamp: number, _format: string) => {
    return "Jan 01, 2024 10:00:00.000 +0000";
  }),
}));

describe("ErrorDetail", () => {
  let wrapper: any;

  const mockColumn = {
    error_type: "TypeError",
    error_message: "Cannot read property 'foo' of undefined",
    service: "web-app",
    error_handling: "unhandled",
    zo_sql_timestamp: 1704110400000000,
  };

  function mountComponent(column: Record<string, any> = mockColumn) {
    return mount(ErrorDetail, {
      props: { column },
      global: { plugins: [i18n] },
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    wrapper = mountComponent();
    await flushPromises();
    await wrapper.vm.$nextTick();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // COMPONENT MOUNTING
  // ==========================================================================

  describe("Component Mounting", () => {
    it("mounts successfully with required column prop", () => {
      // Arrange & Assert
      expect(wrapper.exists()).toBe(true);
    });
  });

  // ==========================================================================
  // ERROR TYPE DISPLAY
  // ==========================================================================

  describe("Error Type Display", () => {
    it("displays the error_type text when column has error_type", () => {
      // Arrange & Assert
      expect(wrapper.text()).toContain("TypeError");
    });

    it("displays Error fallback text when error_type is null", async () => {
      // Arrange & Act
      await wrapper.setProps({ column: { ...mockColumn, error_type: null } });

      // Assert
      expect(wrapper.text()).toContain("Error");
    });

    it("displays Error fallback text when column has no error_type property", async () => {
      // Arrange
      const { error_type, ...columnWithoutErrorType } = mockColumn;

      // Act
      await wrapper.setProps({ column: columnWithoutErrorType });

      // Assert
      expect(wrapper.text()).toContain("Error");
    });
  });

  // ==========================================================================
  // ERROR MESSAGE DISPLAY
  // ==========================================================================

  describe("Error Message Display", () => {
    it("displays the error_message text when column has error_message", () => {
      // Arrange & Assert
      expect(wrapper.text()).toContain("Cannot read property 'foo' of undefined");
    });

    it("provides a title attribute equal to the error_message text", () => {
      // Arrange & Assert
      const messageEl = wrapper.find('[title="Cannot read property \'foo\' of undefined"]');
      expect(messageEl.exists()).toBe(true);
    });

    it("renders empty message text when error_message is empty string", async () => {
      // Arrange & Act
      await wrapper.setProps({ column: { ...mockColumn, error_message: "" } });

      // Assert — message div still exists but has no text for the error message
      const titleEl = wrapper.find('[title=""]');
      expect(titleEl.exists()).toBe(true);
    });
  });

  // ==========================================================================
  // SERVICE AND ERROR HANDLING DISPLAY
  // ==========================================================================

  describe("Service and Error Handling Display", () => {
    it("displays service name text when column has service", () => {
      // Arrange & Assert
      expect(wrapper.text()).toContain("web-app");
    });

    it("displays error_handling status text when column has error_handling", () => {
      // Arrange & Assert
      expect(wrapper.text()).toContain("unhandled");
    });

    it("displays handled text when error_handling is handled", async () => {
      // Arrange & Act
      await wrapper.setProps({ column: { ...mockColumn, error_handling: "handled" } });

      // Assert
      expect(wrapper.text()).toContain("handled");
    });

    it("renders without throwing when service is null", async () => {
      // Arrange & Act
      await wrapper.setProps({ column: { ...mockColumn, service: null } });

      // Assert
      expect(wrapper.exists()).toBe(true);
    });
  });

  // ==========================================================================
  // TIMESTAMP DISPLAY
  // ==========================================================================

  describe("Timestamp Display", () => {
    it("displays the formatted timestamp returned by formatDate", () => {
      // Arrange & Assert
      expect(wrapper.text()).toContain("Jan 01, 2024 10:00:00.000 +0000");
    });

    it("renders schedule icon when timestamp is present", () => {
      // Arrange & Assert
      expect(wrapper.findComponent({ name: "OIcon" }).exists()).toBe(true);
    });
  });

  // ==========================================================================
  // EVENT HANDLING
  // ==========================================================================

  describe("Event Handling", () => {
    it("emits event-emitted with error_type_click type when error type element is clicked", async () => {
      // Arrange — find the clickable error type element (has cursor-pointer title attribute)
      const errorTypeEl = wrapper.find('[class*="error_type"]');

      // Act
      await errorTypeEl.trigger("click");

      // Assert
      const emitted = wrapper.emitted("event-emitted");
      expect(emitted).toBeDefined();
      expect(emitted).toHaveLength(1);
      expect(emitted![0][0]).toMatchObject({
        type: "error_type_click",
        data: { error_type: expect.anything() },
      });
    });

    it("emits event-emitted twice when error type element is clicked twice", async () => {
      // Arrange
      const errorTypeEl = wrapper.find('[class*="error_type"]');

      // Act
      await errorTypeEl.trigger("click");
      await errorTypeEl.trigger("click");

      // Assert
      const emitted = wrapper.emitted("event-emitted");
      expect(emitted).toHaveLength(2);
    });
  });

  // ==========================================================================
  // PROPS VALIDATION
  // ==========================================================================

  describe("Props Validation", () => {
    it("has column prop defined as required Object", () => {
      // Arrange & Assert
      expect(ErrorDetail.props?.column?.required).toBe(true);
      expect(ErrorDetail.props?.column?.type).toBe(Object);
    });

    it("updates displayed error_type and error_message when column prop changes", async () => {
      // Arrange
      const customColumn = {
        error_type: "ReferenceError",
        error_message: "undefined variable",
        service: "api-service",
        error_handling: "handled",
        zo_sql_timestamp: 1704196800000000,
      };

      // Act
      await wrapper.setProps({ column: customColumn });

      // Assert
      expect(wrapper.text()).toContain("ReferenceError");
      expect(wrapper.text()).toContain("undefined variable");
    });
  });

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe("Edge Cases", () => {
    it("mounts successfully when column prop has no properties", () => {
      // Arrange
      const emptyWrapper = mountComponent({});

      // Assert
      expect(emptyWrapper.exists()).toBe(true);
      emptyWrapper.unmount();
    });

    it("displays Error fallback text when column has no error_type", async () => {
      // Arrange & Act
      await wrapper.setProps({ column: { zo_sql_timestamp: mockColumn.zo_sql_timestamp } });

      // Assert
      expect(wrapper.text()).toContain("Error");
    });

    it("updates to new error type and message when column prop is updated", async () => {
      // Arrange
      const newColumn = {
        ...mockColumn,
        error_type: "SyntaxError",
        error_message: "Unexpected token",
      };

      // Act
      await wrapper.setProps({ column: newColumn });

      // Assert
      expect(wrapper.text()).toContain("SyntaxError");
      expect(wrapper.text()).toContain("Unexpected token");
    });

    it("renders without throwing when timestamp is missing from column", async () => {
      // Arrange
      const { zo_sql_timestamp, ...columnWithoutTimestamp } = mockColumn;

      // Act + Assert — component should not throw even with undefined timestamp
      await expect(
        wrapper.setProps({ column: columnWithoutTimestamp }),
      ).resolves.not.toThrow();
      expect(wrapper.exists()).toBe(true);
    });

    it("renders without throwing when zo_sql_timestamp is 0", async () => {
      // Arrange
      await wrapper.setProps({ column: { ...mockColumn, zo_sql_timestamp: 0 } });

      // Assert
      expect(wrapper.exists()).toBe(true);
    });
  });
});
