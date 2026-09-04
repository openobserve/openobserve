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
  emptyColumnOverride,
  emptyConditionalRule,
  serializeColumnOverride,
  serializeOverrides,
  loadAllFromRaw,
  type ColumnOverrideUI,
} from "./useColumnFormatting";

describe("useColumnFormatting", () => {
  describe("empty factories", () => {
    it("emptyColumnOverride has the expected blank shape", () => {
      expect(emptyColumnOverride("alias")).toEqual({
        field: "alias",
        fieldType: "auto",
        unit: null,
        customUnit: null,
        alignment: null,
        textColor: null,
        bgColor: null,
        autoColor: false,
        conditions: [],
      });
    });
    it("emptyConditionalRule is a blank rule", () => {
      expect(emptyConditionalRule()).toEqual({
        operator: "<",
        threshold: "",
        textColor: null,
        bgColor: null,
      });
    });
  });

  describe("serializeColumnOverride", () => {
    it("returns null when there is no field selected", () => {
      expect(serializeColumnOverride(emptyColumnOverride(""))).toBeNull();
    });

    it("persists an added field with all-default controls (empty config)", () => {
      // A column the user explicitly added but left at default values must still
      // persist (empty config) so it reappears when the dialog is reopened.
      const allNone: ColumnOverrideUI = {
        field: "x",
        fieldType: "auto", // detect
        unit: null, // "Default"
        customUnit: null,
        alignment: null, // "None"
        textColor: null, // None swatch
        bgColor: null, // None swatch
        autoColor: false, // toggle off
        conditions: [], // all rules removed
      };
      const entry = serializeColumnOverride(allNone);
      expect(entry).toEqual({
        field: { matchBy: "name", value: "x" },
        config: [],
      });
      // …and the whole-array path keeps it.
      expect(serializeOverrides([allNone])).toEqual([entry]);
    });

    it("serializes a forced field type but omits 'auto'", () => {
      // 'auto' adds no config item, but the field still persists (empty config).
      expect(serializeColumnOverride({ ...emptyColumnOverride("x"), fieldType: "auto" })).toEqual({
        field: { matchBy: "name", value: "x" },
        config: [],
      });
      const num = serializeColumnOverride({ ...emptyColumnOverride("x"), fieldType: "num" });
      expect(num.config).toEqual([{ type: "field_type", value: "num" }]);
      const text = serializeColumnOverride({ ...emptyColumnOverride("x"), fieldType: "text" });
      expect(text.config).toEqual([{ type: "field_type", value: "text" }]);
    });

    it("persists the unit (no longer gated on numeric-ness)", () => {
      const col = { ...emptyColumnOverride("x"), unit: "bytes" };
      const entry = serializeColumnOverride(col);
      expect(entry.config).toEqual([{ type: "unit", value: { unit: "bytes", customUnit: null } }]);
    });

    it("drops conditional rules with a blank/non-numeric threshold or no operator", () => {
      const col: ColumnOverrideUI = {
        ...emptyColumnOverride("x"),
        conditions: [
          { operator: ">", threshold: "", textColor: "", bgColor: "" }, // no threshold
          { operator: "", threshold: "5", textColor: "", bgColor: "" }, // no operator
          { operator: "<", threshold: "abc", textColor: "", bgColor: "" }, // NaN threshold
          { operator: ">=", threshold: "9", textColor: "#f00", bgColor: "" }, // valid
        ],
      };
      const entry = serializeColumnOverride(col);
      const cond = entry.config.find((c: any) => c.type === "conditional_styles");
      expect(cond.rules).toHaveLength(1);
      expect(cond.rules[0]).toEqual({
        operator: ">=",
        threshold: 9, // always a finite number, never NaN/null
        textColor: "#f00",
        bgColor: "",
      });
    });

    it("omits the conditional_styles entry entirely when no rule is valid", () => {
      const col: ColumnOverrideUI = {
        ...emptyColumnOverride("x"),
        unit: "bytes", // some other formatting so the entry isn't null overall
        conditions: [
          { operator: "<", threshold: "abc", textColor: "#f00", bgColor: "" }, // NaN
          { operator: "", threshold: "5", textColor: "", bgColor: "" }, // no operator
        ],
      };
      const entry = serializeColumnOverride(col);
      expect(entry.config.some((c: any) => c.type === "conditional_styles")).toBe(false);
    });
  });

  describe("round-trip (serialize → load)", () => {
    it("losslessly round-trips a fully-populated numeric column", () => {
      const original: ColumnOverrideUI = {
        field: "count",
        fieldType: "num",
        unit: "bytes",
        customUnit: "",
        alignment: "center",
        textColor: "#111827",
        bgColor: "#f3f4f6",
        autoColor: true,
        conditions: [{ operator: ">=", threshold: "90", textColor: "#b91c1c", bgColor: "#fef2f2" }],
      };
      const entry = serializeColumnOverride(original);
      expect(entry.field).toEqual({ matchBy: "name", value: "count" });

      const loaded = loadAllFromRaw([entry])[0];
      expect(loaded).toEqual(original);
    });

    it("round-trips a custom unit", () => {
      const original = {
        ...emptyColumnOverride("c"),
        unit: "custom",
        customUnit: "req/s",
      };
      const entry = serializeColumnOverride(original);
      expect(loadAllFromRaw([entry])[0]).toEqual(original);
    });
  });

  describe("loadAllFromRaw / serializeOverrides", () => {
    it("loads one UI row per column", () => {
      const raw = [
        serializeColumnOverride({ ...emptyColumnOverride("a"), alignment: "left" }),
        serializeColumnOverride({ ...emptyColumnOverride("b"), textColor: "#f00" }),
      ];
      const rows = loadAllFromRaw(raw);
      expect(rows.map((r) => r.field).sort()).toEqual(["a", "b"]);
    });

    it("serializeOverrides drops only field-less rows", () => {
      const cols: ColumnOverrideUI[] = [
        { ...emptyColumnOverride("num"), unit: "bytes" },
        { ...emptyColumnOverride("txt"), unit: "bytes" },
        emptyColumnOverride("kept"), // added field, default formatting → kept
        emptyColumnOverride(""), // no field selected → dropped
      ];
      const out = serializeOverrides(cols);
      expect(out).toHaveLength(3);
      expect(out.map((e: any) => e.field.value).sort()).toEqual(["kept", "num", "txt"]);
    });
  });
});
