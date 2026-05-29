import { describe, expect, it, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import EventDetailsSection from "./EventDetailsSection.vue";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("./KeyValueRow.vue", () => ({
  default: {
    name: "KeyValueRow",
    template:
      '<div data-test="key-value-row" :data-key="label"><span>{{ label }}</span><span>{{ value }}</span><slot /></div>',
    props: ["label", "value", "showBorder", "valueClass", "dataTest"],
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sampleFields = [
  { key: "browser", label: "Browser", value: "Chrome" },
  { key: "os", label: "OS", value: "macOS" },
  { key: "ip", label: "IP", value: "127.0.0.1" },
];

function mountComponent(props: Record<string, any> = {}) {
  return mount(EventDetailsSection, {
    props: {
      title: "Session Details",
      fields: sampleFields,
      ...props,
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EventDetailsSection", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("initial render", () => {
    it("renders without errors", () => {
      // Arrange + Act
      wrapper = mountComponent();

      // Assert
      expect(wrapper.exists()).toBe(true);
    });

    it("displays the title text", () => {
      // Arrange + Act
      wrapper = mountComponent({ title: "My Section" });

      // Assert
      expect(wrapper.text()).toContain("My Section");
    });

    it("renders a KeyValueRow for each visible field", () => {
      // Arrange + Act
      wrapper = mountComponent();

      // Assert
      expect(wrapper.findAll('[data-test="key-value-row"]')).toHaveLength(3);
    });
  });

  describe("visibleFields — filtering", () => {
    it("excludes fields with null value", () => {
      // Arrange + Act
      wrapper = mountComponent({
        fields: [
          { key: "browser", label: "Browser", value: "Chrome" },
          { key: "os", label: "OS", value: null },
        ],
      });

      // Assert
      expect(wrapper.findAll('[data-test="key-value-row"]')).toHaveLength(1);
    });

    it("excludes fields with empty string value", () => {
      // Arrange + Act
      wrapper = mountComponent({
        fields: [
          { key: "browser", label: "Browser", value: "Chrome" },
          { key: "os", label: "OS", value: "" },
        ],
      });

      // Assert
      expect(wrapper.findAll('[data-test="key-value-row"]')).toHaveLength(1);
    });

    it("excludes fields with condition=false", () => {
      // Arrange + Act
      wrapper = mountComponent({
        fields: [
          { key: "browser", label: "Browser", value: "Chrome", condition: false },
          { key: "os", label: "OS", value: "macOS", condition: true },
        ],
      });

      // Assert
      expect(wrapper.findAll('[data-test="key-value-row"]')).toHaveLength(1);
    });

    it("includes fields with condition=true", () => {
      // Arrange + Act
      wrapper = mountComponent({
        fields: [
          { key: "browser", label: "Browser", value: "Chrome", condition: true },
          { key: "os", label: "OS", value: "macOS", condition: true },
        ],
      });

      // Assert
      expect(wrapper.findAll('[data-test="key-value-row"]')).toHaveLength(2);
    });

    it("includes fields when condition is not specified", () => {
      // Arrange + Act
      wrapper = mountComponent({
        fields: [{ key: "browser", label: "Browser", value: "Chrome" }],
      });

      // Assert
      expect(wrapper.findAll('[data-test="key-value-row"]')).toHaveLength(1);
    });

    it("shows no rows when all fields are filtered out", () => {
      // Arrange + Act
      wrapper = mountComponent({
        fields: [
          { key: "a", label: "A", value: null },
          { key: "b", label: "B", value: "" },
          { key: "c", label: "C", value: "valid", condition: false },
        ],
      });

      // Assert
      expect(wrapper.findAll('[data-test="key-value-row"]')).toHaveLength(0);
    });

    it("renders no rows for empty fields array", () => {
      // Arrange + Act
      wrapper = mountComponent({ fields: [] });

      // Assert
      expect(wrapper.findAll('[data-test="key-value-row"]')).toHaveLength(0);
    });

    it("includes field with numeric value 0 (not null and not empty string)", () => {
      // Arrange + Act
      wrapper = mountComponent({
        fields: [{ key: "count", label: "Count", value: 0 }],
      });

      // Assert — 0 is not null and not "", it passes the filter
      expect(wrapper.findAll('[data-test="key-value-row"]')).toHaveLength(1);
    });
  });

  describe("showBorder logic", () => {
    it("renders the correct number of rows for a 3-field list", () => {
      // Arrange + Act
      wrapper = mountComponent({
        fields: [
          { key: "a", label: "A", value: "1" },
          { key: "b", label: "B", value: "2" },
          { key: "c", label: "C", value: "3" },
        ],
      });

      // Assert
      const rows = wrapper.findAll('[data-test="key-value-row"]');
      expect(rows).toHaveLength(3);
    });
  });

  describe("dataTest prop", () => {
    it("applies dataTest value to the root element", () => {
      // Arrange + Act
      wrapper = mountComponent({ dataTest: "rum-session-details" });

      // Assert
      expect(wrapper.attributes("data-test")).toBe("rum-session-details");
    });

    it("uses empty string as default when dataTest is not provided", () => {
      // Arrange + Act
      wrapper = mountComponent();

      // Assert
      const dataTest = wrapper.attributes("data-test");
      expect(dataTest === undefined || dataTest === "").toBe(true);
    });
  });

  describe("slot support", () => {
    it("renders slot content for fields with slot=true", () => {
      // Arrange + Act
      wrapper = mount(EventDetailsSection, {
        props: {
          title: "Custom",
          fields: [{ key: "custom-key", label: "Custom", value: "val", slot: true }],
        },
        slots: {
          "custom-key": '<span data-test="slot-content">custom slot</span>',
        },
      });

      // Assert
      expect(wrapper.find('[data-test="slot-content"]').exists()).toBe(true);
    });
  });
});
