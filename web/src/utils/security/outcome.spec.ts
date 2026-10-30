// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import { toOcsfStatus } from "./ocsf";
import {
  OUTCOME_FAILURE_WORDS,
  OUTCOME_FALLBACK_WINDOW_US,
  OUTCOME_SAMPLE_WINDOW_US,
  classifyOutcome,
  failurePredicate,
  outcomeInterpretable,
  outcomeFallbackWindow,
  outcomeSampleWindow,
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

describe("outcomeSampleWindow", () => {
  it("reads only the last hour of a longer window", () => {
    const end = 100 * OUTCOME_SAMPLE_WINDOW_US;
    expect(outcomeSampleWindow(0, end)).toEqual([end - OUTCOME_SAMPLE_WINDOW_US, end]);
  });

  it("never reaches before the caller's window", () => {
    expect(outcomeSampleWindow(500, 1000)).toEqual([500, 1000]);
  });
});

describe("outcomeFallbackWindow", () => {
  it("widens to at most a day, inside the caller's window", () => {
    const end = 30 * OUTCOME_FALLBACK_WINDOW_US;
    expect(outcomeFallbackWindow(0, end)).toEqual([end - OUTCOME_FALLBACK_WINDOW_US, end]);
    expect(outcomeFallbackWindow(end - 5, end)).toEqual([end - 5, end]);
  });
});
