import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import JsonFieldRenderer from "./JsonFieldRenderer.vue";
import store from "@/test/unit/helpers/store";

installQuasar();

describe("JsonFieldRenderer Component", () => {
  let wrapper: any;

  const createWrapper = (value: any) => {
    return mount(JsonFieldRenderer, {
      props: { value },
      global: {
        plugins: [store],
      },
    });
  };

  beforeEach(() => {
    store.state.theme = "light";
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Initialization", () => {
    it("should mount successfully with a primitive value", () => {
      wrapper = createWrapper("hello");
      expect(wrapper.exists()).toBe(true);
    });

    it("should mount successfully with a JSON string", () => {
      wrapper = createWrapper('{"key": "value"}');
      expect(wrapper.exists()).toBe(true);
    });

    it("should mount with null value", () => {
      wrapper = createWrapper(null);
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("parsedData Computed", () => {
    it("should parse a valid JSON string into an object", () => {
      wrapper = createWrapper('{"name":"John","age":30}');
      expect(wrapper.vm.parsedData).toEqual({ name: "John", age: 30 });
    });

    it("should parse a valid JSON array string", () => {
      wrapper = createWrapper('["a", "b", "c"]');
      expect(wrapper.vm.parsedData).toEqual(["a", "b", "c"]);
    });

    it("should return original string when JSON parse fails", () => {
      wrapper = createWrapper("not valid json");
      expect(wrapper.vm.parsedData).toBe("not valid json");
    });

    it("should return non-string value as-is", () => {
      wrapper = createWrapper(42);
      expect(wrapper.vm.parsedData).toBe(42);
    });

    it("should return array as-is when passed as array (not string)", () => {
      const arr = [1, 2, 3];
      wrapper = createWrapper(arr);
      expect(wrapper.vm.parsedData).toEqual(arr);
    });

    it("should return object as-is when passed as object", () => {
      const obj = { key: "value" };
      wrapper = createWrapper(obj);
      expect(wrapper.vm.parsedData).toEqual(obj);
    });

    it("should return null as-is", () => {
      wrapper = createWrapper(null);
      expect(wrapper.vm.parsedData).toBeNull();
    });

    it("should parse JSON number string", () => {
      wrapper = createWrapper("42");
      expect(wrapper.vm.parsedData).toBe(42);
    });

    it("should parse JSON boolean string", () => {
      wrapper = createWrapper("true");
      expect(wrapper.vm.parsedData).toBe(true);
    });

    it("should parse JSON null string", () => {
      wrapper = createWrapper("null");
      expect(wrapper.vm.parsedData).toBeNull();
    });
  });

  describe("isArrayOfPrimitives Computed", () => {
    it("should return true for array of strings", () => {
      wrapper = createWrapper(["a", "b", "c"]);
      expect(wrapper.vm.isArrayOfPrimitives).toBe(true);
    });

    it("should return true for array of numbers", () => {
      wrapper = createWrapper([1, 2, 3]);
      expect(wrapper.vm.isArrayOfPrimitives).toBe(true);
    });

    it("should return true for array of booleans", () => {
      wrapper = createWrapper([true, false, true]);
      expect(wrapper.vm.isArrayOfPrimitives).toBe(true);
    });

    it("should return true for mixed primitive array", () => {
      wrapper = createWrapper(["hello", 42, true, null]);
      expect(wrapper.vm.isArrayOfPrimitives).toBe(true);
    });

    it("should return true for array with null values", () => {
      wrapper = createWrapper([null, null]);
      expect(wrapper.vm.isArrayOfPrimitives).toBe(true);
    });

    it("should return false for array of objects", () => {
      wrapper = createWrapper([{ key: "val" }]);
      expect(wrapper.vm.isArrayOfPrimitives).toBe(false);
    });

    it("should return false for mixed array with object", () => {
      wrapper = createWrapper(["hello", { key: "val" }]);
      expect(wrapper.vm.isArrayOfPrimitives).toBe(false);
    });

    it("should return false when parsedData is not an array", () => {
      wrapper = createWrapper("not array");
      expect(wrapper.vm.isArrayOfPrimitives).toBe(false);
    });

    it("should return false for empty object", () => {
      wrapper = createWrapper({});
      expect(wrapper.vm.isArrayOfPrimitives).toBe(false);
    });
  });

  describe("definedItems Computed", () => {
    it("should return array filtering out undefined values", () => {
      wrapper = createWrapper([1, undefined, 3]);
      // undefined gets removed when JSON.stringify processes, or if passing directly
      expect(wrapper.vm.definedItems).toBeDefined();
    });

    it("should return all items when no undefined values", () => {
      wrapper = createWrapper([1, 2, 3]);
      expect(wrapper.vm.definedItems).toEqual([1, 2, 3]);
    });

    it("should return empty array when parsedData is not an array", () => {
      wrapper = createWrapper("string");
      expect(wrapper.vm.definedItems).toEqual([]);
    });

    it("should keep null values in definedItems", () => {
      wrapper = createWrapper([1, null, 3]);
      expect(wrapper.vm.definedItems).toContain(null);
      expect(wrapper.vm.definedItems).toHaveLength(3);
    });
  });

  describe("definedObjectEntries Computed", () => {
    it("should return object entries for single object", () => {
      wrapper = createWrapper({ a: 1, b: 2, c: undefined });
      const entries = wrapper.vm.definedObjectEntries;
      expect(entries.a).toBe(1);
      expect(entries.b).toBe(2);
      expect(entries.c).toBeUndefined();
    });

    it("should return empty object when parsedData is an array", () => {
      wrapper = createWrapper([1, 2, 3]);
      expect(wrapper.vm.definedObjectEntries).toEqual({});
    });

    it("should return empty object for non-object parsedData", () => {
      wrapper = createWrapper("string");
      expect(wrapper.vm.definedObjectEntries).toEqual({});
    });
  });

  describe("definedObjectKeys Computed", () => {
    it("should return keys of defined object entries", () => {
      wrapper = createWrapper({ a: 1, b: 2 });
      expect(wrapper.vm.definedObjectKeys).toEqual(["a", "b"]);
    });

    it("should return empty array for non-object", () => {
      wrapper = createWrapper("string");
      expect(wrapper.vm.definedObjectKeys).toEqual([]);
    });
  });

  describe("keyColor Computed", () => {
    it("should return dark theme key color when theme is dark", () => {
      store.state.theme = "dark";
      wrapper = createWrapper({ key: "value" });
      expect(wrapper.vm.keyColor).toBe("#f67a7aff");
    });

    it("should return light theme key color when theme is light", () => {
      store.state.theme = "light";
      wrapper = createWrapper({ key: "value" });
      expect(wrapper.vm.keyColor).toBe("#B71C1C");
    });
  });

  describe("getValueColor Function", () => {
    beforeEach(() => {
      store.state.theme = "light";
      wrapper = createWrapper("test");
    });

    it("should return gray color for null in light theme", () => {
      expect(wrapper.vm.getValueColor(null)).toBe("#6B7280");
    });

    it("should return purple color for boolean in light theme", () => {
      expect(wrapper.vm.getValueColor(true)).toBe("#6D28D9");
      expect(wrapper.vm.getValueColor(false)).toBe("#6D28D9");
    });

    it("should return blue color for number in light theme", () => {
      expect(wrapper.vm.getValueColor(42)).toBe("#2563EB");
    });

    it("should return green color for string in light theme", () => {
      expect(wrapper.vm.getValueColor("hello")).toBe("#047857");
    });

    it("should return gray color for object in light theme", () => {
      expect(wrapper.vm.getValueColor({ nested: true })).toBe("#4B5563");
    });

    it("should return dark gray for null in dark theme", async () => {
      store.state.theme = "dark";
      wrapper = createWrapper("test");
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.getValueColor(null)).toBe("#9CA3AF");
    });

    it("should return indigo color for boolean in dark theme", async () => {
      store.state.theme = "dark";
      wrapper = createWrapper("test");
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.getValueColor(true)).toBe("#A5B4FC");
    });

    it("should return sky blue color for number in dark theme", async () => {
      store.state.theme = "dark";
      wrapper = createWrapper("test");
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.getValueColor(100)).toBe("#60A5FA");
    });

    it("should return teal color for string in dark theme", async () => {
      store.state.theme = "dark";
      wrapper = createWrapper("test");
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.getValueColor("world")).toBe("#6EE7B7");
    });
  });

  describe("formatValue Function", () => {
    beforeEach(() => {
      wrapper = createWrapper("test");
    });

    it("should return empty string for undefined", () => {
      expect(wrapper.vm.formatValue(undefined)).toBe("");
    });

    it("should return 'null' for null", () => {
      expect(wrapper.vm.formatValue(null)).toBe("null");
    });

    it("should return empty string for 'undefined' string", () => {
      expect(wrapper.vm.formatValue("undefined")).toBe("");
    });

    it("should return JSON string for object", () => {
      expect(wrapper.vm.formatValue({ a: 1 })).toBe('{"a":1}');
    });

    it("should return JSON string for array", () => {
      expect(wrapper.vm.formatValue([1, 2, 3])).toBe("[1,2,3]");
    });

    it("should return string as-is", () => {
      expect(wrapper.vm.formatValue("hello world")).toBe("hello world");
    });

    it("should return string representation of number", () => {
      expect(wrapper.vm.formatValue(42)).toBe("42");
    });

    it("should return string representation of boolean", () => {
      expect(wrapper.vm.formatValue(true)).toBe("true");
      expect(wrapper.vm.formatValue(false)).toBe("false");
    });

    it("should return string for zero", () => {
      expect(wrapper.vm.formatValue(0)).toBe("0");
    });
  });

  describe("Template Rendering - Null/Undefined", () => {
    it("should render raw value when parsedData is null", () => {
      wrapper = createWrapper(null);
      // null parsedData falls through to first condition
      expect(wrapper.find(".json-field-renderer").exists()).toBe(true);
    });

    it("should render raw string value when it is not valid JSON", () => {
      wrapper = createWrapper("plain text");
      expect(wrapper.text()).toContain("plain text");
    });
  });

  describe("Template Rendering - Arrays", () => {
    it("should render array of primitives", () => {
      wrapper = createWrapper(["apple", "banana", "cherry"]);
      expect(wrapper.find(".json-array-items").exists()).toBe(true);
    });

    it("should render array of objects", () => {
      wrapper = createWrapper([{ user: "admin" }, { user: "guest" }]);
      expect(wrapper.find(".json-array-objects").exists()).toBe(true);
    });

    it("should render each item in primitive array", () => {
      wrapper = createWrapper(["item1", "item2"]);
      const items = wrapper.findAll(".json-array-item");
      expect(items).toHaveLength(2);
    });
  });

  describe("Template Rendering - Objects", () => {
    it("should render single object", () => {
      wrapper = createWrapper({ name: "John", age: 30 });
      expect(wrapper.find(".json-object").exists()).toBe(true);
    });

    it("should render key-value pairs for object", () => {
      wrapper = createWrapper({ name: "Alice" });
      const keyElements = wrapper.findAll(".json-key");
      expect(keyElements.length).toBeGreaterThan(0);
    });

    it("should render values in object", () => {
      wrapper = createWrapper({ name: "Bob" });
      expect(wrapper.text()).toContain("name");
      expect(wrapper.text()).toContain("Bob");
    });

    it("should render opening and closing braces for object", () => {
      wrapper = createWrapper({ a: 1 });
      expect(wrapper.text()).toContain("{");
      expect(wrapper.text()).toContain("}");
    });
  });

  describe("Template Rendering - Primitives", () => {
    it("should render numeric value", () => {
      wrapper = createWrapper(42);
      expect(wrapper.text()).toContain("42");
    });

    it("should render boolean value", () => {
      wrapper = createWrapper(true);
      expect(wrapper.text()).toContain("true");
    });
  });

  describe("isDarkTheme Computed", () => {
    it("should return true when theme is dark", () => {
      store.state.theme = "dark";
      wrapper = createWrapper("test");
      expect(wrapper.vm.isDarkTheme).toBe(true);
    });

    it("should return false when theme is light", () => {
      store.state.theme = "light";
      wrapper = createWrapper("test");
      expect(wrapper.vm.isDarkTheme).toBe(false);
    });
  });

  describe("JSON String Parsing Edge Cases", () => {
    it("should handle nested JSON object string", () => {
      wrapper = createWrapper('{"outer": {"inner": "value"}}');
      expect(wrapper.vm.parsedData).toEqual({ outer: { inner: "value" } });
    });

    it("should handle JSON with special characters", () => {
      wrapper = createWrapper('{"key": "value with spaces & special chars"}');
      expect(wrapper.vm.parsedData).toEqual({
        key: "value with spaces & special chars",
      });
    });

    it("should handle empty JSON object string", () => {
      wrapper = createWrapper("{}");
      expect(wrapper.vm.parsedData).toEqual({});
    });

    it("should handle empty JSON array string", () => {
      wrapper = createWrapper("[]");
      expect(wrapper.vm.parsedData).toEqual([]);
    });
  });
});
