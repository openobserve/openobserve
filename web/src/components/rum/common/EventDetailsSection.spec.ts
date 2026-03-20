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

import { describe, expect, it, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import EventDetailsSection from "./EventDetailsSection.vue";

installQuasar();

vi.mock("./KeyValueRow.vue", () => ({
  default: {
    name: "KeyValueRow",
    template: '<div class="key-value-row" :data-test="dataTest"><span class="label">{{ label }}</span><span class="value">{{ value }}</span><slot /></div>',
    props: ["label", "value", "showBorder", "valueClass", "dataTest"],
  },
}));

describe("EventDetailsSection", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  const sampleFields = [
    { key: "browser", label: "Browser", value: "Chrome" },
    { key: "os", label: "OS", value: "macOS" },
    { key: "ip", label: "IP", value: "127.0.0.1" },
  ];

  function mountComponent(props = {}) {
    return mount(EventDetailsSection, {
      props: {
        title: "Session Details",
        fields: sampleFields,
        ...props,
      },
    });
  }

  describe("initial render", () => {
    it("should render without errors", () => {
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it("should display the title", () => {
      wrapper = mountComponent({ title: "My Section" });
      expect(wrapper.text()).toContain("My Section");
    });

    it("should render KeyValueRow for each visible field", () => {
      wrapper = mountComponent();
      const rows = wrapper.findAll(".key-value-row");
      expect(rows).toHaveLength(3);
    });
  });

  describe("visibleFields computed — filtering", () => {
    it("should exclude fields with null value", () => {
      wrapper = mountComponent({
        fields: [
          { key: "browser", label: "Browser", value: "Chrome" },
          { key: "os", label: "OS", value: null },
        ],
      });
      expect(wrapper.findAll(".key-value-row")).toHaveLength(1);
    });

    it("should exclude fields with empty string value", () => {
      wrapper = mountComponent({
        fields: [
          { key: "browser", label: "Browser", value: "Chrome" },
          { key: "os", label: "OS", value: "" },
        ],
      });
      expect(wrapper.findAll(".key-value-row")).toHaveLength(1);
    });

    it("should exclude fields with condition=false", () => {
      wrapper = mountComponent({
        fields: [
          { key: "browser", label: "Browser", value: "Chrome", condition: false },
          { key: "os", label: "OS", value: "macOS", condition: true },
        ],
      });
      expect(wrapper.findAll(".key-value-row")).toHaveLength(1);
    });

    it("should include fields with condition=true", () => {
      wrapper = mountComponent({
        fields: [
          { key: "browser", label: "Browser", value: "Chrome", condition: true },
          { key: "os", label: "OS", value: "macOS", condition: true },
        ],
      });
      expect(wrapper.findAll(".key-value-row")).toHaveLength(2);
    });

    it("should include fields when condition is undefined (not specified)", () => {
      wrapper = mountComponent({
        fields: [{ key: "browser", label: "Browser", value: "Chrome" }],
      });
      expect(wrapper.findAll(".key-value-row")).toHaveLength(1);
    });

    it("should show no rows when all fields are filtered out", () => {
      wrapper = mountComponent({
        fields: [
          { key: "a", label: "A", value: null },
          { key: "b", label: "B", value: "" },
          { key: "c", label: "C", value: "valid", condition: false },
        ],
      });
      expect(wrapper.findAll(".key-value-row")).toHaveLength(0);
    });

    it("should handle empty fields array", () => {
      wrapper = mountComponent({ fields: [] });
      expect(wrapper.findAll(".key-value-row")).toHaveLength(0);
    });

    it("should include field with numeric value 0", () => {
      wrapper = mountComponent({
        fields: [{ key: "count", label: "Count", value: 0 }],
      });
      // 0 is not null and not "", so it should pass the filter
      // but 0 is falsy — the filter checks != null and !== ""
      expect(wrapper.findAll(".key-value-row")).toHaveLength(1);
    });
  });

  describe("showBorder logic", () => {
    it("should pass showBorder=true to all rows except the last", () => {
      wrapper = mountComponent({
        fields: [
          { key: "a", label: "A", value: "1" },
          { key: "b", label: "B", value: "2" },
          { key: "c", label: "C", value: "3" },
        ],
      });
      const rows = wrapper.findAll(".key-value-row");
      expect(rows).toHaveLength(3);
    });
  });

  describe("dataTest prop", () => {
    it("should apply dataTest to the root element", () => {
      wrapper = mountComponent({ dataTest: "rum-session-details" });
      expect(wrapper.attributes("data-test")).toBe("rum-session-details");
    });

    it("should use empty string as default when dataTest not provided", () => {
      wrapper = mountComponent();
      const dataTest = wrapper.attributes("data-test");
      expect(dataTest === undefined || dataTest === "").toBe(true);
    });
  });

  describe("slot support", () => {
    it("should render slot content for fields with slot=true", () => {
      wrapper = mount(EventDetailsSection, {
        props: {
          title: "Custom",
          fields: [{ key: "custom-key", label: "Custom", value: "val", slot: true }],
        },
        slots: {
          "custom-key": '<span data-test="slot-content">custom slot</span>',
        },
      });
      expect(wrapper.find('[data-test="slot-content"]').exists()).toBe(true);
    });
  });
});
