// Copyright 2026 OpenObserve Inc.

import { afterEach, describe, expect, it, vi } from "vitest";

import { queryClient } from "@/composables/query/queryClient";
import { ROOT_RULE_ID } from "@/views/Security/__fixtures__/sigmaFixtures";
import { buildRuleCountSql, useSigmaRules } from "./useSigmaRules";

vi.mock("@/services/securitySigma", async () =>
  (await import("@/views/Security/__fixtures__/sigmaFixtures")).mockSigmaService(),
);

afterEach(() => queryClient.clear());

const cloudtrail = { id: "aws_cloudtrail" } as never;

describe("useSigmaRules", () => {
  it("lists the server's compiled rules for the source with their catalog entries", async () => {
    const { rules, compileFor } = useSigmaRules();
    await compileFor("default", cloudtrail, ["eventname"]);
    expect(rules.value.map((r) => r.rule.key)).toContain(ROOT_RULE_ID);
    expect(rules.value.every((r) => r.count === null && r.compiled.runnable)).toBe(true);
  });

  it("clears the list without a source or columns", async () => {
    const { rules, compileFor } = useSigmaRules();
    await compileFor("default", cloudtrail, ["eventname"]);
    await compileFor("default", null, ["eventname"]);
    expect(rules.value).toEqual([]);
  });

  it("counts every rule in one conditional-aggregate query", () => {
    expect(buildRuleCountSql('a"b', ["x = 1", "y = 2"])).toBe(
      `SELECT SUM(CASE WHEN x = 1 THEN 1 ELSE 0 END) AS r0, SUM(CASE WHEN y = 2 THEN 1 ELSE 0 END) AS r1 FROM "a""b"`,
    );
  });
});
