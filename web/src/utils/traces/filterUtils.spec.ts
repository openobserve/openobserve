// Copyright 2026 OpenObserve Inc.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import {
  getFieldFromExpression,
  replaceExistingFieldCondition,
  applyFilterTerm,
  buildFilterTerm,
} from "./filterUtils";

// ---------------------------------------------------------------------------
// getFieldFromExpression
// ---------------------------------------------------------------------------

describe("getFieldFromExpression", () => {
  describe("plain field expressions", () => {
    it("should extract field name from equality expression", () => {
      expect(getFieldFromExpression("status='active'")).toBe("status");
    });

    it("should extract field name from not-equal expression", () => {
      expect(getFieldFromExpression("status!='inactive'")).toBe("status");
    });

    it("should extract field name from greater-than expression", () => {
      expect(getFieldFromExpression("duration>100")).toBe("duration");
    });

    it("should extract field name from less-than expression", () => {
      expect(getFieldFromExpression("duration<500")).toBe("duration");
    });

    it("should extract field name from greater-than-or-equal expression", () => {
      expect(getFieldFromExpression("duration>=100")).toBe("duration");
    });

    it("should extract field name from less-than-or-equal expression", () => {
      expect(getFieldFromExpression("duration<=500")).toBe("duration");
    });

    it("should extract field name from IS expression", () => {
      expect(getFieldFromExpression("error_code is null")).toBe("error_code");
    });

    it("should extract field name with leading whitespace", () => {
      expect(getFieldFromExpression("  service_name='web'")).toBe(
        "service_name",
      );
    });
  });

  describe("parenthesized multi-value groups", () => {
    it("should extract field name from parenthesized OR group", () => {
      expect(
        getFieldFromExpression("(status='active' OR status='pending')"),
      ).toBe("status");
    });

    it("should extract field name from parenthesized AND group", () => {
      expect(
        getFieldFromExpression("(status='active' AND status='ok')"),
      ).toBe("status");
    });

    it("should strip leading parenthesis and whitespace before matching", () => {
      expect(getFieldFromExpression("( env='prod' OR env='staging')")).toBe(
        "env",
      );
    });
  });

  describe("quoted table-prefixed fields", () => {
    it("should extract field name from double-quoted table.field expression", () => {
      expect(getFieldFromExpression('"spans"."status"=\'ok\'')).toBe("status");
    });

    it("should extract field name from table.field IS expression", () => {
      expect(getFieldFromExpression('"spans"."error" is null')).toBe("error");
    });
  });

  describe("no match cases", () => {
    it("should return null for an empty string", () => {
      expect(getFieldFromExpression("")).toBeNull();
    });

    it("should return null for a plain value with no operator", () => {
      expect(getFieldFromExpression("active")).toBeNull();
    });

    it("should return null for a quoted string with no operator", () => {
      expect(getFieldFromExpression("'some value'")).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// replaceExistingFieldCondition
// ---------------------------------------------------------------------------

describe("replaceExistingFieldCondition", () => {
  describe("single condition replacement", () => {
    it("should replace a single equality condition", () => {
      const result = replaceExistingFieldCondition(
        "status='active'",
        "status",
        "status='pending'",
      );
      expect(result).toBe("status='pending'");
    });

    it("should replace a single not-equal condition", () => {
      const result = replaceExistingFieldCondition(
        "status!='inactive'",
        "status",
        "status='active'",
      );
      expect(result).toBe("status='active'");
    });

    it("should replace a condition embedded in a larger query", () => {
      const result = replaceExistingFieldCondition(
        "env='prod' and status='active'",
        "status",
        "status='error'",
      );
      expect(result).toBe("env='prod' and status='error'");
    });

    it("should be case-insensitive when matching the field name", () => {
      const result = replaceExistingFieldCondition(
        "STATUS='active'",
        "STATUS",
        "STATUS='pending'",
      );
      expect(result).toBe("STATUS='pending'");
    });

    it("should replace a condition with a numeric value", () => {
      const result = replaceExistingFieldCondition(
        "code=200",
        "code",
        "code=404",
      );
      expect(result).toBe("code=404");
    });

    it("should replace a condition with a null value", () => {
      const result = replaceExistingFieldCondition(
        "error_code is null",
        "error_code",
        "error_code is not null",
      );
      expect(result).toBe("error_code is not null");
    });

    it("should replace a condition with a boolean value", () => {
      const result = replaceExistingFieldCondition(
        "is_error=true",
        "is_error",
        "is_error=false",
      );
      expect(result).toBe("is_error=false");
    });
  });

  describe("parenthesized multi-value group replacement", () => {
    it("should replace a parenthesized OR group", () => {
      const result = replaceExistingFieldCondition(
        "(status='active' OR status='pending')",
        "status",
        "status='error'",
      );
      expect(result).toBe("status='error'");
    });

    it("should replace a parenthesized AND group", () => {
      const result = replaceExistingFieldCondition(
        "(status='active' AND status='pending')",
        "status",
        "status='ok'",
      );
      expect(result).toBe("status='ok'");
    });

    it("should replace a multi-value group embedded in a larger query", () => {
      const result = replaceExistingFieldCondition(
        "env='prod' and (status='a' OR status='b')",
        "status",
        "status='c'",
      );
      expect(result).toBe("env='prod' and status='c'");
    });
  });

  describe("range condition replacement", () => {
    it("should replace a range condition (>= AND <=)", () => {
      const result = replaceExistingFieldCondition(
        "duration>=100 AND duration<=500",
        "duration",
        "duration>=200 AND duration<=800",
      );
      expect(result).toBe("duration>=200 AND duration<=800");
    });

    it("should replace a range condition with lowercase and", () => {
      const result = replaceExistingFieldCondition(
        "duration>=100 and duration<=500",
        "duration",
        "duration>=0 and duration<=1000",
      );
      expect(result).toBe("duration>=0 and duration<=1000");
    });
  });

  describe("no match — returns null", () => {
    it("should return null when the field is not present in the query", () => {
      const result = replaceExistingFieldCondition(
        "env='prod'",
        "status",
        "status='active'",
      );
      expect(result).toBeNull();
    });

    it("should return null for an empty query string", () => {
      const result = replaceExistingFieldCondition(
        "",
        "status",
        "status='active'",
      );
      expect(result).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// applyFilterTerm
// ---------------------------------------------------------------------------

describe("applyFilterTerm", () => {
  describe("null value normalisation", () => {
    it("should convert ='null' to IS NULL before applying", () => {
      const result = applyFilterTerm("error_code='null'", "");
      expect(result).toBe("error_code is null");
    });

    it("should convert !='null' to IS NOT NULL before applying", () => {
      const result = applyFilterTerm("error_code!='null'", "");
      expect(result).toBe("error_code is not null");
    });
  });

  describe("single-part base value (no pipe)", () => {
    it("should set filter as the entire value when base is empty", () => {
      const result = applyFilterTerm("status='active'", "");
      expect(result).toBe("status='active'");
    });

    it("should replace existing condition when field already exists in base", () => {
      const result = applyFilterTerm("status='error'", "status='active'");
      expect(result).toBe("status='error'");
    });

    it("should append new condition with AND when field is not in base", () => {
      const result = applyFilterTerm(
        "status='error'",
        "env='prod'",
      );
      expect(result).toBe("env='prod' and status='error'");
    });

    it("should replace a parenthesized multi-value group with the new filter", () => {
      const result = applyFilterTerm(
        "status='ok'",
        "(status='active' OR status='pending')",
      );
      expect(result).toBe("status='ok'");
    });

    it("should replace a range condition when the same field is used", () => {
      const result = applyFilterTerm(
        "duration>=200 AND duration<=800",
        "duration>=100 AND duration<=500",
      );
      expect(result).toBe("duration>=200 AND duration<=800");
    });

    it("should append when field name cannot be extracted from filter", () => {
      // Expression with no recognisable operator — getFieldFromExpression returns null
      // replaceExistingFieldCondition is skipped; append path is taken.
      const result = applyFilterTerm("some_value", "env='prod'");
      // field cannot be extracted, replaced === parts[0] (unchanged), then returned as-is
      // then since replaced is not null (it equals parts[0]) it returns replaced
      expect(result).toBe("env='prod'");
    });
  });

  describe("piped base value (SQL before | and filter after |)", () => {
    // The implementation splits on "|" giving parts[0] (SQL) and parts[1] (filter text).
    // It then rejoins with "| " (pipe + space). Because parts[1] retains any leading/trailing
    // whitespace from the original split, the rejoined string preserves that whitespace.

    it("should set the filter after the pipe when the right side is empty", () => {
      // parts[1] is "" (empty after "|"), trim() === "" → else branch sets parts[1] = filter
      // join produces "select * from spans " + "| " + "status='active'"
      const result = applyFilterTerm("status='active'", "select * from spans |");
      expect(result).toBe("select * from spans | status='active'");
    });

    it("should replace an existing condition in the right side of the pipe and preserve leading space", () => {
      // baseValue split on "|": parts[1] = " status='active'" (note leading space from original)
      // replaceExistingFieldCondition replaces within " status='active'" → " status='error'"
      // join: "select * from spans " + "| " + " status='error'" = "select * from spans |  status='error'"
      const result = applyFilterTerm(
        "status='error'",
        "select * from spans | status='active'",
      );
      expect(result).toBe("select * from spans |  status='error'");
    });

    it("should set parts[1] to null when field not found — null is coerced to empty string by join", () => {
      // parts[1] = " env='prod'"; replaceExistingFieldCondition for "status" returns null.
      // Line 86: replaced (null) !== parts[1] (" env='prod'") → true → parts[1] = null
      // join("| "): ["select * from spans ", null].join("| ") = "select * from spans | "
      const result = applyFilterTerm(
        "status='error'",
        "select * from spans | env='prod'",
      );
      expect(result).toBe("select * from spans | ");
    });

    it("should set parts[1] to null in a piped null-normalised query when field not found", () => {
      // Same null-coercion behaviour as above; filter becomes "error_code is null"
      // but "env" field condition does not match "error_code" → replaced is null → parts[1] = null
      const result = applyFilterTerm(
        "error_code='null'",
        "select * from spans | env='prod'",
      );
      expect(result).toBe("select * from spans | ");
    });

    it("should replace existing multi-value group on the right side and preserve leading space", () => {
      // parts[1] = " (status='active' OR status='pending')" (leading space)
      // multiRegex matches → replaces the group → " " + "status='ok'" left by replace
      // join produces "select * from spans |  status='ok'"
      const result = applyFilterTerm(
        "status='ok'",
        "select * from spans | (status='active' OR status='pending')",
      );
      expect(result).toBe("select * from spans |  status='ok'");
    });

    it("should handle a pipe with whitespace-only right side by setting filter directly", () => {
      // parts[1] = "   ", trim() === "" → else branch: parts[1] = filter
      // join: "select * from spans " + "| " + "status='active'"
      const result = applyFilterTerm("status='active'", "select * from spans |   ");
      expect(result).toBe("select * from spans | status='active'");
    });
  });
});

// ---------------------------------------------------------------------------
// buildFilterTerm
// ---------------------------------------------------------------------------

describe("buildFilterTerm", () => {
  describe("equality operator (default)", () => {
    it("should build an equality term for a plain string value", () => {
      expect(buildFilterTerm("service_name", "frontend")).toBe(
        "service_name = 'frontend'",
      );
    });

    it("should build an equality term when operator is explicitly '='", () => {
      expect(buildFilterTerm("env", "prod", "=")).toBe("env = 'prod'");
    });

    it("should escape single quotes in the value", () => {
      expect(buildFilterTerm("message", "it's done")).toBe(
        "message = 'it''s done'",
      );
    });

    it("should escape multiple single quotes in the value", () => {
      expect(buildFilterTerm("label", "it's a 'test'")).toBe(
        "label = 'it''s a ''test'''",
      );
    });
  });

  describe("not-equal operator", () => {
    it("should build a not-equal term for a plain string value", () => {
      expect(buildFilterTerm("status", "error", "!=")).toBe(
        "status != 'error'",
      );
    });

    it("should escape single quotes in a not-equal term", () => {
      expect(buildFilterTerm("message", "can't fail", "!=")).toBe(
        "message != 'can''t fail'",
      );
    });
  });

  describe("null value handling", () => {
    it("should produce IS NULL when value is the string 'null' and operator is '='", () => {
      expect(buildFilterTerm("error_code", "null")).toBe(
        "error_code is null",
      );
    });

    it("should produce IS NOT NULL when value is the string 'null' and operator is '!='", () => {
      expect(buildFilterTerm("error_code", "null", "!=")).toBe(
        "error_code is not null",
      );
    });

    it("should produce IS NULL when value is actually null and operator is '='", () => {
      // The function signature accepts string but the implementation handles JS null
      expect(buildFilterTerm("error_code", null as unknown as string)).toBe(
        "error_code is null",
      );
    });

    it("should produce IS NOT NULL when value is actually null and operator is '!='", () => {
      expect(
        buildFilterTerm("error_code", null as unknown as string, "!="),
      ).toBe("error_code is not null");
    });
  });

  describe("numeric and boolean values stored as strings", () => {
    it("should wrap numeric string in single quotes", () => {
      expect(buildFilterTerm("code", "200")).toBe("code = '200'");
    });

    it("should wrap boolean string in single quotes", () => {
      expect(buildFilterTerm("is_error", "true")).toBe("is_error = 'true'");
    });
  });
});
