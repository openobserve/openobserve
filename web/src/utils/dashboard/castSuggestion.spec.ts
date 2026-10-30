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

import { describe, expect, it } from "vitest";
import {
  CAST_TARGET_TYPES,
  DEFAULT_CAST_TARGET_TYPE,
  SAFE_CAST_FUNCTION,
  STRICT_CAST_FUNCTION,
  getCastSeverity,
  isCastFunction,
  isCastTargetType,
  isTextFieldType,
  resolveFieldType,
  wrapArgInCast,
} from "@/utils/dashboard/castSuggestion";

const groupedFields = [
  {
    name: "aws_cost_cur",
    stream_alias: null,
    schema: [
      { name: "lineitem_usageamount", type: "Utf8" },
      { name: "lineitem_blendedcost", type: "Float64" },
    ],
  },
  {
    name: "accounts",
    stream_alias: "a",
    schema: [{ name: "lineitem_usageamount", type: "Int64" }],
  },
];

describe("castSuggestion", () => {
  describe("isTextFieldType", () => {
    it("recognises the text arrow types", () => {
      expect(isTextFieldType("Utf8")).toBe(true);
      expect(isTextFieldType("LargeUtf8")).toBe(true);
      expect(isTextFieldType("Utf8View")).toBe(true);
    });

    it("rejects numeric types and nullish input", () => {
      expect(isTextFieldType("Float64")).toBe(false);
      expect(isTextFieldType("Int64")).toBe(false);
      expect(isTextFieldType(null)).toBe(false);
      expect(isTextFieldType(undefined)).toBe(false);
    });
  });

  describe("resolveFieldType", () => {
    it("resolves a field on the unaliased stream", () => {
      expect(resolveFieldType(groupedFields, { field: "lineitem_usageamount" })).toBe("Utf8");
    });

    it("prefers the stream matching the alias", () => {
      expect(
        resolveFieldType(groupedFields, { field: "lineitem_usageamount", streamAlias: "a" }),
      ).toBe("Int64");
    });

    it("does not read the column off an unrelated stream", () => {
      // An alias naming no loaded stream must yield nothing, not the first
      // same-named column from some other join.
      expect(
        resolveFieldType(groupedFields, { field: "lineitem_blendedcost", streamAlias: "zz" }),
      ).toBeNull();
    });

    it("keeps the two streams' same-named columns apart", () => {
      expect(resolveFieldType(groupedFields, { field: "lineitem_usageamount" })).toBe("Utf8");
      expect(
        resolveFieldType(groupedFields, { field: "lineitem_usageamount", streamAlias: "a" }),
      ).toBe("Int64");
    });

    it("returns null when the schema has not loaded or the field is unknown", () => {
      expect(resolveFieldType(undefined, { field: "lineitem_usageamount" })).toBeNull();
      expect(resolveFieldType(groupedFields, { field: "missing" })).toBeNull();
      expect(resolveFieldType(groupedFields, {})).toBeNull();
    });
  });

  describe("getCastSeverity", () => {
    it("flags numeric aggregations on a text field as an error", () => {
      for (const fn of ["sum", "avg", "p50", "p95", "p99", "median", "stddev"]) {
        expect(getCastSeverity(fn, "Utf8")).toBe("error");
      }
    });

    it("never flags min or max — text is a legitimate argument for them", () => {
      // max(hostname) is an ordinary query, and nothing here can tell a text
      // column of numbers from a column of words.
      expect(getCastSeverity("min", "Utf8")).toBeNull();
      expect(getCastSeverity("max", "Utf8")).toBeNull();
    });

    it("flags the wider numeric families too", () => {
      for (const fn of ["corr", "bit_and", "sin", "degrees", "factorial", "iszero"]) {
        expect(getCastSeverity(fn, "Utf8")).toBe("error");
      }
    });

    it("stays silent for numeric fields, count, and unknown functions", () => {
      expect(getCastSeverity("sum", "Float64")).toBeNull();
      expect(getCastSeverity("count", "Utf8")).toBeNull();
      expect(getCastSeverity("lower", "Utf8")).toBeNull();
      expect(getCastSeverity(null, "Utf8")).toBeNull();
    });

    it("stays silent when the field type is unknown", () => {
      expect(getCastSeverity("sum", null)).toBeNull();
    });

    it("does not suggest a cast on top of a cast", () => {
      expect(getCastSeverity(SAFE_CAST_FUNCTION, "Utf8")).toBeNull();
      expect(getCastSeverity(STRICT_CAST_FUNCTION, "Utf8")).toBeNull();
    });
  });

  describe("isCastFunction / isCastTargetType", () => {
    it("identifies both cast functions", () => {
      expect(isCastFunction("try_cast")).toBe(true);
      expect(isCastFunction("cast")).toBe(true);
      expect(isCastFunction("sum")).toBe(false);
      expect(isCastFunction(null)).toBe(false);
    });

    it("accepts only the offered target types", () => {
      for (const target of CAST_TARGET_TYPES) {
        expect(isCastTargetType(target)).toBe(true);
      }
      expect(isCastTargetType("VARCHAR")).toBe(false);
      expect(isCastTargetType("DOUBLE); DROP TABLE x --")).toBe(false);
      expect(isCastTargetType(undefined)).toBe(false);
    });
  });

  describe("wrapArgInCast", () => {
    it("nests the original argument under a safe cast by default", () => {
      const arg = { type: "field", value: { field: "lineitem_usageamount" } };

      expect(wrapArgInCast(arg)).toEqual({
        type: "function",
        value: {
          functionName: SAFE_CAST_FUNCTION,
          args: [
            { type: "field", value: { field: "lineitem_usageamount" } },
            { type: "castType", value: DEFAULT_CAST_TARGET_TYPE },
          ],
        },
      });
    });

    it("honours an explicit target type and cast function", () => {
      const arg = { type: "field", value: { field: "count_col" } };
      const wrapped: any = wrapArgInCast(arg, "BIGINT", STRICT_CAST_FUNCTION);

      expect(wrapped.value.functionName).toBe(STRICT_CAST_FUNCTION);
      expect(wrapped.value.args[1]).toEqual({ type: "castType", value: "BIGINT" });
    });

    it("wraps a nested function argument too", () => {
      const arg = { type: "function", value: { functionName: "lower", args: [] } };
      const wrapped: any = wrapArgInCast(arg);

      expect(wrapped.value.args[0]).toEqual(arg);
    });
  });
});
