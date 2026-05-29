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
import ErrorTypeIcons from "@/components/rum/errorTracking/view/ErrorTypeIcons.vue";

vi.mock("@/assets/images/rum/events/error.png", () => ({
  default: "/mock/error.png",
}));
vi.mock("@/assets/images/rum/events/navigation.png", () => ({
  default: "/mock/navigation.png",
}));
vi.mock("@/assets/images/rum/events/user.png", () => ({
  default: "/mock/user.png",
}));
vi.mock("@/assets/images/rum/events/xhr.png", () => ({
  default: "/mock/xhr.png",
}));

describe("ErrorTypeIcons Component", () => {
  let wrapper: any;

  beforeEach(async () => {
    wrapper = mount(ErrorTypeIcons, {
      props: {
        column: { category: "error" },
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

  it("renders exactly one image element", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    expect(wrapper.findAll("img")).toHaveLength(1);
  });

  it("shows error icon for error category", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const img = wrapper.find("img");
    expect(img.attributes("src")).toBe("/mock/error.png");
    expect(img.attributes("alt")).toBe("error");
  });

  it("shows xhr icon for xhr category", async () => {
    // Arrange
    await wrapper.setProps({ column: { category: "xhr" } });

    // Act (prop change triggers computed update)

    // Assert
    const img = wrapper.find("img");
    expect(img.attributes("src")).toBe("/mock/xhr.png");
    expect(img.attributes("alt")).toBe("xhr");
  });

  it("shows navigation icon for navigation category", async () => {
    // Arrange
    await wrapper.setProps({ column: { category: "navigation" } });

    // Assert
    const img = wrapper.find("img");
    expect(img.attributes("src")).toBe("/mock/navigation.png");
    expect(img.attributes("alt")).toBe("navigation");
  });

  it("shows user icon for click category", async () => {
    // Arrange
    await wrapper.setProps({ column: { category: "click" } });

    // Assert
    const img = wrapper.find("img");
    expect(img.attributes("src")).toBe("/mock/user.png");
    expect(img.attributes("alt")).toBe("click");
  });

  it("shows navigation icon for reload category", async () => {
    // Arrange
    await wrapper.setProps({ column: { category: "reload" } });

    // Assert
    const img = wrapper.find("img");
    expect(img.attributes("src")).toBe("/mock/navigation.png");
    expect(img.attributes("alt")).toBe("reload");
  });

  it("matches uppercase ERROR category case-insensitively", async () => {
    // Arrange
    await wrapper.setProps({ column: { category: "ERROR" } });

    // Assert
    expect(wrapper.find("img").attributes("src")).toBe("/mock/error.png");
  });

  it("matches mixed-case XhR category case-insensitively", async () => {
    // Arrange
    await wrapper.setProps({ column: { category: "XhR" } });

    // Assert
    expect(wrapper.find("img").attributes("src")).toBe("/mock/xhr.png");
  });

  it("matches uppercase NAVIGATION category case-insensitively", async () => {
    // Arrange
    await wrapper.setProps({ column: { category: "NAVIGATION" } });

    // Assert
    expect(wrapper.find("img").attributes("src")).toBe("/mock/navigation.png");
  });

  it("matches mixed-case Click category case-insensitively", async () => {
    // Arrange
    await wrapper.setProps({ column: { category: "Click" } });

    // Assert
    expect(wrapper.find("img").attributes("src")).toBe("/mock/user.png");
  });

  it("defaults to error icon for unknown category", async () => {
    // Arrange
    await wrapper.setProps({ column: { category: "unknown_category" } });

    // Assert
    const img = wrapper.find("img");
    expect(img.attributes("src")).toBe("/mock/error.png");
    expect(img.attributes("alt")).toBe("unknown_category");
  });

  it("defaults to error icon for empty category string", async () => {
    // Arrange
    await wrapper.setProps({ column: { category: "" } });

    // Assert
    expect(wrapper.find("img").attributes("src")).toBe("/mock/error.png");
  });

  it("provides non-empty alt text from the category value", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const alt = wrapper.find("img").attributes("alt");
    expect(alt).toBeDefined();
    expect(alt).not.toBe("");
  });

  it("updates alt attribute when category changes", async () => {
    // Arrange
    await wrapper.setProps({ column: { category: "navigation" } });

    // Assert
    expect(wrapper.find("img").attributes("alt")).toBe("navigation");
  });

  it("provides alt text for all known categories", async () => {
    // Arrange
    const categories = ["error", "xhr", "navigation", "click", "reload"];

    for (const category of categories) {
      // Act
      await wrapper.setProps({ column: { category } });

      // Assert
      expect(wrapper.find("img").attributes("alt")).toBe(category);
    }
  });

  it("has typeIcons computed property that returns a string", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    expect(wrapper.vm.typeIcons).toBeDefined();
    expect(typeof wrapper.vm.typeIcons).toBe("string");
  });

  it("reactively updates typeIcons when category changes", async () => {
    // Arrange
    expect(wrapper.vm.typeIcons).toBe("/mock/error.png");

    // Act
    await wrapper.setProps({ column: { category: "xhr" } });

    // Assert
    expect(wrapper.vm.typeIcons).toBe("/mock/xhr.png");
  });

  it("requires the column prop of type Object", () => {
    // Assert
    expect(ErrorTypeIcons.props?.column?.required).toBe(true);
    expect(ErrorTypeIcons.props?.column?.type).toBe(Object);
  });

  it("handles additional fields in column without error", async () => {
    // Arrange
    await wrapper.setProps({ column: { category: "xhr", other_field: "val" } });

    // Assert
    expect(wrapper.find("img").attributes("src")).toBe("/mock/xhr.png");
  });

  it("does not throw when setProps is called with null category", () => {
    // Assert
    expect(() => {
      wrapper.setProps({ column: { category: null } });
    }).not.toThrow();
  });

  it("does not throw when setProps is called with undefined category", () => {
    // Assert
    expect(() => {
      wrapper.setProps({ column: { category: undefined } });
    }).not.toThrow();
  });
});
