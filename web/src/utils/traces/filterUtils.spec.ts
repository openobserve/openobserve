// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import {
  getFieldFromExpression,
  replaceExistingFieldCondition,
  applyFilterTerm,
  buildFilterTerm,
  removeFieldCondition,
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
      expect(getFieldFromExpression("  service_name='web'")).toBe("service_name");
    });
  });

  describe("parenthesized multi-value groups", () => {
    it("should extract field name from parenthesized OR group", () => {
      expect(getFieldFromExpression("(status='active' OR status='pending')")).toBe("status");
    });

    it("should extract field name from parenthesized AND group", () => {
      expect(getFieldFromExpression("(status='active' AND status='ok')")).toBe("status");
    });

    it("should strip leading parenthesis and whitespace before matching", () => {
      expect(getFieldFromExpression("( env='prod' OR env='staging')")).toBe("env");
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
      const result = replaceExistingFieldCondition("status='active'", "status", "status='pending'");
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
      const result = replaceExistingFieldCondition("STATUS='active'", "STATUS", "STATUS='pending'");
      expect(result).toBe("STATUS='pending'");
    });

    it("should replace a condition with a numeric value", () => {
      const result = replaceExistingFieldCondition("code=200", "code", "code=404");
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
      const result = replaceExistingFieldCondition("is_error=true", "is_error", "is_error=false");
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
      const result = replaceExistingFieldCondition("env='prod'", "status", "status='active'");
      expect(result).toBeNull();
    });

    it("should return null for an empty query string", () => {
      const result = replaceExistingFieldCondition("", "status", "status='active'");
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
      const result = applyFilterTerm("status='error'", "env='prod'");
      expect(result).toBe("env='prod' and status='error'");
    });

    it("should replace a parenthesized multi-value group with the new filter", () => {
      const result = applyFilterTerm("status='ok'", "(status='active' OR status='pending')");
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
      expect(result).toBe("env='prod' and some_value");
    });
  });

  describe("base value containing a pipe inside a quoted term", () => {
    // The whole base value is the where clause. A pipe inside a quoted search term
    // (e.g. match_all('text | error')) must survive untouched — it is part of the
    // term the user is matching on, not a clause separator.

    it("should append the filter after a match_all term containing a pipe", () => {
      const result = applyFilterTerm("code=200", "match_all('text | error')");
      expect(result).toBe("match_all('text | error') and code=200");
    });

    it("should leave a match_all term with several pipes byte-for-byte intact", () => {
      const result = applyFilterTerm("code=200", "match_all('a | b | c')");
      expect(result).toBe("match_all('a | b | c') and code=200");
    });

    it("should replace an existing condition without disturbing the piped term", () => {
      const result = applyFilterTerm("status='error'", "match_all('a | b') and status='active'");
      expect(result).toBe("match_all('a | b') and status='error'");
    });

    it("should normalise a null filter appended after a piped term", () => {
      const result = applyFilterTerm("error_code='null'", "match_all('a | b')");
      expect(result).toBe("match_all('a | b') and error_code is null");
    });
  });
});

// ---------------------------------------------------------------------------
// buildFilterTerm
// ---------------------------------------------------------------------------

describe("buildFilterTerm", () => {
  describe("equality operator (default)", () => {
    it("should build an equality term for a plain string value", () => {
      expect(buildFilterTerm("service_name", "frontend")).toBe("service_name = 'frontend'");
    });

    it("should build an equality term when operator is explicitly '='", () => {
      expect(buildFilterTerm("env", "prod", "=")).toBe("env = 'prod'");
    });

    it("should escape single quotes in the value", () => {
      expect(buildFilterTerm("message", "it's done")).toBe("message = 'it''s done'");
    });

    it("should escape multiple single quotes in the value", () => {
      expect(buildFilterTerm("label", "it's a 'test'")).toBe("label = 'it''s a ''test'''");
    });
  });

  describe("not-equal operator", () => {
    it("should build a not-equal term for a plain string value", () => {
      expect(buildFilterTerm("status", "error", "!=")).toBe("status != 'error'");
    });

    it("should escape single quotes in a not-equal term", () => {
      expect(buildFilterTerm("message", "can't fail", "!=")).toBe("message != 'can''t fail'");
    });
  });

  describe("null value handling", () => {
    it("should produce IS NULL when value is the string 'null' and operator is '='", () => {
      expect(buildFilterTerm("error_code", "null")).toBe("error_code is null");
    });

    it("should produce IS NOT NULL when value is the string 'null' and operator is '!='", () => {
      expect(buildFilterTerm("error_code", "null", "!=")).toBe("error_code is not null");
    });

    it("should produce IS NULL when value is actually null and operator is '='", () => {
      // The function signature accepts string but the implementation handles JS null
      expect(buildFilterTerm("error_code", null as unknown as string)).toBe("error_code is null");
    });

    it("should produce IS NOT NULL when value is actually null and operator is '!='", () => {
      expect(buildFilterTerm("error_code", null as unknown as string, "!=")).toBe(
        "error_code is not null",
      );
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

// ---------------------------------------------------------------------------
// removeFieldCondition
// ---------------------------------------------------------------------------

describe("removeFieldCondition", () => {
  describe("comparison operators", () => {
    it("should remove an equality condition", () => {
      expect(removeFieldCondition("brand='Apple'", "brand")).toBe("");
    });

    it("should remove a not-equal condition", () => {
      expect(removeFieldCondition("brand!='Apple'", "brand")).toBe("");
    });

    it("should remove only the targeted field and keep the rest", () => {
      expect(removeFieldCondition("brand='Apple' AND env='prod'", "brand")).toBe("env='prod'");
    });

    it("should leave the query unchanged when the field is absent", () => {
      expect(removeFieldCondition("env='prod'", "brand")).toBe("env='prod'");
    });
  });

  describe("IS NULL / IS NOT NULL conditions", () => {
    // Regression: unchecking a null value emits remove-field, which must strip
    // the `IS NULL` / `IS NOT NULL` condition it produced. The old regex only
    // matched [=!<>] so these conditions lingered in the editor.
    it("should remove an IS NULL condition", () => {
      expect(
        removeFieldCondition("user_agent_device_brand IS NULL", "user_agent_device_brand"),
      ).toBe("");
    });

    it("should remove an IS NOT NULL condition", () => {
      expect(
        removeFieldCondition("user_agent_device_brand IS NOT NULL", "user_agent_device_brand"),
      ).toBe("");
    });

    it("should remove an IS NULL condition while keeping other conditions", () => {
      expect(removeFieldCondition("brand IS NULL AND env='prod'", "brand")).toBe("env='prod'");
    });

    it("should remove a lowercase 'is null' condition", () => {
      expect(removeFieldCondition("brand is null", "brand")).toBe("");
    });

    it("should remove a parenthesized group that starts with IS NULL", () => {
      expect(removeFieldCondition("(brand IS NULL or brand='Apple')", "brand")).toBe("");
    });

    it("should not remove a different field whose name is a prefix", () => {
      expect(removeFieldCondition("brand_name IS NULL", "brand")).toBe("brand_name IS NULL");
    });
  });

  describe("queries containing a pipe inside a quoted term", () => {
    it("should remove a condition that sits after a piped match_all term", () => {
      expect(removeFieldCondition("match_all('text | error') AND code=200", "code")).toBe(
        "match_all('text | error')",
      );
    });

    it("should remove a condition that sits before a piped match_all term", () => {
      expect(removeFieldCondition("code=200 AND match_all('a | b')", "code")).toBe(
        "match_all('a | b')",
      );
    });

    it("should leave the piped term intact when the target field is absent", () => {
      expect(removeFieldCondition("match_all('a | b')", "code")).toBe("match_all('a | b')");
    });
  });
});
