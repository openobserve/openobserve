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

import { describe, it, expect } from "vitest";
import {
  OVERRIDE_CONFIG_TYPES,
  parseRegexPattern,
  buildValueMappingCache,
  lookupValueMapping,
  lookupValueMappingFull,
  parseTimestampValue,
  parseOverrideConfigs,
  applyColumnOverrides,
  formatNumericValue,
  resolveIsNumber,
} from "./tableConfigUtils";

describe("tableConfigUtils", () => {
  describe("parseRegexPattern", () => {
    it("extracts pattern + flags from /pattern/flags syntax", () => {
      expect(parseRegexPattern("/foo/gi")).toEqual({ pattern: "foo", flags: "gi" });
    });
    it("treats a bare string as the pattern with no flags", () => {
      expect(parseRegexPattern("bar")).toEqual({ pattern: "bar", flags: "" });
    });
    it("handles a pattern containing slashes when no flags", () => {
      // "a/b" has no trailing /flags, so it's used verbatim
      expect(parseRegexPattern("a/b")).toEqual({ pattern: "a/b", flags: "" });
    });
  });

  describe("buildValueMappingCache", () => {
    it("returns null for empty / non-array input", () => {
      expect(buildValueMappingCache(null)).toBeNull();
      expect(buildValueMappingCache(undefined)).toBeNull();
      expect(buildValueMappingCache([])).toBeNull();
    });
    it("skips mappings that have neither text nor color", () => {
      expect(buildValueMappingCache([{ type: "value", value: "5" }])).toBeNull();
    });
    it("includes a mapping that has only a color", () => {
      const cache = buildValueMappingCache([
        { type: "value", value: "5", color: "#f00" },
      ]);
      expect(cache).not.toBeNull();
    });
  });

  describe("lookupValueMapping / lookupValueMappingFull", () => {
    it("returns null when there is no cache", () => {
      expect(lookupValueMapping(5, null)).toBeNull();
      expect(lookupValueMappingFull(5, null, "color")).toBeNull();
    });

    it("matches an exact value mapping (number ↔ string coercion)", () => {
      const cache = buildValueMappingCache([
        { type: "value", value: "5", text: "five" },
      ]);
      expect(lookupValueMapping(5, cache)).toBe("five"); // numeric cell
      expect(lookupValueMapping("5", cache)).toBe("five"); // string cell
      expect(lookupValueMapping(6, cache)).toBeNull();
    });

    it("matches a value mapping that carries empty-string from/to/pattern siblings (real popup shape)", () => {
      // ValueMappingPopUp writes every sibling key (from/to/pattern = "") on each
      // mapping. Routing must use `type` — presence checks would mis-route "value"
      // mappings into the range branch and they would never match.
      const cache = buildValueMappingCache([
        { type: "value", value: "1", from: "", to: "", pattern: "", color: "#aaaaaa", text: "No Logs" },
        { type: "value", value: "22", from: "", to: "", pattern: "", color: "#e02f44", text: "High" },
      ]);
      expect([...(cache?.keys() ?? [])]).toEqual(["1", "22"]);
      expect(lookupValueMapping(1, cache)).toBe("No Logs");
      expect(lookupValueMapping("1", cache)).toBe("No Logs");
      expect(lookupValueMapping(22, cache)).toBe("High");
      expect(lookupValueMapping(99, cache)).toBeNull();
    });

    it("keeps multiple value mappings distinct in the real popup shape (no __range__ collision)", () => {
      // The bug routed both into the range branch under the same key "__range__",
      // so the second overwrote the first and neither matched.
      const cache = buildValueMappingCache([
        { type: "value", value: "1", from: "", to: "", pattern: "", text: "one" },
        { type: "value", value: "2", from: "", to: "", pattern: "", text: "two" },
        { type: "value", value: "3", from: "", to: "", pattern: "", text: "three" },
      ]);
      expect(cache?.size).toBe(3);
      expect(lookupValueMapping(1, cache)).toBe("one");
      expect(lookupValueMapping(2, cache)).toBe("two");
      expect(lookupValueMapping(3, cache)).toBe("three");
    });

    it("routes a range mapping by type even with empty value/pattern siblings", () => {
      const cache = buildValueMappingCache([
        { type: "range", value: "", from: "0", to: "10", pattern: "", text: "low" },
      ]);
      expect(lookupValueMapping(0, cache)).toBe("low");
      expect(lookupValueMapping(5, cache)).toBe("low");
      expect(lookupValueMapping(11, cache)).toBeNull();
    });

    it("routes a regex mapping by type even with empty value/from/to siblings", () => {
      const cache = buildValueMappingCache([
        { type: "regex", value: "", from: "", to: "", pattern: "^err", text: "error" },
      ]);
      expect(lookupValueMapping("err_500", cache)).toBe("error");
      expect(lookupValueMapping("ok", cache)).toBeNull();
    });

    it("recovers a color-only value mapping in the real popup shape", () => {
      const cache = buildValueMappingCache([
        { type: "value", value: "22", from: "", to: "", pattern: "", color: "#e02f44", text: "" },
      ]);
      expect(lookupValueMapping(22, cache)).toBeNull(); // no text
      expect(lookupValueMappingFull(22, cache, "color")?.color).toBe("#e02f44");
    });

    it("infers type for legacy untyped mappings (treating '' as absent)", () => {
      const value = buildValueMappingCache([{ value: "5", text: "five" }]);
      expect(lookupValueMapping(5, value)).toBe("five");
      const range = buildValueMappingCache([{ from: "0", to: "10", text: "low" }]);
      expect(lookupValueMapping(5, range)).toBe("low");
      const regex = buildValueMappingCache([{ pattern: "^err", text: "error" }]);
      expect(lookupValueMapping("err1", regex)).toBe("error");
    });

    it("matches a numeric range, including a from of 0", () => {
      const cache = buildValueMappingCache([
        { type: "range", from: "0", to: "10", text: "low" },
      ]);
      expect(lookupValueMapping(0, cache)).toBe("low");
      expect(lookupValueMapping(5, cache)).toBe("low");
      expect(lookupValueMapping("5", cache)).toBe("low"); // numeric string cell
      expect(lookupValueMapping(11, cache)).toBeNull();
    });

    it("matches a regex mapping", () => {
      const cache = buildValueMappingCache([
        { type: "regex", pattern: "^err", text: "error" },
      ]);
      expect(lookupValueMapping("err_500", cache)).toBe("error");
      expect(lookupValueMapping("ok", cache)).toBeNull();
    });

    it("recovers color via lookupValueMappingFull even when there is no text", () => {
      const cache = buildValueMappingCache([
        { type: "value", value: "5", color: "#ff0000" },
      ]);
      // colour-only mapping → no text
      expect(lookupValueMapping(5, cache)).toBeNull();
      // but the colour is recoverable
      expect(lookupValueMappingFull(5, cache, "color")?.color).toBe("#ff0000");
    });

    it("is field-aware: a colour-only direct match does not shadow a text range match", () => {
      const cache = buildValueMappingCache([
        { type: "value", value: "5", color: "#ff0000" }, // colour only
        { type: "range", from: "0", to: "10", text: "low" }, // text via range
      ]);
      expect(lookupValueMapping(5, cache)).toBe("low"); // finds the text
      expect(lookupValueMappingFull(5, cache, "color")?.color).toBe("#ff0000");
    });
  });

  describe("parseTimestampValue", () => {
    it("returns null for empty inputs", () => {
      expect(parseTimestampValue(null, "UTC")).toBeNull();
      expect(parseTimestampValue(undefined, "UTC")).toBeNull();
      expect(parseTimestampValue("", "UTC")).toBeNull();
    });
    it("returns an already-formatted timestamp string as-is", () => {
      expect(parseTimestampValue("2026-06-10 14:54:30", "UTC")).toBe(
        "2026-06-10 14:54:30",
      );
    });
  });

  describe("parseOverrideConfigs", () => {
    it("returns empty maps for undefined input", () => {
      const maps = parseOverrideConfigs(undefined);
      expect(maps.colorConfigMap).toEqual({});
      expect(maps.unitConfigMap).toEqual({});
      expect(maps.styleConfigMap).toEqual({});
      expect(maps.conditionalRulesMap).toEqual({});
    });

    it("parses every config type, keyed by lower-cased alias", () => {
      const maps = parseOverrideConfigs([
        {
          field: { value: "Count" },
          config: [
            { type: OVERRIDE_CONFIG_TYPES.UNIT, value: { unit: "bytes", customUnit: "" } },
            { type: OVERRIDE_CONFIG_TYPES.ALIGNMENT, value: "center" },
            { type: OVERRIDE_CONFIG_TYPES.TEXT_COLOR, value: "#111" },
            { type: OVERRIDE_CONFIG_TYPES.BACKGROUND_COLOR, value: "#eee" },
            { type: OVERRIDE_CONFIG_TYPES.UNIQUE_VALUE_COLOR, autoColor: true },
            {
              type: OVERRIDE_CONFIG_TYPES.CONDITIONAL_STYLES,
              rules: [{ operator: ">", threshold: 5, textColor: "#f00", bgColor: "#fee" }],
            },
          ],
        },
      ]);
      expect(maps.unitConfigMap.count).toEqual({ unit: "bytes", customUnit: "" });
      expect(maps.styleConfigMap.count.alignment).toBe("center");
      expect(maps.styleConfigMap.count.textColor).toBe("#111");
      expect(maps.styleConfigMap.count.bgColor).toBe("#eee");
      expect(maps.colorConfigMap.count.autoColor).toBe(true);
      expect(maps.conditionalRulesMap.count[0]).toMatchObject({
        operator: ">",
        threshold: 5,
      });
    });

    it("coerces a string threshold to a number", () => {
      const maps = parseOverrideConfigs([
        {
          field: { value: "x" },
          config: [
            {
              type: OVERRIDE_CONFIG_TYPES.CONDITIONAL_STYLES,
              rules: [{ operator: ">", threshold: "7.5" }],
            },
          ],
        },
      ]);
      expect(maps.conditionalRulesMap.x[0].threshold).toBe(7.5);
    });

    it("skips entries with no field alias", () => {
      const maps = parseOverrideConfigs([{ config: [{ type: "alignment", value: "left" }] }]);
      expect(maps.styleConfigMap).toEqual({});
    });

    it("leaves unitConfigMap untouched when a column has no unit item (unit='Default')", () => {
      // Picking the 'Default' unit drops the unit config item entirely (the
      // serializer's `if (c.unit)` guard), so no unitConfigMap key is created.
      // The renderer's `if (unitConfigMap[alias]) … else panel unit` then falls
      // back to the panel-level unit — the column inherits it (e.g. rupee)
      // instead of forcing 'no unit', exactly like a brand-new field.
      const maps = parseOverrideConfigs([
        {
          field: { value: "amount" },
          config: [{ type: OVERRIDE_CONFIG_TYPES.ALIGNMENT, value: "right" }],
        },
      ]);
      expect("amount" in maps.unitConfigMap).toBe(false);
      expect(maps.unitConfigMap.amount).toBeUndefined();
    });
  });

  describe("applyColumnOverrides", () => {
    const maps = parseOverrideConfigs([
      {
        field: { value: "c" },
        config: [
          { type: "alignment", value: "center" },
          { type: "unique_value_color", autoColor: true },
          { type: "text_color", value: "#111" },
          { type: "background_color", value: "#eee" },
          { type: "conditional_styles", rules: [{ operator: ">", threshold: 5 }] },
        ],
      },
    ]);

    it("applies all override props onto the column object", () => {
      const col: any = {};
      applyColumnOverrides(col, "c", maps, "right");
      expect(col.align).toBe("center"); // override beats default
      expect(col.colorMode).toBe("auto");
      expect(col.textColor).toBe("#111");
      expect(col.bgColor).toBe("#eee");
      expect(col.conditionalRules).toHaveLength(1);
    });

    it("falls back to the default alignment when none is set", () => {
      const col: any = {};
      applyColumnOverrides(col, "missing", maps, "right");
      expect(col.align).toBe("right");
      expect(col.colorMode).toBeUndefined();
    });
  });

  describe("formatNumericValue", () => {
    it("returns the missing-value placeholder for null/undefined/empty", () => {
      expect(formatNumericValue(null, null, "", "", 2)).toBe("");
      expect(formatNumericValue(undefined, null, "", "", 2)).toBe("");
      expect(formatNumericValue("", null, "", "", 2)).toBe("");
      expect(formatNumericValue(null, null, "", "", 2, "N/A")).toBe("N/A");
    });

    it("value mapping wins over numeric formatting", () => {
      const cache = buildValueMappingCache([
        { type: "value", value: "5", text: "five" },
      ]);
      expect(formatNumericValue(5, cache, "bytes", "", 2)).toBe("five");
    });

    it("formats a plain number to a non-empty string", () => {
      const out = formatNumericValue(5, null, "", "", 2);
      expect(typeof out).toBe("string");
      expect(out).toContain("5");
    });
  });

  describe("OVERRIDE_CONFIG_TYPES", () => {
    it("matches the persisted discriminants", () => {
      expect(OVERRIDE_CONFIG_TYPES).toEqual({
        UNIT: "unit",
        UNIQUE_VALUE_COLOR: "unique_value_color",
        ALIGNMENT: "alignment",
        TEXT_COLOR: "text_color",
        BACKGROUND_COLOR: "background_color",
        CONDITIONAL_STYLES: "conditional_styles",
        FIELD_TYPE: "field_type",
      });
    });
  });

  describe("resolveIsNumber", () => {
    it("keeps the detected value for 'auto'/absent", () => {
      expect(resolveIsNumber(true, "auto")).toBe(true);
      expect(resolveIsNumber(false, "auto")).toBe(false);
      expect(resolveIsNumber(true, undefined)).toBe(true);
      expect(resolveIsNumber(false, undefined)).toBe(false);
    });
    it("forces numeric/text regardless of detection", () => {
      expect(resolveIsNumber(false, "num")).toBe(true);
      expect(resolveIsNumber(true, "text")).toBe(false);
    });
  });

  describe("parseOverrideConfigs field type", () => {
    it("populates fieldTypeMap from a field_type item", () => {
      const maps = parseOverrideConfigs([
        {
          field: { value: "Amount" },
          config: [{ type: OVERRIDE_CONFIG_TYPES.FIELD_TYPE, value: "text" }],
        },
      ]);
      expect(maps.fieldTypeMap.amount).toBe("text");
    });
  });
});
