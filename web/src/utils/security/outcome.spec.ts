// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import { toOcsfStatus } from "./ocsf";
import {
  OUTCOME_FAILURE_WORDS,
  classifyOutcome,
  failurePredicate,
  outcomeInterpretable,
} from "./outcome";

describe("outcome vocabulary", () => {
  it("stays in step with toOcsfStatus: every failure word is a failure there too", () => {
    for (const word of OUTCOME_FAILURE_WORDS) expect(toOcsfStatus(word)).toBe(2);
  });

  it("reads Windows keyword phrases and HTTP codes", () => {
    expect(classifyOutcome("Audit Failure")).toBe(2);
    expect(classifyOutcome("Audit Success")).toBe(1);
    expect(classifyOutcome("403")).toBe(2);
    expect(classifyOutcome("201")).toBe(1);
    expect(classifyOutcome("7")).toBe(99);
  });

  it("builds a predicate for words and 4xx/5xx codes", () => {
    const sql = failurePredicate("status");
    expect(sql).toContain(`LOWER(TRIM(CAST("status" AS VARCHAR))) IN ('failure'`);
    expect(sql).toContain("'denied_by_policy'");
    expect(sql).toContain("'audit failure'");
    expect(sql).toContain(`TRY_CAST(CAST("status" AS VARCHAR) AS BIGINT) BETWEEN 400 AND 599`);
  });

  it("only trusts columns whose values it can read", () => {
    expect(
      outcomeInterpretable([
        { value: "success", n: 99 },
        { value: "weird", n: 1 },
      ]),
    ).toBe(true);
    expect(
      outcomeInterpretable([
        { value: "success", n: 90 },
        { value: "weird", n: 10 },
      ]),
    ).toBe(false);
    expect(outcomeInterpretable([{ value: "no", n: 5 }])).toBe(false);
    expect(outcomeInterpretable([])).toBe(false);
  });
});
