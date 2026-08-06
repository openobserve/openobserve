// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { systemProvidedVariablesForScope } from "./systemProvidedVariables";

describe("systemProvidedVariablesForScope", () => {
  it("keeps every span variable available for user mapping", () => {
    expect(systemProvidedVariablesForScope("span")).toEqual([]);
  });

  it("provides the complete bounded view for trace targets", () => {
    expect(systemProvidedVariablesForScope("trace").map(({ name }) => name)).toEqual([
      "input",
      "output",
      "statistics",
      "spans",
      "steps",
    ]);
  });

  it("provides statistics and steps for session targets", () => {
    expect(systemProvidedVariablesForScope("session").map(({ name }) => name)).toEqual([
      "statistics",
      "steps",
    ]);
  });
});
