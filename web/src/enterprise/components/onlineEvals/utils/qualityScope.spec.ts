import { describe, expect, it } from "vitest";
import { emptyScopeCounts, qualityScopeWhere, scopeCountsFromRow } from "./qualityScope";

describe("qualityScope", () => {
  it("leaves the combined view unfiltered", () => {
    expect(qualityScopeWhere("all")).toBeNull();
  });

  it.each(["span", "trace", "session"] as const)(
    "filters the detail view to %s scores",
    (scope) => {
      expect(qualityScopeWhere(scope)).toBe(`_target_scope = '${scope}'`);
    },
  );

  it("normalizes SQL aggregate values into scope counts", () => {
    expect(
      scopeCountsFromRow({
        span_count: "4",
        trace_count: 2,
        session_count: null,
      }),
    ).toEqual({ span: 4, trace: 2, session: 0 });
    expect(emptyScopeCounts()).toEqual({ span: 0, trace: 0, session: 0 });
  });
});
