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
  getFieldFromExpression,
  hasFieldCondition,
  replaceExistingFieldCondition,
} from "./filterUtils";

// ---------------------------------------------------------------------------
// Helper: mirrors the fixed non-SQL watcher logic so integrated scenarios
// can be tested without mounting SearchBar.vue.
// ---------------------------------------------------------------------------
function applyFilterToQuery(currentQuery: string, filter: string): string {
  const fieldName = getFieldFromExpression(filter);
  if (fieldName && hasFieldCondition(currentQuery, fieldName)) {
    return replaceExistingFieldCondition(currentQuery, fieldName, filter);
  }
  return currentQuery.length === 0
    ? filter
    : currentQuery + " and " + filter;
}

// ===========================================================================
// getFieldFromExpression
// ===========================================================================
describe("getFieldFromExpression", () => {
  it("should extract field name from a simple include expression", () => {
    expect(getFieldFromExpression("status = 'error'")).toBe("status");
  });

  it("should extract field name from a simple exclude expression", () => {
    expect(getFieldFromExpression("status != 'error'")).toBe("status");
  });

  it("should extract field name from a null-check include (is null)", () => {
    expect(getFieldFromExpression("status is null")).toBe("status");
  });

  it("should extract field name from a null-check exclude (is not null)", () => {
    expect(getFieldFromExpression("status is not null")).toBe("status");
  });

  it("should extract field name from a parenthesized multi-value group", () => {
    expect(
      getFieldFromExpression("(status = 'error' OR status = 'warning')"),
    ).toBe("status");
  });

  it("should extract field name from a SQL stream-prefixed expression", () => {
    expect(getFieldFromExpression('"my_stream".status = \'error\'')).toBe(
      "status",
    );
  });

  it("should extract field name from a numeric value expression", () => {
    expect(getFieldFromExpression("count = 42")).toBe("count");
  });

  it("should extract field name from a boolean expression", () => {
    expect(getFieldFromExpression("active is true")).toBe("active");
  });

  it("should return null for an empty string", () => {
    expect(getFieldFromExpression("")).toBeNull();
  });

  it("should return null for a string without an operator", () => {
    expect(getFieldFromExpression("just_a_word")).toBeNull();
  });
});

// ===========================================================================
// hasFieldCondition
// ===========================================================================
describe("hasFieldCondition", () => {
  it("should return true when a single include condition exists", () => {
    expect(hasFieldCondition("status = 'error'", "status")).toBe(true);
  });

  it("should return true when a single exclude condition exists", () => {
    expect(hasFieldCondition("status != 'error'", "status")).toBe(true);
  });

  it("should return true when a null-check condition exists", () => {
    expect(hasFieldCondition("status is null", "status")).toBe(true);
  });

  it("should return true when a multi-value group exists for the field", () => {
    expect(
      hasFieldCondition(
        "(status = 'error' OR status = 'warning')",
        "status",
      ),
    ).toBe(true);
  });

  it("should return true when the field appears within a larger query", () => {
    expect(
      hasFieldCondition("level = 'info' and status = 'error'", "status"),
    ).toBe(true);
  });

  it("should return false when the field is not present in the query", () => {
    expect(hasFieldCondition("level = 'info'", "status")).toBe(false);
  });

  it("should return false for an empty query string", () => {
    expect(hasFieldCondition("", "status")).toBe(false);
  });

  it("should return false when only unrelated fields are present", () => {
    expect(
      hasFieldCondition(
        "level = 'warn' and severity = 'high'",
        "status",
      ),
    ).toBe(false);
  });

  it("should return true for numeric value conditions", () => {
    expect(hasFieldCondition("count = 42", "count")).toBe(true);
  });
});

// ===========================================================================
// replaceExistingFieldCondition
// ===========================================================================
describe("replaceExistingFieldCondition", () => {
  it("should replace an existing include condition with a different value", () => {
    const result = replaceExistingFieldCondition(
      "status = 'error'",
      "status",
      "status = 'warning'",
    );
    expect(result).toBe("status = 'warning'");
  });

  it("should replace an existing include condition with the same value (key bug scenario)", () => {
    // Before the fix, calling include on the same value twice would cause the
    // replaced string to equal the original, making the caller think no match
    // was found and appending — producing "status = 'error' and status = 'error'".
    // replaceExistingFieldCondition itself returns the correct string; the bug
    // was in the caller deciding whether a match was found.
    const result = replaceExistingFieldCondition(
      "status = 'error'",
      "status",
      "status = 'error'",
    );
    // The result is the same string — hasFieldCondition must be used by the
    // caller to know a replacement was appropriate (i.e. do NOT append).
    expect(result).toBe("status = 'error'");
  });

  it("should replace an include condition with an exclude condition for the same field", () => {
    const result = replaceExistingFieldCondition(
      "status = 'error'",
      "status",
      "status != 'error'",
    );
    expect(result).toBe("status != 'error'");
  });

  it("should replace an exclude condition with an include condition for the same field", () => {
    const result = replaceExistingFieldCondition(
      "status != 'warning'",
      "status",
      "status = 'warning'",
    );
    expect(result).toBe("status = 'warning'");
  });

  it("should replace a multi-value group with a single condition", () => {
    const result = replaceExistingFieldCondition(
      "(status = 'error' OR status = 'warning')",
      "status",
      "status = 'critical'",
    );
    expect(result).toBe("status = 'critical'");
  });

  it("should replace a single condition with a multi-value group", () => {
    const result = replaceExistingFieldCondition(
      "status = 'error'",
      "status",
      "(status = 'error' OR status = 'warning')",
    );
    expect(result).toBe("(status = 'error' OR status = 'warning')");
  });

  it("should replace only the target field and preserve unrelated conditions", () => {
    const result = replaceExistingFieldCondition(
      "level = 'info' and status = 'error'",
      "status",
      "status = 'warning'",
    );
    expect(result).toBe("level = 'info' and status = 'warning'");
  });

  it("should return the original query when the field is not found", () => {
    const original = "level = 'info'";
    const result = replaceExistingFieldCondition(
      original,
      "status",
      "status = 'error'",
    );
    expect(result).toBe(original);
  });

  it("should replace a multi-value exclude group with a new expression", () => {
    const result = replaceExistingFieldCondition(
      "(status != 'error' AND status != 'warning')",
      "status",
      "status != 'critical'",
    );
    expect(result).toBe("status != 'critical'");
  });

  it("should handle null-check conditions", () => {
    const result = replaceExistingFieldCondition(
      "status is null",
      "status",
      "status = 'active'",
    );
    expect(result).toBe("status = 'active'");
  });
});

// ===========================================================================
// Integrated include/exclude watcher behavior (via applyFilterToQuery)
//
// These tests document the expected end-to-end behavior when a user clicks
// Include or Exclude on a field value in the IndexList panel.
// ===========================================================================
describe("include/exclude filter deduplication (watcher behavior)", () => {
  describe("include operation", () => {
    it("should add a filter when the query is empty", () => {
      const result = applyFilterToQuery("", "status = 'error'");
      expect(result).toBe("status = 'error'");
    });

    it("should append when no existing condition for the field exists", () => {
      const result = applyFilterToQuery(
        "level = 'info'",
        "status = 'error'",
      );
      expect(result).toBe("level = 'info' and status = 'error'");
    });

    it("should REPLACE not APPEND when include is applied twice with the same value", () => {
      // First include
      let query = applyFilterToQuery("", "status = 'error'");
      expect(query).toBe("status = 'error'");

      // Second include with same value — must replace, not duplicate
      query = applyFilterToQuery(query, "status = 'error'");
      expect(query).toBe("status = 'error'");
      expect(query).not.toContain("status = 'error' and status = 'error'");
    });

    it("should REPLACE when include is applied with a different value for the same field", () => {
      let query = applyFilterToQuery("", "status = 'error'");
      query = applyFilterToQuery(query, "status = 'warning'");
      expect(query).toBe("status = 'warning'");
    });

    it("should REPLACE an exclude condition when include is applied for the same field", () => {
      let query = applyFilterToQuery("", "status != 'error'");
      expect(query).toBe("status != 'error'");

      query = applyFilterToQuery(query, "status = 'error'");
      expect(query).toBe("status = 'error'");
      expect(query).not.toContain("status != 'error'");
    });

    it("should not affect unrelated field conditions when replacing", () => {
      let query = applyFilterToQuery("", "level = 'info'");
      query = applyFilterToQuery(query, "status = 'error'");
      query = applyFilterToQuery(query, "status = 'warning'");
      expect(query).toBe("level = 'info' and status = 'warning'");
    });
  });

  describe("exclude operation", () => {
    it("should add an exclude filter when the query is empty", () => {
      const result = applyFilterToQuery("", "status != 'error'");
      expect(result).toBe("status != 'error'");
    });

    it("should append exclude when no existing condition for the field exists", () => {
      const result = applyFilterToQuery(
        "level = 'info'",
        "status != 'error'",
      );
      expect(result).toBe("level = 'info' and status != 'error'");
    });

    it("should REPLACE not APPEND when exclude is applied twice with the same value", () => {
      // First exclude
      let query = applyFilterToQuery("", "status != 'error'");
      expect(query).toBe("status != 'error'");

      // Second exclude with same value — must replace, not duplicate
      query = applyFilterToQuery(query, "status != 'error'");
      expect(query).toBe("status != 'error'");
      expect(query).not.toContain(
        "status != 'error' and status != 'error'",
      );
    });

    it("should REPLACE when exclude is applied with a different value for the same field", () => {
      let query = applyFilterToQuery("", "status != 'error'");
      query = applyFilterToQuery(query, "status != 'warning'");
      expect(query).toBe("status != 'warning'");
    });

    it("should REPLACE an include condition when exclude is applied for the same field", () => {
      let query = applyFilterToQuery("", "status = 'error'");
      expect(query).toBe("status = 'error'");

      query = applyFilterToQuery(query, "status != 'error'");
      expect(query).toBe("status != 'error'");
      expect(query).not.toContain("status = 'error'");
    });
  });

  describe("multi-value select (include/exclude multiple values)", () => {
    it("should add a multi-value include group when query is empty", () => {
      const result = applyFilterToQuery(
        "",
        "(status = 'error' OR status = 'warning')",
      );
      expect(result).toBe("(status = 'error' OR status = 'warning')");
    });

    it("should REPLACE existing single include when multi-value group is applied", () => {
      let query = applyFilterToQuery("", "status = 'error'");
      query = applyFilterToQuery(
        query,
        "(status = 'error' OR status = 'warning')",
      );
      expect(query).toBe("(status = 'error' OR status = 'warning')");
      expect(query).not.toContain("status = 'error' and");
    });

    it("should REPLACE not APPEND when the same multi-value group is applied again", () => {
      let query = applyFilterToQuery(
        "",
        "(status = 'error' OR status = 'warning')",
      );
      query = applyFilterToQuery(
        query,
        "(status = 'error' OR status = 'warning')",
      );
      expect(query).toBe("(status = 'error' OR status = 'warning')");
    });

    it("should REPLACE existing multi-value group with single include", () => {
      let query = applyFilterToQuery(
        "",
        "(status = 'error' OR status = 'warning')",
      );
      query = applyFilterToQuery(query, "status = 'critical'");
      expect(query).toBe("status = 'critical'");
    });

    it("should add a multi-value exclude group when query is empty", () => {
      const result = applyFilterToQuery(
        "",
        "(status != 'error' AND status != 'warning')",
      );
      expect(result).toBe("(status != 'error' AND status != 'warning')");
    });

    it("should REPLACE not APPEND when the same multi-value exclude group is applied again", () => {
      let query = applyFilterToQuery(
        "",
        "(status != 'error' AND status != 'warning')",
      );
      query = applyFilterToQuery(
        query,
        "(status != 'error' AND status != 'warning')",
      );
      expect(query).toBe("(status != 'error' AND status != 'warning')");
    });
  });

  describe("null value handling", () => {
    it("should add a null include filter when query is empty", () => {
      const result = applyFilterToQuery("", "status is null");
      expect(result).toBe("status is null");
    });

    it("should REPLACE null include with a value include for the same field", () => {
      let query = applyFilterToQuery("", "status is null");
      query = applyFilterToQuery(query, "status = 'error'");
      expect(query).toBe("status = 'error'");
      expect(query).not.toContain("is null");
    });

    it("should REPLACE not APPEND when null include is applied twice", () => {
      let query = applyFilterToQuery("", "status is null");
      query = applyFilterToQuery(query, "status is null");
      expect(query).toBe("status is null");
      expect(query).not.toContain("status is null and status is null");
    });
  });
});
