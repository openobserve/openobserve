import { describe, expect, it } from "vitest";
import { buildJobMatchedTargetsSql } from "./useJobMatchedTargets";

describe("buildJobMatchedTargetsSql", () => {
  it("counts matching rows for span scope", () => {
    expect(buildJobMatchedTargetsSql("default", "", "span")).toBe(
      'SELECT COUNT(*) AS cnt\nFROM "default"',
    );
  });

  it("counts distinct trace targets after applying the span filter", () => {
    expect(
      buildJobMatchedTargetsSql(
        "default",
        "\"service_name\" = 'checkout'",
        "trace",
      ),
    ).toBe(
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
