// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import { blockedReason, caveat } from "./compileText";

const base = { where: "", runnable: false, unsupported: [], assumedAbsent: [], fields: [] };

describe("compile text", () => {
  it("prefers the error, then the refusals, then the absent fields", () => {
    expect(blockedReason({ ...base, error: "Rule has no title" })).toBe("Rule has no title");
    expect(blockedReason({ ...base, unsupported: ["modifier: wide"] })).toMatch(/modifier: wide/);
    expect(blockedReason({ ...base, assumedAbsent: ["CommandLine"] })).toBe(
      "Cannot match: this stream has no CommandLine",
    );
    expect(blockedReason({ ...base, runnable: true, where: "x" })).toBe("");
  });

  it("shows the server's reason for a rule that is not runnable yet", () => {
    expect(
      blockedReason({ ...base, reason: "Stream has no column user_name", assumedAbsent: ["x"] }),
    ).toBe("Stream has no column user_name");
    expect(blockedReason({ ...base, runnable: true, where: "x", reason: "stale" })).toBe("");
  });

  it("names assumed-absent fields only on a runnable rule", () => {
    expect(caveat({ ...base, runnable: true, assumedAbsent: ["SamlProviderArn"] })).toMatch(
      /SamlProviderArn/,
    );
    expect(caveat({ ...base, assumedAbsent: ["SamlProviderArn"] })).toBe("");
  });
});
