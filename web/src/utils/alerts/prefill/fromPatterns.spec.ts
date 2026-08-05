import { describe, it, expect } from "vitest";
import { buildPrefillFromPatterns, type PatternsPrefillInput } from "./fromPatterns";
import { isPrefillBlocked, normalizePrefill } from "../alertPrefill";

const ERROR_PATTERN = "Connection refused to upstream <*>";
const TIMEOUT_PATTERN = "Request deadline exceeded after <*>";
const NOISY_PATTERN = "Health probe succeeded for endpoint <*>";
const WILDCARD_ONLY = "<*> <*>";

const patterns = (overrides: Partial<PatternsPrefillInput> = {}): PatternsPrefillInput => ({
  streamName: "k8s_logs",
  streamType: "logs",
  templates: [ERROR_PATTERN, NOISY_PATTERN],
  totalCount: 2,
  datetime: { type: "relative", relativeTimePeriod: "15m" },
  ...overrides,
});

const keys = (p: ReturnType<typeof buildPrefillFromPatterns>) => p.warnings.map((w) => w.key);

describe("buildPrefillFromPatterns", () => {
  describe("modes", () => {
    it("defaults to excluding the visible patterns — the ignore-the-noise case", () => {
      const p = buildPrefillFromPatterns(patterns({ baseFilter: "code = 500" }));

      expect(p.patternFilter?.mode).toBe("exclude");
      expect(p.sql).toContain("(code = 500)");
      expect(p.sql).toContain("NOT (");
    });

    it("matches any of the visible patterns in include mode", () => {
      const p = buildPrefillFromPatterns(patterns({ mode: "include" }));

      expect(p.sql).toContain("match_all('Connection refused to upstream')");
      expect(p.sql).not.toContain("NOT (");
    });

    it("leaves patterns out entirely in none mode", () => {
      const p = buildPrefillFromPatterns(patterns({ mode: "none", baseFilter: "code = 500" }));

      expect(p.sql).toContain("(code = 500)");
      expect(p.sql).not.toContain("match_all");
      expect(p.meta?.appliedPatterns).toEqual([]);
    });

    it("does not block in none mode even with no usable patterns", () => {
      const p = buildPrefillFromPatterns(
        patterns({ mode: "none", templates: [WILDCARD_ONLY], baseFilter: "code = 500" }),
      );
      expect(isPrefillBlocked(normalizePrefill(p))).toBe(false);
    });
  });

  describe("scope reporting", () => {
    it("reports the visible and total counts for the dialog", () => {
      const p = buildPrefillFromPatterns(
        patterns({ templates: [ERROR_PATTERN, NOISY_PATTERN], totalCount: 15, filtered: true }),
      );

      expect(p.patternFilter).toEqual({
        mode: "exclude",
        visibleCount: 2,
        totalCount: 15,
        filtered: true,
      });
    });

    it("marks an unfiltered list as such", () => {
      expect(buildPrefillFromPatterns(patterns()).patternFilter?.filtered).toBe(false);
    });
  });

  describe("no cap", () => {
    it("uses every visible pattern — truncating would leave the noise firing", () => {
      const many = Array.from(
        { length: 40 },
        (_, i) => `Distinct failure signature number ${i} occurred <*>`,
      );
      const p = buildPrefillFromPatterns(patterns({ templates: many, totalCount: 40 }));

      expect((p.meta?.appliedPatterns as string[]).length).toBe(40);
      expect(keys(p)).not.toContain("patternLimit");
    });
  });

  describe("guards", () => {
    it("warns that excludes over no filter match nearly everything", () => {
      const p = buildPrefillFromPatterns(patterns());
      expect(keys(p)).toContain("broadMatch");
      expect(isPrefillBlocked(normalizePrefill(p))).toBe(false);
    });

    it("falls back to the bare search when the page has no patterns at all", () => {
      // Nothing to include or exclude means no choice to make — the user should
      // land on the alert form, not be stopped at a dialog about it.
      const p = buildPrefillFromPatterns(
        patterns({ templates: [], totalCount: 0, baseFilter: "code = 500" }),
      );

      expect(isPrefillBlocked(normalizePrefill(p))).toBe(false);
      expect(p.patternFilter?.mode).toBe("none");
      expect(p.patternFilter?.visibleCount).toBe(0);
      expect(p.sql).toContain("(code = 500)");
      expect(p.sql).not.toContain("match_all");
      expect(keys(p)).not.toContain("patternsUnusable");
    });

    it("falls back, and says why, when patterns exist but none are usable", () => {
      const p = buildPrefillFromPatterns(patterns({ templates: [WILDCARD_ONLY] }));

      expect(isPrefillBlocked(normalizePrefill(p))).toBe(false);
      expect(p.patternFilter?.mode).toBe("none");
      expect(keys(p)).toContain("patternsUnusable");
    });

    it("still blocks when a named single pattern cannot be used", () => {
      // The detail drawer names one pattern; alerting on the whole stream
      // instead would be wrong, not merely unhelpful.
      const p = buildPrefillFromPatterns(
        patterns({ templates: [WILDCARD_ONLY], requirePatterns: true }),
      );

      expect(keys(p)).toContain("noConstants");
      expect(isPrefillBlocked(normalizePrefill(p))).toBe(true);
    });

    it("drops an unusable pattern but keeps going when others are fine", () => {
      const p = buildPrefillFromPatterns(patterns({ templates: [ERROR_PATTERN, WILDCARD_ONLY] }));

      expect(keys(p)).toContain("noConstants");
      expect(isPrefillBlocked(normalizePrefill(p))).toBe(false);
      expect(p.meta?.appliedPatterns).toEqual([ERROR_PATTERN]);
    });

    it("blocks when no stream is known", () => {
      const p = buildPrefillFromPatterns(patterns({ streamName: "" }));
      expect(keys(p)).toContain("noStream");
      expect(isPrefillBlocked(normalizePrefill(p))).toBe(true);
    });

    it("says so when a SQL-mode query could not be carried over", () => {
      const p = buildPrefillFromPatterns(patterns({ baseFilterDropped: true }));
      expect(keys(p)).toContain("sqlModeFilterDropped");
    });
  });

  describe("shape", () => {
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
      expect(p.aggregation).toBeNull();
    });

    it("maps the time range to the rolling window", () => {
      expect(
        buildPrefillFromPatterns(
          patterns({ datetime: { type: "relative", relativeTimePeriod: "2h" } }),
        ).periodMinutes,
      ).toBe(120);
    });

    it("labels the selection by what it does", () => {
      expect(buildPrefillFromPatterns(patterns()).sourceLabel).toContain("ignored");
      expect(buildPrefillFromPatterns(patterns({ mode: "include" })).sourceLabel).toContain(
        "matched",
      );
    });

    it("combines a base filter with the pattern terms", () => {
      const p = buildPrefillFromPatterns(
        patterns({ templates: [TIMEOUT_PATTERN], baseFilter: "code = 500", mode: "exclude" }),
      );
      expect(p.sql).toBe(
        "SELECT count(*) AS cnt FROM 'k8s_logs' WHERE (code = 500) AND " +
          "NOT (match_all('Request deadline exceeded after'))",
      );
    });
  });
});
