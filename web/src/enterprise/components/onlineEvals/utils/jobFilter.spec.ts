// @vitest-environment jsdom
// Tests for the eval-job filter helpers. These wrap the shared alert
// V0/V1/V2 transforms — the responsibility here is to normalise the
// backend's `filter_condition` envelope, strip incomplete UI rows on save,
// and produce the canonical `{type:"all"}` shape when no filter applies.

import { describe, it, expect } from "vitest";
import {
  buildJobFilterConditionPayload,
  buildOptionalJobConditionPayload,
  cleanFilterGroup,
  createEmptyJobFilterGroup,
  normalizeJobFilterCondition,
} from "./jobFilter";

describe("createEmptyJobFilterGroup", () => {
  it("returns a top-level AND group with no conditions", () => {
    const g = createEmptyJobFilterGroup();
    expect(g.filterType).toBe("group");
    expect(g.logicalOperator).toBe("AND");
    expect(g.conditions).toEqual([]);
    // ensureIds tags every group with a stable groupId so the FilterGroup
    // component can key its rendered subtree.
    expect(typeof g.groupId).toBe("string");
    expect(g.groupId!.length).toBeGreaterThan(0);
  });
});

describe("normalizeJobFilterCondition — empty envelopes", () => {
  // The backend stores the "no filter" intent in three different ways
  // depending on age of the row. All three collapse to an empty group.
  it("treats null / undefined as no filter", () => {
    expect(normalizeJobFilterCondition(null).conditions).toEqual([]);
    expect(normalizeJobFilterCondition(undefined).conditions).toEqual([]);
  });

  it("treats `{type:'all'}` as no filter", () => {
    expect(normalizeJobFilterCondition({ type: "all" }).conditions).toEqual([]);
  });

  it("treats `{}` as no filter", () => {
    expect(normalizeJobFilterCondition({}).conditions).toEqual([]);
  });

  // Whitespace-only strings show up when an empty textarea / persisted JSON
  // ends up on the wire.
  it("treats whitespace / unparseable strings as no filter", () => {
    expect(normalizeJobFilterCondition("   ").conditions).toEqual([]);
    expect(normalizeJobFilterCondition("not json").conditions).toEqual([]);
  });
});

describe("normalizeJobFilterCondition — backend envelopes", () => {
  // The backend wraps real filter content in `{ version, conditions }`. The
  // normaliser unwraps that envelope before delegating to the V2 detector.
  it("unwraps the `{version, conditions}` envelope when present", () => {
    const result = normalizeJobFilterCondition({
      version: 2,
      conditions: {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          {
            filterType: "condition",
            column: "span_name",
            operator: "=",
            value: "chat",
            values: [],
            logicalOperator: "AND",
          },
        ],
      },
    });
    expect(result.conditions).toHaveLength(1);
    const c: any = result.conditions[0];
    expect(c.column).toBe("span_name");
    expect(c.value).toBe("chat");
  });

  // The legacy `{op, conditions[]}` shape comes from very early jobs — the
  // operator name shifts from `op` to `logicalOperator` and uppercases.
  it("converts the legacy `{op, conditions}` shape, upper-casing the operator", () => {
    const result = normalizeJobFilterCondition({
      op: "or",
      conditions: [
        { column: "x", operator: "=", value: "1" },
        { column: "y", operator: "!=", value: "2" },
      ],
    });
    expect(result.filterType).toBe("group");
    expect(result.logicalOperator).toBe("OR");
    expect(result.conditions).toHaveLength(2);
  });

  it("defaults the legacy op to AND when it's not 'or'", () => {
    const result = normalizeJobFilterCondition({
      op: "weird",
      conditions: [{ column: "x", operator: "=", value: "1" }],
    });
    expect(result.logicalOperator).toBe("AND");
  });

  // Strings on the wire are common — make sure parsing happens before
  // shape detection.
  it("parses a JSON-string filter before normalising", () => {
    const json = JSON.stringify({
      version: 2,
      conditions: {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [],
      },
    });
    const result = normalizeJobFilterCondition(json);
    expect(result.filterType).toBe("group");
  });
});

describe("cleanFilterGroup", () => {
  // Save-time cleanup: every "in progress" row the user hasn't fully filled
  // in must be dropped so the backend doesn't see column-only conditions.
  it("drops conditions that are missing column / operator / value", () => {
    const cleaned = cleanFilterGroup({
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        { filterType: "condition", column: "", operator: "=", value: "x" },
        { filterType: "condition", column: "a", operator: "", value: "x" },
        { filterType: "condition", column: "a", operator: "=", value: "" },
        {
          filterType: "condition",
          column: "a",
          operator: "=",
          value: undefined,
        },
        { filterType: "condition", column: "a", operator: "=", value: null },
        { filterType: "condition", column: "b", operator: "=", value: "ok" },
      ],
    });
    expect(cleaned.conditions).toHaveLength(1);
    expect((cleaned.conditions[0] as any).column).toBe("b");
  });

  it("recursively cleans nested groups and drops them when empty", () => {
    const cleaned = cleanFilterGroup({
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        {
          filterType: "group",
          logicalOperator: "OR",
          conditions: [
            { filterType: "condition", column: "x", operator: "=", value: "1" },
          ],
        },
        {
          filterType: "group",
          logicalOperator: "OR",
          conditions: [
            { filterType: "condition", column: "", operator: "=", value: "1" },
          ],
        },
      ],
    });
    expect(cleaned.conditions).toHaveLength(1);
    expect((cleaned.conditions[0] as any).filterType).toBe("group");
  });

  // Default to AND if the input has anything other than "OR" — guards against
  // future legal logical operators silently passing through.
  it("normalises the top-level logical operator to AND/OR only", () => {
    expect(cleanFilterGroup({} as any).logicalOperator).toBe("AND");
    expect(
      cleanFilterGroup({
        filterType: "group",
        logicalOperator: "OR",
        conditions: [],
      } as any).logicalOperator,
    ).toBe("OR");
  });

  it("tolerates a missing conditions array", () => {
    const cleaned = cleanFilterGroup({
      filterType: "group",
      logicalOperator: "AND",
    } as any);
    expect(cleaned.conditions).toEqual([]);
  });
});

describe("buildJobFilterConditionPayload", () => {
  it("returns `{type:'all'}` when the group has no usable conditions", () => {
    const payload = buildJobFilterConditionPayload({
      filterType: "group",
      logicalOperator: "AND",
      conditions: [],
    } as any);
    expect(payload).toEqual({ type: "all" });
  });

  it("returns `{type:'all'}` when every condition is incomplete", () => {
    const payload = buildJobFilterConditionPayload({
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        { filterType: "condition", column: "", operator: "=", value: "x" },
      ],
    } as any);
    expect(payload).toEqual({ type: "all" });
  });

  it("wraps the cleaned group in `{version:2, conditions}` when non-empty", () => {
    const payload = buildJobFilterConditionPayload({
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        {
          filterType: "condition",
          column: "span_name",
          operator: "=",
          value: "chat",
        },
      ],
    } as any);
    expect(payload).toMatchObject({
      version: 2,
      conditions: {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          expect.objectContaining({
            filterType: "condition",
            column: "span_name",
            operator: "=",
            value: "chat",
          }),
        ],
      },
    });
  });
});

describe("buildOptionalJobConditionPayload", () => {
  it("returns null when no End Signal condition is configured", () => {
    expect(
      buildOptionalJobConditionPayload({
        filterType: "group",
        logicalOperator: "AND",
        conditions: [],
      } as any),
    ).toBeNull();
  });

  it("emits the canonical V2 envelope for an End Signal", () => {
    expect(
      buildOptionalJobConditionPayload({
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          {
            filterType: "condition",
            column: "status",
            operator: "=",
            value: "complete",
          },
        ],
      } as any),
    ).toEqual({
      version: 2,
      conditions: {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          {
            filterType: "condition",
            column: "status",
            operator: "=",
            value: "complete",
            values: [],
            logicalOperator: "AND",
          },
        ],
      },
    });
  });
});
