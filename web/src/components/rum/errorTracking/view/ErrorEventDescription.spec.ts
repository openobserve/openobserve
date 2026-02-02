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
import ErrorEventDescription from "@/components/rum/errorTracking/view/ErrorEventDescription.vue";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

// Install Quasar plugins
installQuasar({
  plugins: [quasar.Dialog, quasar.Notify, quasar.Loading],
});

describe("ErrorEventDescription Component", () => {
  let wrapper: any;

  const mockErrorColumn = {
    type: "error",
    error_message: "Cannot read property 'foo' of undefined",
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    wrapper = mount(ErrorEventDescription, {
      attachTo: "#app",
      props: {
        column: mockErrorColumn,
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

    it("should render description container", () => {
      expect(wrapper.find(".description").exists()).toBe(true);
    });

    it("should have correct container classes", () => {
      const container = wrapper.find(".description");
      expect(container.classes()).toContain("description");
    });
  });

  describe("Error Type Description", () => {
    it("should display error message for error type", () => {
      const description = wrapper.find(".description");
      expect(description.text()).toBe(
        "Cannot read property 'foo' of undefined",
      );
    });

    it("should display error message with correct font size", () => {
      const span = wrapper.find(".description span");
      expect(span.classes()).toContain("tw:text-[0.875rem]");
    });

    it("should handle different error messages", async () => {
      await wrapper.setProps({
        column: {
          type: "error",
          error_message: "TypeError: undefined is not a function",
        },
      });

      const description = wrapper.find(".description");
      expect(description.text()).toBe("TypeError: undefined is not a function");
    });

    it("should handle empty error message", async () => {
      await wrapper.setProps({
        column: {
          type: "error",
          error_message: "",
        },
      });

      const description = wrapper.find(".description");
      expect(description.text()).toBe("");
    });
  });

  describe("Resource Type Description", () => {
    it("should display resource URL for resource type", async () => {
      await wrapper.setProps({
        column: {
          type: "resource",
          resource_url: "https://api.example.com/data",
        },
      });

      const description = wrapper.find(".description");
      expect(description.text()).toBe("https://api.example.com/data");
    });

    it("should display XHR resource details", async () => {
      await wrapper.setProps({
        column: {
          type: "resource",
          resource_type: "xhr",
          resource_method: "GET",
          resource_url: "https://api.example.com/users",
          resource_status_code: 200,
        },
      });

      const description = wrapper.find(".description");
      expect(description.text()).toContain("GET");
      expect(description.text()).toContain("https://api.example.com/users");
      expect(description.text()).toContain("[ 200 ]");
    });

    it("should render resource URL as clickable link for XHR", async () => {
      await wrapper.setProps({
        column: {
          type: "resource",
          resource_type: "xhr",
          resource_method: "POST",
          resource_url: "https://api.example.com/submit",
          resource_status_code: 201,
        },
      });

      const link = wrapper.find("a.resource-url");
      expect(link.exists()).toBe(true);
      expect(link.attributes("href")).toBe("https://api.example.com/submit");
      expect(link.attributes("target")).toBe("_blank");
      expect(link.classes()).toContain("text-primary");
    });

    it("should display method with correct styling", async () => {
      await wrapper.setProps({
        column: {
          type: "resource",
          resource_type: "xhr",
          resource_method: "DELETE",
          resource_url: "https://api.example.com/delete",
          resource_status_code: 204,
        },
      });

      const method = wrapper.find(".text-bold");
      expect(method.exists()).toBe(true);
      expect(method.text()).toBe("DELETE");
      expect(method.classes()).toContain("q-pr-sm");
      expect(method.classes()).toContain("tw:text-[0.75rem]");
    });
  });

  describe("View Type Description", () => {
    it("should display view URL for regular view", async () => {
      await wrapper.setProps({
        column: {
          type: "view",
          view_url: "/dashboard",
        },
      });

      const description = wrapper.find(".description");
      expect(description.text()).toBe("/dashboard");
    });

    it("should display navigation details for route change", async () => {
      await wrapper.setProps({
        column: {
          type: "view",
          view_loading_type: "route_change",
          view_referrer: "/home",
          view_url: "/profile",
        },
      });

      const navigation = wrapper.find(".navigation");
      expect(navigation.exists()).toBe(true);
      expect(navigation.text()).toContain("from");
      expect(navigation.text()).toContain("/home");
      expect(navigation.text()).toContain("to");
      expect(navigation.text()).toContain("/profile");
    });

    it("should style navigation block correctly", async () => {
      await wrapper.setProps({
        column: {
          type: "view",
          view_loading_type: "route_change",
          view_referrer: "/login",
          view_url: "/dashboard",
        },
      });

      const navigation = wrapper.find(".navigation");
      expect(navigation.exists()).toBe(true);
      expect(navigation.element.tagName).toBe("PRE");
      expect(navigation.classes()).toContain("navigation");
      expect(navigation.classes()).toContain("q-pa-sm");
    });

    it("should highlight from/to keywords", async () => {
      await wrapper.setProps({
        column: {
          type: "view",
          view_loading_type: "route_change",
          view_referrer: "/old-page",
          view_url: "/new-page",
        },
      });

      const primarySpans = wrapper.findAll(".text-primary");
      expect(primarySpans).toHaveLength(2);
      expect(primarySpans[0].text()).toBe("from");
      expect(primarySpans[1].text()).toBe("to");
    });
  });

  describe("Action Type Description", () => {
    it("should display action target text and selector", async () => {
      await wrapper.setProps({
        column: {
          type: "action",
          _oo_action_target_text: "Submit Button",
          _oo_action_target_selector: "#submit-btn",
        },
      });

      const description = wrapper.find(".description");
      expect(description.text()).toBe("Submit Button : #submit-btn");
    });

    it("should handle missing action text", async () => {
      await wrapper.setProps({
        column: {
          type: "action",
          _oo_action_target_text: "",
          _oo_action_target_selector: ".login-form button",
        },
      });

      const description = wrapper.find(".description");
      expect(description.text()).toBe(": .login-form button");
    });

    it("should handle missing action selector", async () => {
      await wrapper.setProps({
        column: {
          type: "action",
          _oo_action_target_text: "Click Here",
          _oo_action_target_selector: "",
        },
      });

      const description = wrapper.find(".description");
      expect(description.text()).toBe("Click Here :");
    });
  });

  describe("Unknown Type Handling", () => {
    it("should return empty string for unknown type", async () => {
      await wrapper.setProps({
        column: {
          type: "unknown",
          some_field: "some_value",
        },
      });

      const description = wrapper.find(".description");
      expect(description.text()).toBe("");
    });

    it("should handle missing type", async () => {
      await wrapper.setProps({
        column: {
          error_message: "Some error",
        },
      });

      const description = wrapper.find(".description");
      expect(description.text()).toBe("");
    });
  });

  describe("Computed Property", () => {
    it("should have getDescription computed property", () => {
      expect(wrapper.vm.getDescription).toBeDefined();
      expect(wrapper.vm.getDescription).toBe(
        "Cannot read property 'foo' of undefined",
      );
    });

    it("should reactively update when column changes", async () => {
      expect(wrapper.vm.getDescription).toBe(
        "Cannot read property 'foo' of undefined",
      );

      await wrapper.setProps({
        column: {
          type: "resource",
          resource_url: "https://example.com/api",
        },
      });

      expect(wrapper.vm.getDescription).toBe("https://example.com/api");
    });
  });

  describe("Props Validation", () => {
    it("should require column prop", () => {
      expect(ErrorEventDescription.props?.column?.required).toBe(true);
      expect(ErrorEventDescription.props?.column?.type).toBe(Object);
    });

    it("should handle complex column structures", async () => {
      const complexColumn = {
        type: "view",
        view_loading_type: "route_change",
        view_referrer: "https://example.com/page1",
        view_url: "https://example.com/page2",
        other_field: "ignored",
      };

      await wrapper.setProps({ column: complexColumn });

      const navigation = wrapper.find(".navigation");
      expect(navigation.exists()).toBe(true);
    });
  });

  describe("CSS Styling", () => {
    it("should apply description styling", () => {
      const container = wrapper.find(".description");
      expect(container.classes()).toContain("description");
    });

    it("should apply navigation styling", async () => {
      await wrapper.setProps({
        column: {
          type: "view",
          view_loading_type: "route_change",
          view_referrer: "/a",
          view_url: "/b",
        },
      });

      const navigation = wrapper.find(".navigation");
      expect(navigation.classes()).toContain("navigation");
      expect(navigation.classes()).toContain("q-pa-sm");
    });

    it("should style resource URL correctly", async () => {
      await wrapper.setProps({
        column: {
          type: "resource",
          resource_type: "xhr",
          resource_method: "GET",
          resource_url: "https://api.test.com",
          resource_status_code: 200,
        },
      });

      const link = wrapper.find(".resource-url");
      expect(link.classes()).toContain("resource-url");
      expect(link.classes()).toContain("text-primary");
    });
  });

  describe("Edge Cases", () => {
    it("should handle null values", async () => {
      await wrapper.setProps({
        column: {
          type: "error",
          error_message: null,
        },
      });

      const description = wrapper.find(".description");
      expect(description.text()).toBe("");
    });

    it("should handle undefined values", async () => {
      await wrapper.setProps({
        column: {
          type: "action",
          _oo_action_target_text: undefined,
          _oo_action_target_selector: undefined,
        },
      });

      const description = wrapper.find(".description");
      expect(description.text()).toBe("undefined : undefined");
    });

    it("should handle mixed case types", async () => {
      await wrapper.setProps({
        column: {
          type: "ERROR",
          error_message: "Mixed case error",
        },
      });

      const description = wrapper.find(".description");
      expect(description.text()).toBe("");
    });
  });

  describe("Component Structure", () => {
    it("should have proper template structure", () => {
      const description = wrapper.find(".description");
      expect(description.exists()).toBe(true);
      expect(description.element.children.length).toBeGreaterThanOrEqual(0);
    });

    it("should conditionally render different templates", async () => {
      // Test navigation template
      await wrapper.setProps({
        column: {
          type: "view",
          view_loading_type: "route_change",
          view_referrer: "/a",
          view_url: "/b",
        },
      });

      expect(wrapper.find(".navigation").exists()).toBe(true);

      // Test XHR template
      await wrapper.setProps({
        column: {
          type: "resource",
          resource_type: "xhr",
          resource_method: "GET",
          resource_url: "https://test.com",
          resource_status_code: 200,
        },
      });

      expect(wrapper.find(".resource-url").exists()).toBe(true);

      // Test default template
      await wrapper.setProps({
        column: {
          type: "error",
          error_message: "Default template",
        },
      });

      expect(wrapper.find(".description span").exists()).toBe(true);
    });
  });

  describe("Component Lifecycle", () => {
    it("should handle rapid prop changes", async () => {
      const columns = [
        { type: "error", error_message: "Error 1" },
        { type: "resource", resource_url: "https://api1.com" },
        {
          type: "action",
          _oo_action_target_text: "Click",
          _oo_action_target_selector: ".btn",
        },
        { type: "view", view_url: "/page" },
      ];

      for (const column of columns) {
        await wrapper.setProps({ column });
        expect(wrapper.vm.getDescription).toBeDefined();
      }
    });
  });
});
