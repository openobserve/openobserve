import { describe, expect, it } from "vitest";
import { buildJobMatchedTargetsSql, buildJobMatchedTargetsTimeRange } from "./useJobMatchedTargets";

describe("buildJobMatchedTargetsTimeRange", () => {
  it("builds a rolling one-hour preview window", () => {
    const nowMs = Date.UTC(2026, 7, 18, 8, 0, 0);

    const range = buildJobMatchedTargetsTimeRange(nowMs);

    expect(range.endUs - range.startUs).toBe(60 * 60 * 1_000_000);
    expect(range.endUs).toBe(nowMs * 1000);
  });
});

describe("buildJobMatchedTargetsSql", () => {
  it("counts matching rows for span scope", () => {
    expect(buildJobMatchedTargetsSql("default", "", "span")).toBe(
      'SELECT COUNT(*) AS cnt\nFROM "default"',
    );
  });

  it("counts distinct trace targets after applying the span filter", () => {
    expect(buildJobMatchedTargetsSql("default", "\"service_name\" = 'checkout'", "trace")).toBe(
      'SELECT COUNT(DISTINCT "trace_id") AS cnt\nFROM "default"\nWHERE "service_name" = \'checkout\'',
    );
  });

  it("counts distinct session targets", () => {
    expect(buildJobMatchedTargetsSql("trace-stream", "", "session")).toBe(
      'SELECT COUNT(DISTINCT "session_id") AS cnt\nFROM "trace-stream"',
    );
  });

  it("quotes unusual stream identifiers", () => {
    expect(buildJobMatchedTargetsSql('trace"stream', "", "trace")).toContain(
      'FROM "trace""stream"',
    );
  });
});
