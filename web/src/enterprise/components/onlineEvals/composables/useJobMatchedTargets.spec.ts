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
    expect(buildJobMatchedTargetsSql("default", "", "span", [])).toBe(
      'SELECT COUNT(*) AS cnt\nFROM "default"',
    );
  });

  it("counts distinct trace targets after applying the span filter", () => {
    expect(buildJobMatchedTargetsSql("default", "\"service_name\" = 'checkout'", "trace", [])).toBe(
      'SELECT COUNT(DISTINCT "trace_id") AS cnt\nFROM "default"\nWHERE "service_name" = \'checkout\'',
    );
  });

  it("counts distinct sessions by the session column the stream has", () => {
    expect(buildJobMatchedTargetsSql("s", "", "session", ["trace_id", "session_id"])).toBe(
      'SELECT COUNT(DISTINCT NULLIF("session_id", \'\')) AS cnt\nFROM "s"',
    );
    expect(buildJobMatchedTargetsSql("s", "", "session", ["gen_ai_conversation_id"])).toContain(
      "COUNT(DISTINCT NULLIF(\"gen_ai_conversation_id\", ''))",
    );
  });

  it("reads a session id the way the scheduler does when several columns exist", () => {
    expect(
      buildJobMatchedTargetsSql("s", "", "session", ["gen_ai_conversation_id", "session_id"]),
    ).toContain(
      "COUNT(DISTINCT COALESCE(NULLIF(\"session_id\", ''), NULLIF(\"gen_ai_conversation_id\", '')))",
    );
  });

  it("cannot count sessions on a stream without a session column", () => {
    expect(buildJobMatchedTargetsSql("s", "", "session", ["trace_id"])).toBeNull();
  });

  it("quotes unusual stream identifiers", () => {
    expect(buildJobMatchedTargetsSql('trace"stream', "", "trace", [])).toContain(
      'FROM "trace""stream"',
    );
  });
});
