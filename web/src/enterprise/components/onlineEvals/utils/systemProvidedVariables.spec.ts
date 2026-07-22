// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  isSystemProvidedVariable,
  systemProvidedVariablesForScope,
} from "./systemProvidedVariables";

describe("systemProvidedVariablesForScope", () => {
  it("keeps every span variable available for user mapping", () => {
    expect(systemProvidedVariablesForScope("span")).toEqual([]);
    expect(isSystemProvidedVariable("span", "input")).toBe(false);
    expect(isSystemProvidedVariable("span", "output")).toBe(false);
    expect(isSystemProvidedVariable("span", "statistics")).toBe(false);
    expect(isSystemProvidedVariable("span", "spans")).toBe(false);
    expect(isSystemProvidedVariable("span", "steps")).toBe(false);
  });

  it("provides the complete bounded view for trace targets", () => {
    expect(
      systemProvidedVariablesForScope("trace").map(({ name }) => name),
    ).toEqual(["input", "output", "statistics", "spans", "steps"]);
  });

  it("provides statistics and steps for session targets", () => {
    expect(
      systemProvidedVariablesForScope("session").map(({ name }) => name),
    ).toEqual(["statistics", "steps"]);
    expect(isSystemProvidedVariable("session", "input")).toBe(false);
    expect(isSystemProvidedVariable("session", "spans")).toBe(false);
  });

  it("does not treat similarly named custom variables as system provided", () => {
    expect(isSystemProvidedVariable("trace", "trace_statistics")).toBe(false);
    expect(isSystemProvidedVariable("session", "steps_summary")).toBe(false);
  });
});
