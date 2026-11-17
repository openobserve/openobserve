// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import type { DimensionCondition } from "@/services/downtimes";
import { andEqPairs, applyResources } from "./conditionBridge";
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

const flow7 = and(
  or(eq("service", "payments"), eq("service", "checkout-api")),
  ne("env", "staging"),
);
const resource = and(eq("service", "payments"), or(eq("host", "db-1"), eq("host", "db-2")));

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
