// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { describe, expect, it } from "vitest";

import { letteredToRaw, rawToLettered, removeExpressionOperand } from "./expression";

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

  it("renders the stored form as letters", () => {
    expect(rawToLettered("{id-a} && {id-b}", children)).toBe("A && B");
  });

  it("translates letters back to the stored form", () => {
    expect(letteredToRaw("A || (B && !C)", children)).toBe("{id-a} || ({id-b} && !{id-c})");
  });

  it("leaves unknown letters untouched for validation to reject", () => {
    expect(letteredToRaw("A && Z", children)).toBe("{id-a} && Z");
  });
});
