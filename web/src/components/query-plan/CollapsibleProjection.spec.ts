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

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import CollapsibleProjection from "./CollapsibleProjection.vue";

describe("CollapsibleProjection", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  function mountComponent(props: Record<string, unknown> = {}) {
    return mount(CollapsibleProjection, {
      props: {
        fieldsText: "[field1, field2]",
        ...props,
      },
    });
  }

  describe("initial render", () => {
    it("should render without errors", () => {
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render as a span element", () => {
      wrapper = mountComponent();
      expect(wrapper.element.tagName).toBe("SPAN");
    });
  });

  describe("non-collapsible (fields <= threshold)", () => {
    it("should show full text when field count is below threshold", () => {
      wrapper = mountComponent({
        fieldsText: "[field1, field2, field3]",
        threshold: 5,
      });
      expect(wrapper.text()).toContain("[field1, field2, field3]");
    });

    it("should show full text when field count equals threshold", () => {
      wrapper = mountComponent({
        fieldsText: "[a, b, c, d, e]",
        threshold: 5,
      });
      expect(wrapper.text()).toContain("[a, b, c, d, e]");
    });

    it("should not show expand link when not collapsible", () => {
      wrapper = mountComponent({
        fieldsText: "[field1, field2]",
        threshold: 5,
      });
      expect(wrapper.find(".expand-link").exists()).toBe(false);
    });

    it("should show text directly when no brackets present", () => {
      wrapper = mountComponent({
        fieldsText: "SomeOperator",
        threshold: 5,
      });
      expect(wrapper.text()).toContain("SomeOperator");
    });
  });

  describe("collapsible (fields > threshold)", () => {
    const manyFieldsText =
      "[field1, field2, field3, field4, field5, field6, field7]";

    it("should show truncated view when field count exceeds threshold", () => {
      wrapper = mountComponent({ fieldsText: manyFieldsText, threshold: 5 });
      // Should show "... N more ▼" expand link
      expect(wrapper.find(".expand-link").exists()).toBe(true);
    });

    it("should show correct hidden count in expand link", () => {
      wrapper = mountComponent({ fieldsText: manyFieldsText, threshold: 5 });
      // 7 fields total, 3 visible, 4 hidden
      expect(wrapper.find(".expand-link").text()).toContain("4 more");
    });

    it("should not show collapse link when collapsed", () => {
      wrapper = mountComponent({ fieldsText: manyFieldsText, threshold: 5 });
      expect(wrapper.find(".expand-link").text()).not.toContain("collapse");
    });

    it("should expand when expand link is clicked", async () => {
      wrapper = mountComponent({ fieldsText: manyFieldsText, threshold: 5 });
      await wrapper.find(".expand-link").trigger("click");
      // After expand, collapse link should appear
      expect(wrapper.find(".expand-link").text()).toContain("collapse");
    });

    it("should show all fields text when expanded", async () => {
      wrapper = mountComponent({ fieldsText: manyFieldsText, threshold: 5 });
      await wrapper.find(".expand-link").trigger("click");
      expect(wrapper.text()).toContain("field1");
      expect(wrapper.text()).toContain("field7");
    });

    it("should collapse back when collapse link is clicked", async () => {
      wrapper = mountComponent({ fieldsText: manyFieldsText, threshold: 5 });
      // expand first
      await wrapper.find(".expand-link").trigger("click");
      expect(wrapper.find(".expand-link").text()).toContain("collapse");
      // collapse
      await wrapper.find(".expand-link").trigger("click");
      expect(wrapper.find(".expand-link").text()).toContain("more");
    });
  });

  describe("threshold prop", () => {
    it("should use default threshold of 5 when not specified", () => {
      // 5 fields — at threshold, not collapsible
      wrapper = mountComponent({ fieldsText: "[a, b, c, d, e]" });
      expect(wrapper.find(".expand-link").exists()).toBe(false);
    });

    it("should respect custom threshold", () => {
      // 3 fields with threshold=2 → collapsible
      wrapper = mountComponent({
        fieldsText: "[a, b, c]",
        threshold: 2,
      });
      expect(wrapper.find(".expand-link").exists()).toBe(true);
    });

    it("should not collapse when fields count equals custom threshold", () => {
      wrapper = mountComponent({
        fieldsText: "[a, b]",
        threshold: 2,
      });
      expect(wrapper.find(".expand-link").exists()).toBe(false);
    });
  });

  describe("field parsing", () => {
    it("should correctly parse comma-separated fields", () => {
      wrapper = mountComponent({
        fieldsText: "[a, b, c, d, e, f]",
        threshold: 5,
      });
      // 6 fields, 3 visible, 3 hidden
      expect(wrapper.find(".expand-link").text()).toContain("3 more");
    });

    it("should handle nested brackets in fields without breaking count", () => {
      // Fields with nested brackets should be treated as single fields
      wrapper = mountComponent({
        fieldsText: "[func(a, b), func(c, d), e, f, g, h]",
        threshold: 5,
      });
      expect(wrapper.find(".expand-link").exists()).toBe(true);
    });

    it("should handle empty brackets gracefully", () => {
      wrapper = mountComponent({ fieldsText: "[]" });
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".expand-link").exists()).toBe(false);
    });

    it("should handle fieldsText with prefix before bracket", () => {
      wrapper = mountComponent({
        fieldsText: "Projection: [a, b, c, d, e, f]",
        threshold: 5,
      });
      // 6 fields → collapsible
      expect(wrapper.find(".expand-link").exists()).toBe(true);
    });
  });

  describe("visibleFields computed", () => {
    it("should show only first 3 fields before expand", () => {
      wrapper = mountComponent({
        fieldsText: "[alpha, beta, gamma, delta, epsilon, zeta]",
        threshold: 5,
      });
      const text = wrapper.text();
      expect(text).toContain("alpha");
      expect(text).toContain("beta");
      expect(text).toContain("gamma");
      // delta, epsilon, zeta should not appear in collapsed view
      expect(text).not.toContain("delta");
    });
  });
});
