// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { describe, expect, it } from "vitest";

import {
  childOptionsFrom,
  letteredToRaw,
  operatorsToWords,
  rawToLettered,
  removeExpressionOperand,
} from "./expression";

const isBalanced = (expr: string): boolean => {
  let balance = 0;
  for (const ch of expr) {
    if (ch === "(") balance += 1;
    else if (ch === ")") balance -= 1;
    if (balance < 0) return false;
  }
  return balance === 0;
};

describe("removeExpressionOperand", () => {
  it("strips an operand from a flat expression", () => {
    expect(removeExpressionOperand("{a} && {b} && {c}", "a")).toBe("{b} && {c}");
  });

  it("strips a negated operand", () => {
    expect(removeExpressionOperand("!{a} && {b}", "a")).toBe("{b}");
  });

  it("preserves OR structure on a flat removal", () => {
    expect(removeExpressionOperand("{a} || {b} || {c}", "b")).toBe("{a} || {c}");
  });

  it("collapses a nested canonical expression into a valid form", () => {
    const nested = "((({a} && {b}) && {c}) && {d})";
    const result = removeExpressionOperand(nested, "a");

    expect(result).toContain("{b}");
    expect(result).toContain("{c}");
    expect(result).toContain("{d}");
    expect(result).not.toContain("{a}");
    // no dangling operator, and the parens stay balanced
    expect(/\(\s*&&|&&\s*\)|^\s*&&|&&\s*$/.test(result)).toBe(false);
    expect(isBalanced(result)).toBe(true);
  });
});

describe("lettered <-> raw expression", () => {
  const children = [{ alert_id: "id-a" }, { alert_id: "id-b" }, { alert_id: "id-c" }];

  it("renders the stored form as letters joined by words", () => {
    expect(rawToLettered("{id-a} || ({id-b} && !{id-c})", children)).toBe("A OR ( B AND NOT C )");
  });

  it.each([
    ["A OR ( B AND NOT C )", "{id-a} || ( {id-b} && ! {id-c} )"],
    ["a and not b", "a && ! b"],
    ["A || (B && !C)", "{id-a} || ({id-b} && !{id-c})"],
    ["{id-c} AND B", "{id-c} && {id-b}"],
  ])("translates %s back to the stored form", (lettered, stored) => {
    expect(letteredToRaw(lettered, children)).toBe(stored);
  });

  it.each([
    ["A && (B || C)", "A AND (B OR C)"],
    ["A&&!B", "A AND NOT B"],
    ["(!A) || B AND C", "(NOT A) OR B AND C"],
  ])("shows typed symbols in %s as words", (typed, words) => {
    expect(operatorsToWords(typed)).toBe(words);
  });

  it("leaves unknown letters untouched for validation to reject", () => {
    expect(letteredToRaw("A && Z", children)).toBe("{id-a} && Z");
  });
});

describe("childOptionsFrom", () => {
  it("offers scheduled and SLO alerts but no composite or anomaly rows", () => {
    const rows = [
      { alert_id: "s1", name: "scheduled", alert_type: "scheduled" },
      { alert_id: "slo1", name: "slo", alert_type: "slo" },
      { alert_id: "c1", name: "composite", alert_type: "composite" },
      { alert_id: "a1", name: "anomaly", alert_type: "anomaly_detection" },
      { id: "s2", name: "legacy id field", alert_type: "scheduled" },
    ];
    expect(childOptionsFrom(rows).map((option) => option.alert_id)).toEqual(["s1", "slo1", "s2"]);
  });
});
