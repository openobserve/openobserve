import { describe, it, expect } from "vitest";
import { buildPrefillFromPatterns, type PatternsPrefillInput } from "./fromPatterns";
import { isPrefillBlocked, normalizePrefill } from "../alertPrefill";
import { MAX_PATTERNS_PER_ALERT } from "@/plugins/logs/patterns/patternUtils";

const ERROR_PATTERN = "Connection refused to upstream <*>";
const TIMEOUT_PATTERN = "Request deadline exceeded after <*>";
const NOISY_PATTERN = "Health probe succeeded for endpoint <*>";
const WILDCARD_ONLY = "<*> <*>";

const patterns = (overrides: Partial<PatternsPrefillInput> = {}): PatternsPrefillInput => ({
  streamName: "k8s_logs",
  streamType: "logs",
  includes: [ERROR_PATTERN],
  excludes: [],
  datetime: { type: "relative", relativeTimePeriod: "15m" },
  ...overrides,
});

const keys = (p: ReturnType<typeof buildPrefillFromPatterns>) => p.warnings.map((w) => w.key);

describe("buildPrefillFromPatterns", () => {
  it("builds an include-only alert", () => {
    const p = buildPrefillFromPatterns(patterns());
    expect(p.source).toBe("patterns");
    expect(p.sql).toContain("match_all('Connection refused to upstream')");
    expect(isPrefillBlocked(normalizePrefill(p))).toBe(false);
  });

  it("builds the headline case: current filter minus noisy patterns", () => {
    const p = buildPrefillFromPatterns(
      patterns({
        includes: [],
        excludes: [NOISY_PATTERN, TIMEOUT_PATTERN],
        baseFilter: "code = 500",
      }),
    );
    expect(p.sql).toContain("(code = 500)");
    expect(p.sql).toContain("NOT (");
    expect(keys(p)).not.toContain("broadMatch");
  });

  it("defaults to counting rows, which is the point of the ignore-noise flow", () => {
    const p = buildPrefillFromPatterns(patterns());
    expect(p.sql).toContain("count(*) AS cnt");
    expect(p.thresholdShape).toBe("count");
    expect(p.aggregation).toEqual({
      group_by: [],
      function: "count",
      having: { column: "cnt", operator: ">=", value: 1 },
    });
  });

  it("can list matching rows instead when asked", () => {
    const p = buildPrefillFromPatterns(patterns({ select: "rows" }));
    expect(p.sql).toContain("SELECT *");
    expect(p.thresholdShape).toBe("matching-rows");
    expect(p.aggregation).toBeNull();
  });

  it("warns that excludes over no filter match nearly everything", () => {
    const p = buildPrefillFromPatterns(patterns({ includes: [], excludes: [NOISY_PATTERN] }));
    expect(keys(p)).toContain("broadMatch");
    // Legitimate intent — warn, do not block.
    expect(isPrefillBlocked(normalizePrefill(p))).toBe(false);
  });

  it("blocks when nothing selected has distinctive text to match", () => {
    const p = buildPrefillFromPatterns(patterns({ includes: [WILDCARD_ONLY] }));
    expect(keys(p)).toContain("noConstants");
    expect(isPrefillBlocked(normalizePrefill(p))).toBe(true);
  });

  it("drops an unusable pattern but keeps going when others are fine", () => {
    const p = buildPrefillFromPatterns(patterns({ includes: [ERROR_PATTERN, WILDCARD_ONLY] }));
    expect(keys(p)).toContain("noConstants");
    expect(isPrefillBlocked(normalizePrefill(p))).toBe(false);
    expect(p.meta?.includedPatterns).toEqual([ERROR_PATTERN]);
  });

  it("blocks when no stream is known", () => {
    const p = buildPrefillFromPatterns(patterns({ streamName: "" }));
    expect(keys(p)).toContain("noStream");
    expect(isPrefillBlocked(normalizePrefill(p))).toBe(true);
  });

  it("caps the pattern set and says what it dropped", () => {
    const many = Array.from(
      { length: MAX_PATTERNS_PER_ALERT + 4 },
      (_, i) => `Distinct failure signature number ${i} occurred <*>`,
    );
    const p = buildPrefillFromPatterns(patterns({ includes: many }));

    expect(keys(p)).toContain("patternLimit");
    expect((p.meta?.includedPatterns as string[]).length).toBe(MAX_PATTERNS_PER_ALERT);
  });

  it("says so when a SQL-mode query could not be carried over", () => {
    const p = buildPrefillFromPatterns(patterns({ baseFilterDropped: true }));
    expect(keys(p)).toContain("sqlModeFilterDropped");
  });

  it("maps the time range to the rolling window", () => {
    expect(
      buildPrefillFromPatterns(patterns({ datetime: { type: "relative", relativeTimePeriod: "2h" } }))
        .periodMinutes,
    ).toBe(120);
  });

  it("labels an ignore-only selection distinctly from an include selection", () => {
    expect(
      buildPrefillFromPatterns(patterns({ includes: [], excludes: [NOISY_PATTERN] })).sourceLabel,
    ).toContain("ignored");
    expect(buildPrefillFromPatterns(patterns()).sourceLabel).toContain("1 pattern");
  });

  it("records the selection for the dialog's summary", () => {
    const p = buildPrefillFromPatterns(
      patterns({ includes: [ERROR_PATTERN], excludes: [NOISY_PATTERN] }),
    );
    expect(p.meta?.includedPatterns).toEqual([ERROR_PATTERN]);
    expect(p.meta?.excludedPatterns).toEqual([NOISY_PATTERN]);
  });
});
