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
import ErrorTag from "@/components/rum/errorTracking/view/ErrorTag.vue";

describe("ErrorTag Component", () => {
  let wrapper: any;

  const mockTag = {
    key: "service",
    value: "web-application",
  };

  beforeEach(async () => {
    wrapper = mount(ErrorTag, {
      props: {
        tag: mockTag,
      },
      global: {
        stubs: {
          OSeparator: {
            template: '<div data-test="separator" />',
            props: ["vertical"],
          },
        },
      },
    });

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

  it("shows the tag key text", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    expect(wrapper.text()).toContain("service");
  });

  it("shows the tag value text", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    expect(wrapper.text()).toContain("web-application");
  });


  it("shows updated key text when tag prop changes", async () => {
    // Arrange
    const newTag = { key: "error_type", value: "TypeError" };

    // Act
    await wrapper.setProps({ tag: newTag });

    // Assert
    expect(wrapper.text()).toContain("error_type");
  });

  it("shows updated value text when tag prop changes", async () => {
    // Arrange
    const newTag = { key: "error_type", value: "TypeError" };

    // Act
    await wrapper.setProps({ tag: newTag });

    // Assert
    expect(wrapper.text()).toContain("TypeError");
  });

  it("shows long URL values without truncation", async () => {
    // Arrange
    const longTag = {
      key: "url",
      value: "https://example.com/very/long/path/that/might/overflow/the/container",
    };

    // Act
    await wrapper.setProps({ tag: longTag });

    // Assert
    expect(wrapper.text()).toContain(longTag.value);
  });

  it("shows special character key text", async () => {
    // Arrange
    const specialTag = { key: "user@email", value: "test@example.com" };

    // Act
    await wrapper.setProps({ tag: specialTag });

    // Assert
    expect(wrapper.text()).toContain("user@email");
    expect(wrapper.text()).toContain("test@example.com");
  });

  it("shows empty string for empty value", async () => {
    // Arrange
    const emptyValueTag = { key: "key", value: "" };

    // Act
    await wrapper.setProps({ tag: emptyValueTag });

    // Assert
    expect(wrapper.text()).toContain("key");
  });

  it("shows numeric value as text", async () => {
    // Arrange
    const numericTag = { key: "count", value: 42 };

    // Act
    await wrapper.setProps({ tag: numericTag });

    // Assert
    expect(wrapper.text()).toContain("42");
  });

  it("shows boolean value as text", async () => {
    // Arrange
    const booleanTag = { key: "handled", value: true };

    // Act
    await wrapper.setProps({ tag: booleanTag });

    // Assert
    expect(wrapper.text()).toContain("true");
  });

  it("reflects prop update in rendered text", async () => {
    // Arrange
    expect(wrapper.props("tag")).toEqual(mockTag);
    const newTag = { key: "new_key", value: "new_value" };

    // Act
    await wrapper.setProps({ tag: newTag });

    // Assert
    expect(wrapper.props("tag")).toEqual(newTag);
    expect(wrapper.text()).toContain("new_key");
    expect(wrapper.text()).toContain("new_value");
  });

  it("requires the tag prop", () => {
    // Arrange + Act: inspect the component definition

    // Assert
    expect(ErrorTag.props?.tag?.required).toBe(true);
    expect(ErrorTag.props?.tag?.type).toBe(Object);
  });

  it("renders the dimension chip with key and value", () => {
    // ErrorTag now delegates to <ODimensionChip>; assert content, not structure.
    expect(wrapper.text()).toContain(wrapper.props("tag").key);
    expect(wrapper.text()).toContain(wrapper.props("tag").value);
  });
});
