// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import type { DimensionCondition } from "@/services/downtimes";
import type { V2Group } from "@/utils/alerts/alertDataTransforms";
import {
  andEqPairs,
  applyResources,
  builderToCondition,
  conditionToBuilder,
  emptyBuilderGroup,
  normalizeConnectors,
} from "./conditionBridge";
import { conditionError } from "./conditionRules";

const eq = (key: string, value: string): DimensionCondition => ({
  type: "pair",
  key,
  operator: "=",
  value,
});
const ne = (key: string, value: string): DimensionCondition => ({
  type: "pair",
  key,
  operator: "!=",
  value,
});
const and = (...items: DimensionCondition[]): DimensionCondition => ({
  type: "group",
  op: "and",
  items,
});
const or = (...items: DimensionCondition[]): DimensionCondition => ({
  type: "group",
  op: "or",
  items,
});

const flow7 = and(or(eq("service", "payments"), eq("service", "checkout-api")), ne("env", "staging"));
const resource = and(eq("service", "payments"), or(eq("host", "db-1"), eq("host", "db-2")));

describe("condition bridges", () => {
  it("round-trips an AND-rooted tree through the builder shape", () => {
    for (const cond of [and(eq("service", "payments"), eq("env", "prod")), flow7, resource]) {
      expect(builderToCondition(conditionToBuilder(cond))).toEqual(cond);
    }
  });

  it("wraps a non-AND root so the builder root stays AND", () => {
    const builder = conditionToBuilder(or(eq("host", "a"), eq("host", "b")));
    expect(builder.logicalOperator).toBe("AND");
    expect(builderToCondition(builder)).toEqual(and(or(eq("host", "a"), eq("host", "b"))));
    expect(builderToCondition(conditionToBuilder(eq("service", "x")))).toEqual(
      and(eq("service", "x")),
    );
  });

  it("maps a nested group's toggle to op and ignores the root's dummy operator", () => {
    const builder: V2Group = {
      filterType: "group",
      logicalOperator: "OR",
      groupId: "root",
      conditions: [
        {
          filterType: "condition",
          column: "service",
          operator: "=",
          value: "payments",
          logicalOperator: "AND",
          id: "c1",
        },
        {
          filterType: "group",
          logicalOperator: "OR",
          groupId: "g1",
          conditions: [
            {
              filterType: "condition",
              column: "host",
              operator: "=",
              value: " db-1 ",
              logicalOperator: "OR",
              id: "c2",
            },
          ],
        },
      ],
    };
    expect(builderToCondition(builder)).toEqual(
      and(eq("service", "payments"), or(eq("host", "db-1"))),
    );
  });

  it("maps both operators both ways", () => {
    const back = builderToCondition(conditionToBuilder(and(eq("a", "1"), ne("b", "2"))));
    expect(back).toEqual(and(eq("a", "1"), ne("b", "2")));
  });

  it("starts with one AND group and one empty pair", () => {
    const empty = builderToCondition(emptyBuilderGroup());
    expect(empty).toEqual(and({ type: "pair", key: "", operator: "=", value: "" }));
  });

  it("returns null for a builder with no rows", () => {
    expect(builderToCondition(null)).toBeNull();
    expect(
      builderToCondition({ filterType: "group", logicalOperator: "AND", conditions: [] }),
    ).toBeNull();
  });
});

describe("normalizeConnectors", () => {
  it("makes a row's connector word follow its group's toggle", () => {
    const prev = conditionToBuilder(and(eq("service", "a"), or(eq("host", "x"), eq("host", "y"))));
    const next = structuredClone(prev);
    const group = next.conditions[1] as V2Group;
    group.logicalOperator = "AND";
    const out = normalizeConnectors(next, prev);
    const outGroup = out.conditions[1] as V2Group;
    expect(outGroup.logicalOperator).toBe("AND");
    expect(outGroup.conditions.every((c) => c.logicalOperator === "AND")).toBe(true);
  });

  it("flips a nested group when one of its row swap buttons flips", () => {
    const prev = conditionToBuilder(and(eq("service", "a"), or(eq("host", "x"), eq("host", "y"))));
    const next = structuredClone(prev);
    (next.conditions[1] as V2Group).conditions[1].logicalOperator = "AND";
    const outGroup = normalizeConnectors(next, prev).conditions[1] as V2Group;
    expect(outGroup.logicalOperator).toBe("AND");
    expect(outGroup.conditions.map((c) => c.logicalOperator)).toEqual(["AND", "AND"]);
  });

  it("keeps the root AND whatever a root row says", () => {
    const prev = conditionToBuilder(and(eq("service", "a"), eq("env", "b")));
    const next = structuredClone(prev);
    next.conditions[1].logicalOperator = "OR";
    const out = normalizeConnectors(next, prev);
    expect(out.conditions.map((c) => c.logicalOperator)).toEqual(["AND", "AND"]);
  });
});

describe("resource refinement", () => {
  it("rewrites the condition into AND [pairs…, OR [ host = a, host = b ]]", () => {
    const out = applyResources(and(eq("service", "payments")), "host", ["db-1", "db-2"]);
    expect(out).toEqual(resource);
  });

  it("replaces an earlier refinement on the same key", () => {
    const out = applyResources(resource, "host", ["db-3"]);
    expect(out).toEqual(and(eq("service", "payments"), eq("host", "db-3")));
  });

  it("looks up only the = pairs reachable through AND groups", () => {
    expect(andEqPairs(flow7)).toEqual([]);
    expect(andEqPairs(resource)).toEqual([{ key: "service", value: "payments" }]);
  });
});

describe("conditionError", () => {
  it("accepts the example trees", () => {
    expect(conditionError(resource)).toBeNull();
    expect(conditionError(flow7)).toBeNull();
    expect(conditionError(and(eq("service", "pay*")))).toBeNull();
  });

  it("rejects each bad tree", () => {
    expect(conditionError(and(ne("env", "staging")))).toBe("alerts.downtimes.validation.needsEq");
    expect(conditionError(and())).toBe("alerts.downtimes.validation.emptyGroup");
    expect(conditionError(and(or(and(or(eq("a", "b"))))))).toBe(
      "alerts.downtimes.validation.tooDeep",
    );
    const many = and(...Array.from({ length: 33 }, (_, i) => eq("host", `h${i}`)));
    expect(conditionError(many)).toBe("alerts.downtimes.validation.tooManyPairs");
    expect(conditionError(and(eq("host", "*")))).toBe("alerts.downtimes.validation.loneStar");
    expect(conditionError(and(eq("host", "db-*-1")))).toBe("alerts.downtimes.validation.innerStar");
    expect(conditionError(and(eq("", "x")))).toBe("alerts.downtimes.validation.pairKey");
    expect(conditionError(and(eq("host", "")))).toBe("alerts.downtimes.validation.pairValue");
  });
});
