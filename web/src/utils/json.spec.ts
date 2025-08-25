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

import { describe, it, expect } from "vitest";
import { ToString, byString, deepKeys } from "./json";

describe("JSON Utilities", () => {
  describe("ToString", () => {
    it("should return empty string for null", () => {
      expect(ToString(null)).toBe("");
    });

    it("should return empty string for undefined", () => {
      expect(ToString(undefined)).toBe("");
    });

    it("should return the same string for string input", () => {
      expect(ToString("hello")).toBe("hello");
      expect(ToString("")).toBe("");
      expect(ToString("test string")).toBe("test string");
    });

    it("should convert numbers to strings", () => {
      expect(ToString(123)).toBe("123");
      expect(ToString(0)).toBe("0");
      expect(ToString(-456)).toBe("-456");
      expect(ToString(3.14)).toBe("3.14");
    });

    it("should convert booleans to strings", () => {
      expect(ToString(true)).toBe("true");
      expect(ToString(false)).toBe("false");
    });

    it("should convert simple arrays to string format", () => {
      expect(ToString([1, 2, 3])).toBe("[1, 2, 3]");
      expect(ToString(["a", "b", "c"])).toBe("[a, b, c]");
      expect(ToString([])).toBe("[]");
    });

    it("should convert nested arrays to string format", () => {
      expect(ToString([1, [2, 3], 4])).toBe("[1, [2, 3], 4]");
      expect(ToString([[1, 2], [3, 4]])).toBe("[[1, 2], [3, 4]]");
    });

    it("should convert mixed type arrays to string format", () => {
      expect(ToString([1, "hello", true, null])).toBe("[1, hello, true, ]");
      expect(ToString([undefined, false, 0])).toBe("[false, 0]");
      expect(ToString([null, undefined, "test"])).toBe("[test]");
      expect(ToString([undefined])).toBe("[]");
    });

    it("should convert simple objects to string format", () => {
      expect(ToString({ a: 1, b: 2 })).toBe('{"a":1, "b":2}');
      expect(ToString({ name: "test" })).toBe('{"name":test}');
      expect(ToString({})).toBe("{}");
    });

    it("should convert nested objects to string format", () => {
      const nested = { a: { b: { c: 1 } }, d: 2 };
      expect(ToString(nested)).toBe('{"a":{"b":{"c":1}}, "d":2}');
    });

    it("should convert objects with arrays to string format", () => {
      const objWithArray = { items: [1, 2, 3], name: "test" };
      expect(ToString(objWithArray)).toBe('{"items":[1, 2, 3], "name":test}');
    });

    it("should handle arrays with objects", () => {
      const arrayWithObj = [{ a: 1 }, { b: 2 }];
      expect(ToString(arrayWithObj)).toBe('[{"a":1}, {"b":2}]');
    });

    it("should handle complex nested structures", () => {
      const complex = {
        users: [
          { id: 1, name: "John" },
          { id: 2, name: "Jane" }
        ],
        settings: { theme: "dark", enabled: true }
      };
      expect(ToString(complex)).toBe('{"users":[{"id":1, "name":John}, {"id":2, "name":Jane}], "settings":{"theme":dark, "enabled":true}}');
    });
  });

  describe("byString", () => {
    const testObject = {
      "a1": {
        "b1": "1234",
        "b2": "1",
        "b3": {
          "c1": "12",
          "c2": "22"
        }
      },
      "a2": "334",
      "a1.b1": "direct_key",
      "a1.b1.nested": { "c1": "123" }
    };

    it("should return empty string for undefined key", () => {
      expect(byString(testObject, undefined as any)).toBe("");
    });

    it("should handle direct key access", () => {
      expect(byString(testObject, "a2")).toBe("334");
      expect(byString(testObject, "a1.b1")).toBe("direct_key");
    });

    it("should handle nested object access with dot notation", () => {
      expect(byString(testObject, "a1.b1")).toBe("direct_key");
      expect(byString(testObject, "a1.b2")).toBe("1");
      expect(byString(testObject, "a1.b3.c1")).toBe("12");
      expect(byString(testObject, "a1.b3.c2")).toBe("22");
    });

    it("should prioritize longest matching key", () => {
      // Should find "a1.b1" key first before trying nested "a1"."b1"
      expect(byString(testObject, "a1.b1")).toBe("direct_key");
    });

    it("should handle array bracket notation", () => {
      const arrayObj = {
        items: ["first", "second", "third"],
        "items[1]": "direct_access"
      };
      expect(byString(arrayObj, "items[0]")).toBe("first");
      expect(byString(arrayObj, "items[1]")).toBe("direct_access"); // Priority to direct key
    });

    it("should handle mixed bracket and dot notation", () => {
      const mixedObj = {
        "users[0].name": "John",
        users: [{ name: "Jane" }]
      };
      expect(byString(mixedObj, "users[0].name")).toBe("John");
    });

    it("should return empty string for non-existent keys", () => {
      expect(byString(testObject, "nonexistent")).toBe("");
      expect(byString(testObject, "a1.nonexistent")).toBe("");
      expect(byString(testObject, "a1.b3.nonexistent")).toBe("");
    });

    it("should handle array values", () => {
      const arrayValueObj = {
        "a1": ["item1", "item2", "item3"]
      };
      expect(byString(arrayValueObj, "a1")).toBe("[item1, item2, item3]");
    });

    it("should handle object values", () => {
      const objectValueObj = {
        "settings": { theme: "dark", lang: "en" }
      };
      expect(byString(objectValueObj, "settings")).toBe('{"theme":dark, "lang":en}');
    });

    it("should handle null and undefined values in object", () => {
      const nullObj = {
        nullValue: null,
        undefinedValue: undefined,
        emptyString: ""
      };
      expect(byString(nullObj, "nullValue")).toBe("");
      expect(byString(nullObj, "undefinedValue")).toBe("");
      expect(byString(nullObj, "emptyString")).toBe("");
    });

    it("should strip leading dots from path", () => {
      expect(byString(testObject, ".a2")).toBe("334");
      expect(byString(testObject, ".a1.b2")).toBe("1");
    });
  });

  describe("deepKeys", () => {
    it("should return empty array for non-objects", () => {
      expect(deepKeys("string")).toEqual([]);
      expect(deepKeys(123)).toEqual([]);
      expect(deepKeys(null)).toEqual([]);
      expect(deepKeys(undefined)).toEqual([]);
      expect(deepKeys(true)).toEqual([]);
    });

    it("should return keys for simple objects", () => {
      const simple = { a: "1", b: "2", c: "3" };
      const keys = deepKeys(simple);
      expect(keys).toContain("a");
      expect(keys).toContain("b");
      expect(keys).toContain("c");
      expect(keys).toHaveLength(3);
    });

    it("should return nested keys with dot notation", () => {
      const nested = {
        a: {
          b: {
            c: "value"
          }
        },
        d: "direct"
      };
      const keys = deepKeys(nested);
      expect(keys).toContain("a.b.c");
      expect(keys).toContain("d");
    });

    it("should handle objects with array values", () => {
      const withArray = {
        items: ["a", "b", "c"],
        settings: {
          theme: "dark"
        }
      };
      const keys = deepKeys(withArray);
      expect(keys).toContain("items");
      expect(keys).toContain("settings.theme");
    });

    it("should handle empty objects", () => {
      const empty = {};
      expect(deepKeys(empty)).toEqual([]);
    });

    it("should handle objects with empty nested objects", () => {
      const withEmpty = {
        a: {},
        b: "value",
        c: {
          d: {}
        }
      };
      const keys = deepKeys(withEmpty);
      expect(keys).toContain("a");
      expect(keys).toContain("b");
      expect(keys).toContain("c.d");
    });

    it("should handle objects with null/undefined values", () => {
      const withNulls = {
        a: null,
        b: undefined,
        c: {
          d: null,
          e: "value"
        }
      };
      const keys = deepKeys(withNulls);
      expect(keys).toContain("a");
      expect(keys).toContain("b");
      expect(keys).toContain("c.e");
    });

    it("should handle deeply nested objects", () => {
      const deepNested = {
        level1: {
          level2: {
            level3: {
              level4: {
                value: "deep"
              }
            }
          }
        }
      };
      const keys = deepKeys(deepNested);
      expect(keys).toContain("level1.level2.level3.level4.value");
    });

    it("should handle mixed data types", () => {
      const mixed = {
        string: "text",
        number: 42,
        boolean: true,
        array: [1, 2, 3],
        object: {
          nested: "value"
        },
        nullValue: null
      };
      const keys = deepKeys(mixed);
      expect(keys).toContain("string");
      expect(keys).toContain("number");
      expect(keys).toContain("boolean");
      expect(keys).toContain("array");
      expect(keys).toContain("object.nested");
      expect(keys).toContain("nullValue");
    });

    it("should handle objects with length property", () => {
      const withLength = {
        data: "test",
        length: 4,
        nested: {
          length: 0,
          value: "nested"
        }
      };
      const keys = deepKeys(withLength);
      expect(keys).toContain("data");
      expect(keys).toContain("length");
      expect(keys).toContain("nested.length");
      expect(keys).toContain("nested.value");
    });
  });
});