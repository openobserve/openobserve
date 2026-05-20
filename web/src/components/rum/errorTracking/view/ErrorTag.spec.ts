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

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

describe("ErrorTag Component", () => {
  let wrapper: any;

  const mockTag = {
    key: "service",
    value: "web-application",
  };

  const stubs = {
    OSeparator: {
      template: '<div data-test="separator" />',
      props: ["vertical"],
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    wrapper = mount(ErrorTag, {
      attachTo: "#app",
      props: {
        tag: mockTag,
      },
      global: {
        stubs,
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

    it("should render tag block container", () => {
      expect(wrapper.find(".tag-block").exists()).toBe(true);
    });

    it("should have tag-block class", () => {
      const container = wrapper.find(".tag-block");
      expect(container.classes()).toContain("tag-block");
    });
  });

  describe("Tag Key Display", () => {
    it("should display the tag key", () => {
      const container = wrapper.find(".tag-block");
      const children = container.element.children;
      expect(children[0].textContent?.trim()).toBe("service");
    });
  });

  describe("Tag Value Display", () => {
    it("should display the tag value", () => {
      const container = wrapper.find(".tag-block");
      const children = container.element.children;
      // Third child is the value div
      expect(children[2].textContent?.trim()).toBe("web-application");
    });
  });

  describe("Separator", () => {
    it("should render separator between key and value", () => {
      const separator = wrapper.find('[data-test="separator"]');
      expect(separator.exists()).toBe(true);
    });
  });

  describe("Props Validation", () => {
    it("should require tag prop", () => {
      expect(ErrorTag.props?.tag?.required).toBe(true);
      expect(ErrorTag.props?.tag?.type).toBe(Object);
    });

    it("should handle different tag structures", async () => {
      const customTag = {
        key: "error_type",
        value: "TypeError",
      };

      await wrapper.setProps({ tag: customTag });

      const container = wrapper.find(".tag-block");
      const children = container.element.children;
      expect(children[0].textContent?.trim()).toBe("error_type");
      expect(children[2].textContent?.trim()).toBe("TypeError");
    });

    it("should handle long values", async () => {
      const longTag = {
        key: "url",
        value:
          "https://example.com/very/long/path/that/might/overflow/the/container",
      };

      await wrapper.setProps({ tag: longTag });

      const container = wrapper.find(".tag-block");
      const children = container.element.children;
      expect(children[2].textContent?.trim()).toBe(longTag.value);
    });

    it("should handle special characters", async () => {
      const specialTag = {
        key: "user@email",
        value: "test@example.com",
      };

      await wrapper.setProps({ tag: specialTag });

      const container = wrapper.find(".tag-block");
      const children = container.element.children;
      expect(children[0].textContent?.trim()).toBe("user@email");
      expect(children[2].textContent?.trim()).toBe("test@example.com");
    });
  });

  describe("Component Structure", () => {
    it("should have proper element hierarchy", () => {
      const container = wrapper.find(".tag-block");
      const separator = container.find('[data-test="separator"]');

      expect(container.exists()).toBe(true);
      expect(separator.exists()).toBe(true);
    });

    it("should maintain correct order of elements", () => {
      const container = wrapper.find(".tag-block");
      const children = container.element.children;

      expect(children).toHaveLength(3);
      expect(children[1].getAttribute("data-test")).toBe("separator");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty key", async () => {
      const emptyKeyTag = {
        key: "",
        value: "value",
      };

      await wrapper.setProps({ tag: emptyKeyTag });

      const container = wrapper.find(".tag-block");
      const children = container.element.children;
      expect(children[0].textContent?.trim()).toBe("");
    });

    it("should handle empty value", async () => {
      const emptyValueTag = {
        key: "key",
        value: "",
      };

      await wrapper.setProps({ tag: emptyValueTag });

      const container = wrapper.find(".tag-block");
      const children = container.element.children;
      expect(children[2].textContent?.trim()).toBe("");
    });

    it("should handle null values", async () => {
      const nullTag = {
        key: "key",
        value: null,
      };

      await wrapper.setProps({ tag: nullTag });

      const container = wrapper.find(".tag-block");
      const children = container.element.children;
      expect(children[2].textContent?.trim()).toBe("");
    });

    it("should handle undefined values", async () => {
      const undefinedTag = {
        key: "key",
        value: undefined,
      };

      await wrapper.setProps({ tag: undefinedTag });

      const container = wrapper.find(".tag-block");
      const children = container.element.children;
      expect(children[2].textContent?.trim()).toBe("");
    });

    it("should handle numeric values", async () => {
      const numericTag = {
        key: "count",
        value: 42,
      };

      await wrapper.setProps({ tag: numericTag });

      const container = wrapper.find(".tag-block");
      const children = container.element.children;
      expect(children[2].textContent?.trim()).toBe("42");
    });

    it("should handle boolean values", async () => {
      const booleanTag = {
        key: "handled",
        value: true,
      };

      await wrapper.setProps({ tag: booleanTag });

      const container = wrapper.find(".tag-block");
      const children = container.element.children;
      expect(children[2].textContent?.trim()).toBe("true");
    });
  });

  describe("Accessibility", () => {
    it("should have semantic HTML structure", () => {
      const container = wrapper.find(".tag-block");
      expect(container.element.tagName).toBe("DIV");
    });
  });

  describe("Component Lifecycle", () => {
    it("should handle prop updates", async () => {
      const initialTag = wrapper.props("tag");
      expect(initialTag).toEqual(mockTag);

      const newTag = { key: "new_key", value: "new_value" };
      await wrapper.setProps({ tag: newTag });

      expect(wrapper.props("tag")).toEqual(newTag);
    });
  });
});
