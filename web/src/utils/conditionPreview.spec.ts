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
  buildConditionPreview,
  getTruncatedConditions,
} from "@/utils/conditionPreview";

// V2 condition leaf helper
const cond = (
  column: string,
  operator: string,
  value: any,
  logicalOperator?: string,
) => ({
  filterType: "condition",
  column,
  operator,
  value,
  ...(logicalOperator ? { logicalOperator } : {}),
});

const group = (conditions: any[], logicalOperator?: string) => ({
  filterType: "group",
  conditions,
  ...(logicalOperator ? { logicalOperator } : {}),
});

describe("buildConditionPreview", () => {
  describe("empty / null / undefined input", () => {
    it("returns an empty string for undefined", () => {
      expect(buildConditionPreview(undefined)).toBe("");
    });

    it("returns an empty string for null", () => {
      expect(buildConditionPreview(null)).toBe("");
    });

    it("returns an empty string for an empty string", () => {
      expect(buildConditionPreview("")).toBe("");
    });

    it("returns an empty string for 0", () => {
      expect(buildConditionPreview(0)).toBe("");
    });

    it("returns an empty string for false", () => {
      expect(buildConditionPreview(false)).toBe("");
    });

    it("returns an empty string for an empty object", () => {
      expect(buildConditionPreview({})).toBe("");
    });

    it("returns an empty string for an empty array (V0)", () => {
      expect(buildConditionPreview([])).toBe("");
    });

    it("returns an empty string for an unrecognised object shape", () => {
      expect(buildConditionPreview({ foo: "bar", value: 1 })).toBe("");
    });
  });

  describe("V2 group format", () => {
    it("returns an empty string for a group with no conditions", () => {
      expect(buildConditionPreview(group([]))).toBe("");
    });

    it("renders a single condition", () => {
      expect(buildConditionPreview(group([cond("status", "=", "500")]))).toBe(
        "status = '500'",
      );
    });

    it("joins two conditions with the second's logicalOperator, lowercased", () => {
      const node = group([
        cond("status", "=", "500"),
        cond("host", "!=", "web-01", "AND"),
      ]);
      expect(buildConditionPreview(node)).toBe(
        "status = '500' and host != 'web-01'",
      );
    });

    it("lowercases an OR logicalOperator", () => {
      const node = group([
        cond("a", "=", "1"),
        cond("b", "=", "2", "OR"),
      ]);
      expect(buildConditionPreview(node)).toBe("a = '1' or b = '2'");
    });

    it("ignores the logicalOperator on the first condition (index 0)", () => {
      const node = group([cond("a", "=", "1", "AND")]);
      expect(buildConditionPreview(node)).toBe("a = '1'");
    });

    it("omits the connector when a later condition has no logicalOperator", () => {
      const node = group([cond("a", "=", "1"), cond("b", "=", "2")]);
      expect(buildConditionPreview(node)).toBe("a = '1' b = '2'");
    });

    it("wraps a nested group in parentheses", () => {
      const node = group([
        cond("a", "=", "1"),
        { ...group([cond("b", "=", "2"), cond("c", "=", "3", "OR")]), logicalOperator: "AND" },
      ]);
      expect(buildConditionPreview(node)).toBe(
        "a = '1' and (b = '2' or c = '3')",
      );
    });

    it("renders a deeply nested group", () => {
      const node = group([group([group([cond("x", ">", 5)])])]);
      expect(buildConditionPreview(node)).toBe("((x > '5'))");
    });

    it("renders an empty nested group as an empty fragment", () => {
      const node = group([cond("a", "=", "1"), { ...group([]), logicalOperator: "AND" }]);
      // The nested preview is empty, so only the connector is emitted
      expect(buildConditionPreview(node)).toBe("a = '1' and ");
    });

    it("renders an item with an unknown filterType as an empty fragment", () => {
      const node = group([{ filterType: "mystery", column: "a" } as any]);
      expect(buildConditionPreview(node)).toBe("");
    });

    it("renders an item with no filterType as an empty fragment", () => {
      const node = group([cond("a", "=", "1"), { logicalOperator: "AND" } as any]);
      expect(buildConditionPreview(node)).toBe("a = '1' and ");
    });

    it("does not treat a group as V2 when `conditions` is not an array", () => {
      expect(
        buildConditionPreview({ filterType: "group", conditions: "nope" }),
      ).toBe("");
    });

    it("does not treat a group as V2 when `conditions` is missing", () => {
      expect(buildConditionPreview({ filterType: "group" })).toBe("");
    });

    describe("defaults and value quoting inside a group", () => {
      it("falls back to `field` when the column is missing", () => {
        const node = group([
          { filterType: "condition", operator: "=", value: "1" } as any,
        ]);
        expect(buildConditionPreview(node)).toBe("field = '1'");
      });

      it("falls back to `=` when the operator is missing", () => {
        const node = group([
          { filterType: "condition", column: "a", value: "1" } as any,
        ]);
        expect(buildConditionPreview(node)).toBe("a = '1'");
      });

      it("renders '' when the value is undefined", () => {
        const node = group([
          { filterType: "condition", column: "a", operator: "=" } as any,
        ]);
        expect(buildConditionPreview(node)).toBe("a = ''");
      });

      it("renders '' when the value is null", () => {
        expect(buildConditionPreview(group([cond("a", "=", null)]))).toBe(
          "a = ''",
        );
      });

      it("renders '' when the value is an empty string", () => {
        expect(buildConditionPreview(group([cond("a", "=", "")]))).toBe("a = ''");
      });

      it("quotes a numeric value including 0", () => {
        expect(buildConditionPreview(group([cond("a", "=", 0)]))).toBe("a = '0'");
      });

      it("quotes a false boolean value", () => {
        expect(buildConditionPreview(group([cond("a", "=", false)]))).toBe(
          "a = 'false'",
        );
      });

      it("supports every comparison operator", () => {
        const operators = ["=", "!=", ">", "<", ">=", "<=", "contains", "Contains", "NotContains"];
        operators.forEach((op) => {
          expect(buildConditionPreview(group([cond("a", op, "v")]))).toBe(
            `a ${op} 'v'`,
          );
        });
      });

      it("uses all defaults for a bare condition item", () => {
        const node = group([{ filterType: "condition" } as any]);
        expect(buildConditionPreview(node)).toBe("field = ''");
      });
    });
  });

  describe("V1 backend format: or", () => {
    it("joins each branch with ` or ` and wraps them in parentheses", () => {
      const node = {
        or: [
          { column: "a", operator: "=", value: "1" },
          { column: "b", operator: "=", value: "2" },
        ],
      };
      expect(buildConditionPreview(node)).toBe("(a = '1') or (b = '2')");
    });

    it("returns an empty string for an empty or array", () => {
      expect(buildConditionPreview({ or: [] })).toBe("");
    });

    it("drops branches whose preview is empty", () => {
      const node = {
        or: [{ column: "a", operator: "=", value: "1" }, {}, null],
      };
      expect(buildConditionPreview(node)).toBe("(a = '1')");
    });

    it("recurses into nested and/or branches", () => {
      const node = {
        or: [
          { and: [{ column: "a", operator: "=", value: "1" }] },
          { column: "b", operator: "=", value: "2" },
        ],
      };
      expect(buildConditionPreview(node)).toBe("((a = '1')) or (b = '2')");
    });

    it("ignores an `or` key that is not an array", () => {
      expect(buildConditionPreview({ or: "x" })).toBe("");
    });
  });

  describe("V1 backend format: and", () => {
    it("joins each branch with ` and ` and wraps them in parentheses", () => {
      const node = {
        and: [
          { column: "a", operator: "=", value: "1" },
          { column: "b", operator: ">", value: 5 },
        ],
      };
      expect(buildConditionPreview(node)).toBe("(a = '1') and (b > '5')");
    });

    it("returns an empty string for an empty and array", () => {
      expect(buildConditionPreview({ and: [] })).toBe("");
    });

    it("drops branches whose preview is empty", () => {
      const node = { and: [{}, { column: "a", operator: "=", value: "1" }] };
      expect(buildConditionPreview(node)).toBe("(a = '1')");
    });

    it("is only reached when there is no `or` key (or wins)", () => {
      const node = {
        or: [{ column: "o", operator: "=", value: "1" }],
        and: [{ column: "a", operator: "=", value: "2" }],
      };
      expect(buildConditionPreview(node)).toBe("(o = '1')");
    });

    it("ignores an `and` key that is not an array", () => {
      expect(buildConditionPreview({ and: {} })).toBe("");
    });
  });

  describe("V1 backend format: not", () => {
    it("wraps the negated preview", () => {
      const node = { not: { column: "a", operator: "=", value: "1" } };
      expect(buildConditionPreview(node)).toBe("not (a = '1')");
    });

    it("returns an empty string when the negated node previews as empty", () => {
      expect(buildConditionPreview({ not: {} })).toBe("");
    });

    it("negates a nested and group", () => {
      const node = {
        not: {
          and: [
            { column: "a", operator: "=", value: "1" },
            { column: "b", operator: "=", value: "2" },
          ],
        },
      };
      expect(buildConditionPreview(node)).toBe("not ((a = '1') and (b = '2'))");
    });
  });

  describe("V1 frontend format: items", () => {
    it("joins items with the lowercased label", () => {
      const node = {
        label: "OR",
        items: [
          { column: "a", operator: "=", value: "1" },
          { column: "b", operator: "=", value: "2" },
        ],
      };
      expect(buildConditionPreview(node)).toBe("a = '1' or b = '2'");
    });

    it("defaults the join operator to `and` when the label is missing", () => {
      const node = {
        items: [
          { column: "a", operator: "=", value: "1" },
          { column: "b", operator: "=", value: "2" },
        ],
      };
      expect(buildConditionPreview(node)).toBe("a = '1' and b = '2'");
    });

    it("defaults to `and` when the label is an empty string", () => {
      const node = {
        label: "",
        items: [
          { column: "a", operator: "=", value: "1" },
          { column: "b", operator: "=", value: "2" },
        ],
      };
      expect(buildConditionPreview(node)).toBe("a = '1' and b = '2'");
    });

    it("returns an empty string for an empty items array", () => {
      expect(buildConditionPreview({ items: [] })).toBe("");
    });

    it("drops items that preview as empty", () => {
      const node = {
        items: [{ column: "a", operator: "=", value: "1" }, {}, null],
      };
      expect(buildConditionPreview(node)).toBe("a = '1'");
    });

    it("recurses into nested items groups", () => {
      const node = {
        label: "AND",
        items: [
          { column: "a", operator: "=", value: "1" },
          { label: "OR", items: [{ column: "b", operator: "=", value: "2" }] },
        ],
      };
      expect(buildConditionPreview(node)).toBe("a = '1' and b = '2'");
    });

    it("ignores an `items` key that is not an array", () => {
      expect(buildConditionPreview({ items: "nope" })).toBe("");
    });
  });

  describe("single condition", () => {
    it("renders column operator 'value'", () => {
      expect(
        buildConditionPreview({ column: "status", operator: ">=", value: 500 }),
      ).toBe("status >= '500'");
    });

    it("renders '' for a missing value", () => {
      expect(buildConditionPreview({ column: "a", operator: "=" })).toBe("a = ''");
    });

    it("renders '' for a null value", () => {
      expect(
        buildConditionPreview({ column: "a", operator: "=", value: null }),
      ).toBe("a = ''");
    });

    it("renders '' for an empty-string value", () => {
      expect(
        buildConditionPreview({ column: "a", operator: "=", value: "" }),
      ).toBe("a = ''");
    });

    it("quotes a 0 value rather than treating it as missing", () => {
      expect(
        buildConditionPreview({ column: "a", operator: "=", value: 0 }),
      ).toBe("a = '0'");
    });

    it("returns an empty string when the operator is missing", () => {
      expect(buildConditionPreview({ column: "a", value: "1" })).toBe("");
    });

    it("returns an empty string when the column is missing", () => {
      expect(buildConditionPreview({ operator: "=", value: "1" })).toBe("");
    });

    it("handles a flattened workflow alert field", () => {
      expect(
        buildConditionPreview({
          column: "meta_alert_name",
          operator: "=",
          value: "High Error Rate",
        }),
      ).toBe("meta_alert_name = 'High Error Rate'");
    });
  });

  describe("V0 array format", () => {
    it("joins conditions with ` and `", () => {
      const node = [
        { column: "a", operator: "=", value: "1" },
        { column: "b", operator: "!=", value: "2" },
      ];
      expect(buildConditionPreview(node)).toBe("a = '1' and b != '2'");
    });

    it("filters out entries missing a column or an operator", () => {
      const node = [
        { column: "a", operator: "=", value: "1" },
        { column: "b" },
        { operator: "=" },
        {},
      ];
      expect(buildConditionPreview(node)).toBe("a = '1'");
    });

    it("renders '' for missing / null / empty values", () => {
      const node = [
        { column: "a", operator: "=" },
        { column: "b", operator: "=", value: null },
        { column: "c", operator: "=", value: "" },
      ];
      expect(buildConditionPreview(node)).toBe("a = '' and b = '' and c = ''");
    });

    it("quotes a 0 value", () => {
      expect(buildConditionPreview([{ column: "a", operator: "=", value: 0 }])).toBe(
        "a = '0'",
      );
    });

    it("returns an empty string when nothing survives the filter", () => {
      expect(buildConditionPreview([{}, { column: "a" }])).toBe("");
    });
  });
});

describe("getTruncatedConditions", () => {
  it("returns the full preview when it is within the default max length of 20", () => {
    expect(
      getTruncatedConditions({ column: "a", operator: "=", value: "1" }),
    ).toBe("a = '1'");
  });

  it("truncates and appends an ellipsis past the default max length", () => {
    const node = {
      column: "meta_alert_name",
      operator: "=",
      value: "High Error Rate",
    };
    const full = "meta_alert_name = 'High Error Rate'";
    expect(getTruncatedConditions(node)).toBe(full.substring(0, 20) + "...");
    expect(getTruncatedConditions(node)).toBe("meta_alert_name = 'H...");
  });

  it("does not truncate at exactly the max length (boundary)", () => {
    // "abcdefghij = 'xyz'" -> 18 chars; pad to exactly 20
    const node = { column: "abcdefghijkl", operator: "=", value: "xyz" };
    const text = buildConditionPreview(node);
    expect(text).toHaveLength(20);
    expect(getTruncatedConditions(node)).toBe(text);
    expect(getTruncatedConditions(node)).not.toContain("...");
  });

  it("truncates at one char past the max length (boundary)", () => {
    const node = { column: "abcdefghijklm", operator: "=", value: "xyz" };
    expect(buildConditionPreview(node)).toHaveLength(21);
    expect(getTruncatedConditions(node)).toBe(
      buildConditionPreview(node).substring(0, 20) + "...",
    );
  });

  it("honours a custom maxLength", () => {
    const node = { column: "abcdef", operator: "=", value: "1" };
    expect(getTruncatedConditions(node, 5)).toBe("abcde...");
  });

  it("truncates everything when maxLength is 0", () => {
    const node = { column: "a", operator: "=", value: "1" };
    expect(getTruncatedConditions(node, 0)).toBe("...");
  });

  it("returns an empty string for null input", () => {
    expect(getTruncatedConditions(null)).toBe("");
  });

  it("returns an empty string for undefined input", () => {
    expect(getTruncatedConditions(undefined)).toBe("");
  });

  it("returns an empty string for an unrecognised node", () => {
    expect(getTruncatedConditions({})).toBe("");
  });

  it("truncates a long V2 group preview", () => {
    const node = group([
      cond("status_code", ">=", 500),
      cond("host", "=", "web-01", "AND"),
    ]);
    const full = buildConditionPreview(node);
    expect(full.length).toBeGreaterThan(20);
    expect(getTruncatedConditions(node)).toBe(full.substring(0, 20) + "...");
  });
});
