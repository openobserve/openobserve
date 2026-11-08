// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import { solutionModeForPath } from "./solutionMode";

describe("solutionModeForPath", () => {
  it("puts every /security route in security mode, whatever came before", () => {
    expect(solutionModeForPath("/security", "observability")).toBe("security");
    expect(solutionModeForPath("/security/events", "observability")).toBe("security");
  });

  it("returns product routes to observability", () => {
    expect(solutionModeForPath("/logs", "security")).toBe("observability");
    expect(solutionModeForPath("/", "security")).toBe("observability");
    // A prefix match on the word alone is not a security route.
    expect(solutionModeForPath("/securityfoo", "security")).toBe("observability");
  });

  it("leaves the mode alone on pages both products share", () => {
    expect(solutionModeForPath("/settings/general", "security")).toBe("security");
    expect(solutionModeForPath("/iam/users", "security")).toBe("security");
    expect(solutionModeForPath("/alert-destinations", "security")).toBe("security");
    expect(solutionModeForPath("/settings", "observability")).toBe("observability");
  });
});
