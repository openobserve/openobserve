import { describe, it, expect } from "vitest";
import { buildConditionsString, isUnaryOperator } from "./conditionsFormatter";
import type { StreamFieldsMap } from "./alertQueryBuilder";

describe("conditionsFormatter", () => {
  const streamFieldsMap: StreamFieldsMap = {
    age: { label: "age", value: "age", type: "Int64" },
    name: { label: "name", value: "name", type: "String" },
    city: { label: "city", value: "city", type: "String" },
  };

  describe("isUnaryOperator", () => {
    it("matches the canonical spellings and the serde aliases", () => {
      expect(isUnaryOperator("is_null")).toBe(true);
      expect(isUnaryOperator("is_not_null")).toBe(true);
      expect(isUnaryOperator("is_empty")).toBe(true);
      expect(isUnaryOperator("is_not_empty")).toBe(true);
      expect(isUnaryOperator("IsNull")).toBe(true);
      expect(isUnaryOperator("IsNotEmpty")).toBe(true);
      expect(isUnaryOperator("=")).toBe(false);
      expect(isUnaryOperator("Contains")).toBe(false);
      expect(isUnaryOperator(undefined)).toBe(false);
    });

    it("does not match inherited object properties", () => {
      expect(isUnaryOperator("constructor")).toBe(false);
      expect(isUnaryOperator("__proto__")).toBe(false);
      expect(isUnaryOperator("toString")).toBe(false);
    });
  });

  describe("buildConditionsString", () => {
    it("generates display format (lowercase operators, no WHERE)", () => {
      const group = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          {
            filterType: "condition",
            column: "age",
            operator: ">",
            value: 30,
            logicalOperator: "AND",
          },
          {
            filterType: "condition",
            column: "city",
            operator: "=",
            value: "delhi",
            logicalOperator: "AND",
          },
        ],
      };

      const result = buildConditionsString(group, {
        sqlMode: false,
        addWherePrefix: false,
        formatValues: false,
      });

      expect(result).toBe("age > '30' and city = 'delhi'");
    });

    it("generates SQL format (uppercase operators, with WHERE)", () => {
      const group = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          {
            filterType: "condition",
            column: "age",
            operator: ">",
            value: 30,
            logicalOperator: "AND",
          },
          {
            filterType: "condition",
            column: "city",
            operator: "=",
            value: "delhi",
            logicalOperator: "AND",
          },
        ],
      };

      const result = buildConditionsString(group, {
        sqlMode: true,
        addWherePrefix: true,
        formatValues: true,
        streamFieldsMap,
      });

      expect(result).toBe("WHERE age > 30 AND city = 'delhi'");
    });

    it("handles nested groups correctly in display mode", () => {
      const group = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          {
            filterType: "condition",
            column: "age",
            operator: ">",
            value: 30,
            logicalOperator: "AND",
          },
          {
            filterType: "group",
            logicalOperator: "AND",
            conditions: [
              {
                filterType: "condition",
                column: "city",
                operator: "=",
                value: "delhi",
                logicalOperator: "OR",
              },
              {
                filterType: "condition",
                column: "city",
                operator: "=",
                value: "mumbai",
                logicalOperator: "OR",
              },
            ],
          },
        ],
      };

      const result = buildConditionsString(group, {
        sqlMode: false,
        addWherePrefix: false,
        formatValues: false,
      });

      expect(result).toBe("age > '30' and (city = 'delhi' or city = 'mumbai')");
    });

    it("handles nested groups correctly in SQL mode", () => {
      const group = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          {
            filterType: "condition",
            column: "age",
            operator: ">",
            value: 30,
            logicalOperator: "AND",
          },
          {
            filterType: "group",
            logicalOperator: "AND",
            conditions: [
              {
                filterType: "condition",
                column: "city",
                operator: "=",
                value: "delhi",
                logicalOperator: "OR",
              },
              {
                filterType: "condition",
                column: "city",
                operator: "=",
                value: "mumbai",
                logicalOperator: "OR",
              },
            ],
          },
        ],
      };

      const result = buildConditionsString(group, {
        sqlMode: true,
        addWherePrefix: true,
        formatValues: true,
        streamFieldsMap,
      });

      expect(result).toBe("WHERE age > 30 AND (city = 'delhi' OR city = 'mumbai')");
    });

    it("handles contains operator in display mode", () => {
      const group = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          {
            filterType: "condition",
            column: "name",
            operator: "contains",
            value: "john",
            logicalOperator: "AND",
          },
        ],
      };

      const result = buildConditionsString(group, {
        sqlMode: false,
        addWherePrefix: false,
        formatValues: false,
      });

      expect(result).toBe("name contains 'john'");
    });

    it("handles contains operator in SQL mode (LIKE)", () => {
      const group = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          {
            filterType: "condition",
            column: "name",
            operator: "contains",
            value: "john",
            logicalOperator: "AND",
          },
        ],
      };

      const result = buildConditionsString(group, {
        sqlMode: true,
        addWherePrefix: true,
        formatValues: true,
        streamFieldsMap,
      });

      expect(result).toBe("WHERE name LIKE '%john%'");
    });

    it("handles Int64 type without quotes in SQL mode", () => {
      const group = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          {
            filterType: "condition",
            column: "age",
            operator: ">=",
            value: 25,
            logicalOperator: "AND",
          },
        ],
      };

      const result = buildConditionsString(group, {
        sqlMode: true,
        addWherePrefix: true,
        formatValues: true,
        streamFieldsMap,
      });

      expect(result).toBe("WHERE age >= 25");
    });

    it("handles String type with quotes in SQL mode", () => {
      const group = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          {
            filterType: "condition",
            column: "name",
            operator: "=",
            value: "Alice",
            logicalOperator: "AND",
          },
        ],
      };

      const result = buildConditionsString(group, {
        sqlMode: true,
        addWherePrefix: true,
        formatValues: true,
        streamFieldsMap,
      });

      expect(result).toBe("WHERE name = 'Alice'");
    });

    it("returns empty string for empty conditions", () => {
      const group = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [],
      };

      const result = buildConditionsString(group, {
        sqlMode: true,
        addWherePrefix: true,
        formatValues: true,
        streamFieldsMap,
      });

      expect(result).toBe("");
    });

    it("handles not_contains operator in SQL mode", () => {
      const group = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          {
            filterType: "condition",
            column: "name",
            operator: "not_contains",
            value: "test",
            logicalOperator: "AND",
          },
        ],
      };

      const result = buildConditionsString(group, {
        sqlMode: true,
        addWherePrefix: true,
        formatValues: true,
        streamFieldsMap,
      });

      expect(result).toBe("WHERE name NOT LIKE '%test%'");
    });

    it("handles null-check operators without a value", () => {
      const group = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          {
            filterType: "condition",
            column: "name",
            operator: "is_null",
            value: "",
            logicalOperator: "AND",
          },
          {
            filterType: "condition",
            column: "city",
            operator: "is_not_null",
            logicalOperator: "AND",
          },
        ],
      };

      expect(
        buildConditionsString(group, {
          sqlMode: true,
          addWherePrefix: true,
          formatValues: true,
          streamFieldsMap,
        }),
      ).toBe("WHERE name IS NULL AND city IS NOT NULL");

      expect(buildConditionsString(group, { sqlMode: false })).toBe(
        "name is null and city is not null",
      );
    });

    it("handles empty-check operators, degrading to null checks on numeric columns", () => {
      const group = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          {
            filterType: "condition",
            column: "name",
            operator: "is_empty",
            value: "",
            logicalOperator: "AND",
          },
          {
            filterType: "condition",
            column: "age",
            operator: "is_not_empty",
            logicalOperator: "AND",
          },
        ],
      };

      expect(
        buildConditionsString(group, {
          sqlMode: true,
          addWherePrefix: true,
          formatValues: true,
          streamFieldsMap,
        }),
      ).toBe("WHERE (name IS NULL OR name = '') AND age IS NOT NULL");

      expect(buildConditionsString(group, { sqlMode: false })).toBe(
        "name is empty and age is not empty",
      );
    });

    it("treats every known string type as string for empty checks", () => {
      const typedMap: StreamFieldsMap = {
        v: { label: "v", value: "v", type: "Utf8View" },
        n: { label: "n", value: "n", type: "Int32" },
      };
      const group = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          { filterType: "condition", column: "v", operator: "is_empty", logicalOperator: "AND" },
          { filterType: "condition", column: "n", operator: "is_empty", logicalOperator: "AND" },
        ],
      };

      expect(
        buildConditionsString(group, {
          sqlMode: true,
          formatValues: true,
          streamFieldsMap: typedMap,
        }),
      ).toBe("(v IS NULL OR v = '') AND n IS NULL");
    });

    it("handles mixed OR and AND operators", () => {
      const group = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          {
            filterType: "condition",
            column: "age",
            operator: ">",
            value: 18,
            logicalOperator: "AND",
          },
          {
            filterType: "condition",
            column: "age",
            operator: "<",
            value: 65,
            logicalOperator: "AND",
          },
          {
            filterType: "condition",
            column: "city",
            operator: "=",
            value: "NYC",
            logicalOperator: "OR",
          },
        ],
      };

      const result = buildConditionsString(group, {
        sqlMode: true,
        addWherePrefix: true,
        formatValues: true,
        streamFieldsMap,
      });

      expect(result).toBe("WHERE age > 18 AND age < 65 OR city = 'NYC'");
    });
  });
});
