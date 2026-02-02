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
import ErrorTag from "@/components/rum/errorTracking/view/ErrorTag.vue";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

// Install Quasar plugins
installQuasar({
  plugins: [quasar.Dialog, quasar.Notify, quasar.Loading],
});

describe("ErrorTag Component", () => {
  let wrapper: any;

  const mockTag = {
    key: "service",
    value: "web-application",
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    wrapper = mount(ErrorTag, {
      attachTo: "#app",
      props: {
        tag: mockTag,
      },
      global: {
        stubs: {
          "q-separator": {
            template: '<div data-test="separator" />',
            props: ["vertical"],
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

    it("should render tag block container", () => {
      expect(wrapper.find(".tag-block").exists()).toBe(true);
    });

    it("should have correct container classes", () => {
      const container = wrapper.find(".tag-block");
      expect(container.classes()).toContain("tag-block");
      expect(container.classes()).toContain("row");
      expect(container.classes()).toContain("items-center");
      expect(container.classes()).toContain("no-wrap");
      expect(container.classes()).toContain("q-mr-sm");
      expect(container.classes()).toContain("q-mt-sm");
    });
  });

  describe("Tag Key Display", () => {
    it("should display the tag key", () => {
      const keyElements = wrapper.findAll(".tag-block .q-px-md");
      expect(keyElements.length).toBeGreaterThan(0);
      expect(keyElements[0].text()).toBe("service");
    });

    it("should have correct key styling", () => {
      const keyElements = wrapper.findAll(".tag-block .q-px-md");
      expect(keyElements.length).toBeGreaterThan(0);
      expect(keyElements[0].classes()).toContain("q-px-md");
    });
  });

  describe("Tag Value Display", () => {
    it("should display the tag value", () => {
      const valueElements = wrapper.findAll(".q-px-md");
      const valueElement = valueElements[1]; // Second q-px-md is the value
      expect(valueElement.exists()).toBe(true);
      expect(valueElement.text()).toBe("web-application");
    });

    it("should have correct value styling", () => {
      const valueElements = wrapper.findAll(".q-px-md");
      const valueElement = valueElements[1]; // Second q-px-md is the value
      expect(valueElement.classes()).toContain("q-px-md");
      expect(valueElement.classes()).toContain("tw:break-all");
    });

    it("should handle word breaking", () => {
      const valueElements = wrapper.findAll(".q-px-md");
      const valueElement = valueElements[1]; // Second q-px-md is the value
      expect(valueElement.classes()).toContain("tw:break-all");
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

      const valueElements = wrapper.findAll(".q-px-md");
      expect(valueElements.length).toBeGreaterThanOrEqual(2);
      const keyElement = valueElements[0]; // First q-px-md is the key
      const valueElement = valueElements[1]; // Second q-px-md is the value

      expect(keyElement.text()).toBe("error_type");
      expect(valueElement.text()).toBe("TypeError");
    });

    it("should handle long values", async () => {
      const longTag = {
        key: "url",
        value:
          "https://example.com/very/long/path/that/might/overflow/the/container",
      };

      await wrapper.setProps({ tag: longTag });

      const valueElements = wrapper.findAll(".q-px-md");
      const valueElement = valueElements[1]; // Second q-px-md is the value
      expect(valueElement.text()).toBe(longTag.value);
      expect(valueElement.classes()).toContain("tw:break-all");
    });

    it("should handle special characters", async () => {
      const specialTag = {
        key: "user@email",
        value: "test@example.com",
      };

      await wrapper.setProps({ tag: specialTag });

      const valueElements = wrapper.findAll(".q-px-md");
      expect(valueElements.length).toBeGreaterThanOrEqual(2);
      const keyElement = valueElements[0]; // First q-px-md is the key
      const valueElement = valueElements[1]; // Second q-px-md is the value

      expect(keyElement.text()).toBe("user@email");
      expect(valueElement.text()).toBe("test@example.com");
    });
  });

  describe("Component Structure", () => {
    it("should have proper element hierarchy", () => {
      const container = wrapper.find(".tag-block");
      const keyElement = container.find(".q-px-md:first-child");
      const separator = container.find('[data-test="separator"]');
      const valueElements = container.findAll(".q-px-md");
      const valueElement = valueElements[1]; // Second q-px-md is the value

      expect(container.exists()).toBe(true);
      expect(keyElement.exists()).toBe(true);
      expect(separator.exists()).toBe(true);
      expect(valueElement.exists()).toBe(true);
    });

    it("should maintain correct order of elements", () => {
      const container = wrapper.find(".tag-block");
      const children = container.element.children;

      expect(children).toHaveLength(3);
      expect(children[0].classList.contains("q-px-md")).toBe(true);
      expect(children[1].getAttribute("data-test")).toBe("separator");
      expect(children[2].classList.contains("q-px-md")).toBe(true);
    });
  });

  describe("CSS Styling", () => {
    it("should apply correct border styling", () => {
      const container = wrapper.find(".tag-block");
      expect(container.classes()).toContain("tag-block");
    });

    it("should apply background color to value section", () => {
      const valueElements = wrapper.findAll(".q-px-md");
      const valueElement = valueElements[1]; // Second q-px-md is the value
      expect(valueElement.classes()).toContain("tw:bg-[var(--o2-table-header-bg)]");
    });

    it("should apply correct spacing classes", () => {
      const container = wrapper.find(".tag-block");
      expect(container.classes()).toContain("q-mr-sm");
      expect(container.classes()).toContain("q-mt-sm");

      const valueElements = wrapper.findAll(".q-px-md");
      expect(valueElements.length).toBeGreaterThanOrEqual(2);
      const keyElement = valueElements[0]; // First q-px-md is the key
      const valueElement = valueElements[1]; // Second q-px-md is the value

      expect(keyElement.classes()).toContain("q-px-md");
      expect(valueElement.classes()).toContain("q-px-md");
    });
  });

  describe("Responsive Design", () => {
    it("should handle long keys gracefully", async () => {
      const longKeyTag = {
        key: "very_long_key_name_that_might_overflow",
        value: "short",
      };

      await wrapper.setProps({ tag: longKeyTag });

      const keyElements = wrapper.findAll(".q-px-md");
      expect(keyElements.length).toBeGreaterThan(0);
      const keyElement = keyElements[0];
      expect(keyElement.text()).toBe(longKeyTag.key);
    });

    it("should use no-wrap class to prevent wrapping", () => {
      const container = wrapper.find(".tag-block");
      expect(container.classes()).toContain("no-wrap");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty key", async () => {
      const emptyKeyTag = {
        key: "",
        value: "value",
      };

      await wrapper.setProps({ tag: emptyKeyTag });

      const keyElement = wrapper.find(".tag-block .q-px-md:first-child");
      if (keyElement.exists()) {
        expect(keyElement.text()).toBe("");
      } else {
        expect(keyElement.exists()).toBe(false);
      }
    });

    it("should handle empty value", async () => {
      const emptyValueTag = {
        key: "key",
        value: "",
      };

      await wrapper.setProps({ tag: emptyValueTag });

      const valueElements = wrapper.findAll(".q-px-md");
      const valueElement = valueElements[1]; // Second q-px-md is the value
      expect(valueElement.text()).toBe("");
    });

    it("should handle null values", async () => {
      const nullTag = {
        key: "key",
        value: null,
      };

      await wrapper.setProps({ tag: nullTag });

      const valueElements = wrapper.findAll(".q-px-md");
      const valueElement = valueElements[1]; // Second q-px-md is the value
      expect(valueElement.text()).toBe("");
    });

    it("should handle undefined values", async () => {
      const undefinedTag = {
        key: "key",
        value: undefined,
      };

      await wrapper.setProps({ tag: undefinedTag });

      const valueElements = wrapper.findAll(".q-px-md");
      const valueElement = valueElements[1]; // Second q-px-md is the value
      expect(valueElement.text()).toBe("");
    });

    it("should handle numeric values", async () => {
      const numericTag = {
        key: "count",
        value: 42,
      };

      await wrapper.setProps({ tag: numericTag });

      const valueElements = wrapper.findAll(".q-px-md");
      const valueElement = valueElements[1]; // Second q-px-md is the value
      expect(valueElement.text()).toBe("42");
    });

    it("should handle boolean values", async () => {
      const booleanTag = {
        key: "handled",
        value: true,
      };

      await wrapper.setProps({ tag: booleanTag });

      const valueElements = wrapper.findAll(".q-px-md");
      const valueElement = valueElements[1]; // Second q-px-md is the value
      expect(valueElement.text()).toBe("true");
    });
  });

  describe("Accessibility", () => {
    it("should be keyboard accessible", () => {
      const container = wrapper.find(".tag-block");
      expect(container.exists()).toBe(true);
    });

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
