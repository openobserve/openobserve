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
import ErrorEventDescription from "@/components/rum/errorTracking/view/ErrorEventDescription.vue";

describe("ErrorEventDescription Component", () => {
  let wrapper: any;

  const defaultColumn = {
    type: "error",
    error_message: "Cannot read property 'foo' of undefined",
  };

  function mountComponent(column = defaultColumn) {
    return mount(ErrorEventDescription, { props: { column } });
  }

  beforeEach(async () => {
    wrapper = mountComponent();
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.restoreAllMocks();
  });

  it("mounts successfully", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    expect(wrapper.exists()).toBe(true);
  });

  it("shows error message text for error type", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    expect(wrapper.text()).toContain("Cannot read property 'foo' of undefined");
  });

  it("shows updated error message when column prop changes", async () => {
    // Arrange
    const newColumn = { type: "error", error_message: "TypeError: undefined is not a function" };

    // Act
    await wrapper.setProps({ column: newColumn });

    // Assert
    expect(wrapper.text()).toContain("TypeError: undefined is not a function");
  });

  it("shows empty text for error type with empty message", async () => {
    // Arrange
    await wrapper.setProps({ column: { type: "error", error_message: "" } });

    // Assert
    expect(wrapper.find('[data-test="error-event-description-default"]').text()).toBe("");
  });

  it("shows resource URL for resource type without xhr subtype", async () => {
    // Arrange
    await wrapper.setProps({
      column: { type: "resource", resource_url: "https://api.example.com/data" },
    });

    // Assert
    expect(wrapper.text()).toContain("https://api.example.com/data");
  });

  it("shows method, resource URL and status code for xhr resource", async () => {
    // Arrange
    await wrapper.setProps({
      column: {
        type: "resource",
        resource_type: "xhr",
        resource_method: "GET",
        resource_url: "https://api.example.com/users",
        resource_status_code: 200,
      },
    });

    // Assert
    expect(wrapper.text()).toContain("GET");
    expect(wrapper.text()).toContain("https://api.example.com/users");
    expect(wrapper.text()).toContain("[ 200 ]");
  });

  it("renders resource URL as a link opening in a new tab for xhr", async () => {
    // Arrange
    await wrapper.setProps({
      column: {
        type: "resource",
        resource_type: "xhr",
        resource_method: "POST",
        resource_url: "https://api.example.com/submit",
        resource_status_code: 201,
      },
    });

    // Assert
    const link = wrapper.find("a.resource-url");
    expect(link.exists()).toBe(true);
    expect(link.attributes("href")).toBe("https://api.example.com/submit");
    expect(link.attributes("target")).toBe("_blank");
  });

  it("shows view URL for a standard view type", async () => {
    // Arrange
    await wrapper.setProps({ column: { type: "view", view_url: "/dashboard" } });

    // Assert
    expect(wrapper.text()).toContain("/dashboard");
  });

  it("shows navigation block with from/to for route_change view", async () => {
    // Arrange
    await wrapper.setProps({
      column: {
        type: "view",
        view_loading_type: "route_change",
        view_referrer: "/home",
        view_url: "/profile",
      },
    });

    // Assert
    const nav = wrapper.find('[data-test="error-event-description-navigation"]');
    expect(nav.exists()).toBe(true);
    expect(nav.text()).toContain("from");
    expect(nav.text()).toContain("/home");
    expect(nav.text()).toContain("to");
    expect(nav.text()).toContain("/profile");
  });

  it("renders navigation block as a pre element", async () => {
    // Arrange
    await wrapper.setProps({
      column: {
        type: "view",
        view_loading_type: "route_change",
        view_referrer: "/login",
        view_url: "/dashboard",
      },
    });

    // Assert
    const nav = wrapper.find('[data-test="error-event-description-navigation"]');
    expect(nav.element.tagName).toBe("PRE");
  });

  it("highlights from and to keywords with text-primary spans", async () => {
    // Arrange
    await wrapper.setProps({
      column: {
        type: "view",
        view_loading_type: "route_change",
        view_referrer: "/old-page",
        view_url: "/new-page",
      },
    });

    // Assert
    const primarySpans = wrapper.findAll(".text-primary");
    expect(primarySpans).toHaveLength(2);
    expect(primarySpans[0].text()).toBe("from");
    expect(primarySpans[1].text()).toBe("to");
  });

  it("shows action target text and selector for action type", async () => {
    // Arrange
    await wrapper.setProps({
      column: {
        type: "action",
        _oo_action_target_text: "Submit Button",
        _oo_action_target_selector: "#submit-btn",
      },
    });

    // Assert
    expect(wrapper.text()).toContain("Submit Button : #submit-btn");
  });

  it("shows action with undefined target text and selector as 'undefined : undefined'", async () => {
    // Arrange
    await wrapper.setProps({
      column: {
        type: "action",
        _oo_action_target_text: undefined,
        _oo_action_target_selector: undefined,
      },
    });

    // Assert
    expect(wrapper.find('[data-test="error-event-description-default"]').text()).toBe(
      "undefined : undefined",
    );
  });

  it("shows empty text for unknown type", async () => {
    // Arrange
    await wrapper.setProps({ column: { type: "unknown", some_field: "value" } });

    // Assert
    expect(wrapper.find('[data-test="error-event-description-default"]').text()).toBe("");
  });

  it("shows empty text when type is missing", async () => {
    // Arrange
    await wrapper.setProps({ column: { error_message: "Some error" } });

    // Assert
    expect(wrapper.find('[data-test="error-event-description-default"]').text()).toBe("");
  });

  it("shows empty text when error_message is null", async () => {
    // Arrange
    await wrapper.setProps({ column: { type: "error", error_message: null } });

    // Assert
    expect(wrapper.find('[data-test="error-event-description-default"]').text()).toBe("");
  });

  it("has getDescription computed property that returns the error message", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    expect(wrapper.vm.getDescription).toBe("Cannot read property 'foo' of undefined");
  });

  it("reactively updates getDescription when column type changes", async () => {
    // Arrange
    expect(wrapper.vm.getDescription).toBe("Cannot read property 'foo' of undefined");

    // Act
    await wrapper.setProps({
      column: { type: "resource", resource_url: "https://example.com/api" },
    });

    // Assert
    expect(wrapper.vm.getDescription).toBe("https://example.com/api");
  });

  it("requires the column prop", () => {
    // Assert
    expect(ErrorEventDescription.props?.column?.required).toBe(true);
    expect(ErrorEventDescription.props?.column?.type).toBe(Object);
  });

  it("switches between navigation, xhr and default templates on prop changes", async () => {
    // Arrange: navigation template
    await wrapper.setProps({
      column: {
        type: "view",
        view_loading_type: "route_change",
        view_referrer: "/a",
        view_url: "/b",
      },
    });
    expect(wrapper.find('[data-test="error-event-description-navigation"]').exists()).toBe(true);

    // Act: switch to xhr template
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

    // Act: switch back to default template
    await wrapper.setProps({
      column: { type: "error", error_message: "Default" },
    });
    const defaultSpan = wrapper.find('[data-test="error-event-description-default"]');
    expect(defaultSpan.exists()).toBe(true);
    expect(defaultSpan.text()).toBe("Default");
  });

  it("handles rapid prop changes without errors", async () => {
    // Arrange
    const columns = [
      { type: "error", error_message: "Error 1" },
      { type: "resource", resource_url: "https://api1.com" },
      { type: "action", _oo_action_target_text: "Click", _oo_action_target_selector: ".btn" },
      { type: "view", view_url: "/page" },
    ];

    for (const column of columns) {
      // Act
      await wrapper.setProps({ column });

      // Assert
      expect(wrapper.vm.getDescription).toBeDefined();
    }
  });
});
