// Copyright 2026 OpenObserve Inc.
//
// Schema-level tests for the conditions-tree pieces of QueryConfig.schema.ts
// (alerts-migration.md §A item 4): the recursive refineConditionsTree walker +
// the loose node schemas. Component-level (real <OForm>) coverage lives in
// the shared condition builder's own specs.

import { describe, it, expect } from "vitest";
import { z } from "zod";
import i18n from "@/locales";
import {
  conditionGroupNodeSchema,
  isConditionGroupNode,
  refineConditionsTree,
  makeConditionsTreeSchema,
  makeQueryConfigSchema,
  queryConfigDefaults,
  type QueryConfigMeta,
} from "./QueryConfig.schema";

// Messages are i18n-driven now — resolve them through the real locale so the
// assertions verify the exact English (parity) AND that the keys exist.
const t = (key: string, named?: Record<string, unknown>): string =>
  (i18n.global.t as any)(key, named);
const conditionsTreeSchema = makeConditionsTreeSchema(t);
const queryConfigSchema = makeQueryConfigSchema(t);
const CONDITION_REQUIRED_MESSAGE = t("alerts.validation.fieldRequired");
const THRESHOLD_REQUIRED_MESSAGE = t("alerts.validation.limitWholeNumber");
const FREQUENCY_REQUIRED_MESSAGE = t("alerts.validation.frequencyPositive");
const CONDITION_VALUE_REQUIRED_MESSAGE = t("alerts.guard.thresholdRequired", { example: "90" });
const AGGREGATION_COLUMN_REQUIRED_MESSAGE = t("alerts.validation.aggregationColumnRequired");
const PROMQL_OPERATOR_REQUIRED_MESSAGE = t("alerts.validation.fieldRequired");
const PROMQL_VALUE_REQUIRED_MESSAGE = t("alerts.guard.thresholdRequired", { example: "90" });

// Builders matching the V2 shapes the condition builder writes.
const leaf = (overrides: Record<string, unknown> = {}) => ({
  filterType: "condition",
  column: "field1",
  operator: "=",
  value: "x",
  values: [],
  logicalOperator: "AND",
  id: "leaf-id",
  ...overrides,
});

const group = (conditions: unknown[], overrides: Record<string, unknown> = {}) => ({
  filterType: "group",
  logicalOperator: "AND",
  groupId: "group-id",
  conditions,
  ...overrides,
});

const issuesOf = (result: { success: boolean; error?: any }) =>
  result.success ? [] : result.error.issues;

describe("QueryConfig.schema — conditions tree", () => {
  describe("conditionsTreeSchema (root walker, basePath = [])", () => {
    it("passes an EMPTY tree — no rows adds no issues (alerts save with zero conditions)", () => {
      expect(conditionsTreeSchema.safeParse(group([])).success).toBe(true);
      // A root with no conditions key at all is also clean.
      expect(conditionsTreeSchema.safeParse({ filterType: "group" }).success).toBe(true);
    });

    it("passes a complete condition row", () => {
      expect(conditionsTreeSchema.safeParse(group([leaf()])).success).toBe(true);
    });

    it("fails a partial row at the RIGHT nested paths (column + value empty on row 1)", () => {
      const result = conditionsTreeSchema.safeParse(
        group([leaf(), leaf({ column: "", value: "" })]),
      );
      expect(result.success).toBe(false);
      const issues = issuesOf(result);
      expect(issues).toHaveLength(2);
      expect(issues[0]).toMatchObject({
        path: ["conditions", 1, "column"],
        message: CONDITION_REQUIRED_MESSAGE,
      });
      expect(issues[1]).toMatchObject({
        path: ["conditions", 1, "value"],
        message: CONDITION_REQUIRED_MESSAGE,
      });
    });

    it("fails a missing operator at its exact path", () => {
      const result = conditionsTreeSchema.safeParse(group([leaf({ operator: "" })]));
      expect(result.success).toBe(false);
      const issues = issuesOf(result);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        path: ["conditions", 0, "operator"],
        message: CONDITION_REQUIRED_MESSAGE,
      });
    });

    it("value is ZERO-SAFE: numeric 0 passes", () => {
      expect(conditionsTreeSchema.safeParse(group([leaf({ value: 0 })])).success).toBe(true);
    });

    it("unary operators need no value", () => {
      for (const operator of ["is_null", "is_not_null", "is_empty", "is_not_empty"]) {
        expect(conditionsTreeSchema.safeParse(group([leaf({ operator, value: "" })])).success).toBe(
          true,
        );
      }
    });

    it('value fails ONLY on undefined / null / ""', () => {
      for (const bad of ["", null, undefined]) {
        const result = conditionsTreeSchema.safeParse(group([leaf({ value: bad })]));
        expect(result.success).toBe(false);
        const issues = issuesOf(result);
        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({
          path: ["conditions", 0, "value"],
          message: CONDITION_REQUIRED_MESSAGE,
        });
      }
      // Other falsy-but-present values pass (zero-safe, not truthy-required).
      expect(conditionsTreeSchema.safeParse(group([leaf({ value: false })])).success).toBe(true);
    });

    it("recurses into nested groups — issue paths carry the exact nested indices", () => {
      const tree = group([
        leaf(),
        group([leaf(), leaf({ column: "" })], { groupId: "nested-group" }),
      ]);
      const result = conditionsTreeSchema.safeParse(tree);
      expect(result.success).toBe(false);
      const issues = issuesOf(result);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        path: ["conditions", 1, "conditions", 1, "column"],
        message: CONDITION_REQUIRED_MESSAGE,
      });
    });
  });

  describe("refineConditionsTree with a real basePath (the future query_condition wiring)", () => {
    const hostSchema = z
      .object({
        query_condition: z.object({ conditions: conditionGroupNodeSchema }),
      })
      .superRefine((val, ctx) =>
        refineConditionsTree(
          val.query_condition.conditions,
          ctx,
          ["query_condition", "conditions"],
          CONDITION_REQUIRED_MESSAGE,
        ),
      );

    it("prefixes issue paths with the basePath", () => {
      const result = hostSchema.safeParse({
        query_condition: { conditions: group([leaf({ operator: "" })]) },
      });
      expect(result.success).toBe(false);
      expect(issuesOf(result)[0]).toMatchObject({
        path: ["query_condition", "conditions", "conditions", 0, "operator"],
        message: CONDITION_REQUIRED_MESSAGE,
      });
    });

    it("adds no issues for an empty tree under the basePath", () => {
      expect(hostSchema.safeParse({ query_condition: { conditions: group([]) } }).success).toBe(
        true,
      );
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  //  Full form schema (scalars, §4 PromQL restores, REHOMED cross-step checks)
  // ════════════════════════════════════════════════════════════════════════
  describe("queryConfigSchema — mode-discriminated form rules", () => {
    const meta = (overrides: Partial<QueryConfigMeta> = {}): QueryConfigMeta => ({
      tab: "custom",
      isRealTime: "false",
      isEventBased: true,
      selectedFunction: "total_events",
      frequencyMode: "minutes",
      hasConditions: false,
      hasGroupBy: false,
      aggregationEnabled: false,
      minAutoRefreshInterval: 0,
      ...overrides,
    });

    const form = (overrides: Record<string, any> = {}) => ({
      trigger_condition: {
        operator: ">=",
        threshold: 3,
        // STORED minutes. The frequency RULES key off `_ui.checkEvery` (the
        // display value bound to the visible input) — see below.
        frequency: 10,
        ...(overrides.trigger_condition || {}),
      },
      query_condition: {
        conditions: group([]),
        aggregation: null,
        promql_condition: null,
        sql: "SELECT 1",
        promql: "up",
        ...(overrides.query_condition || {}),
      },
      stream_type: overrides.stream_type ?? "logs",
      logGroupBy: overrides.logGroupBy ?? [],
      // DISPLAY value: equals the stored minutes in minutes mode, stored/60 in
      // hours mode.
      _ui: { checkEvery: 10, ...(overrides._ui || {}) },
      _meta: meta(overrides._meta),
    });

    const parse = (overrides: Record<string, any> = {}) =>
      queryConfigSchema.safeParse(form(overrides));
    const paths = (r: any) => (r.success ? [] : r.error.issues.map((i: any) => i.path.join(".")));

    it("a valid scheduled count alert passes", () => {
      expect(parse().success).toBe(true);
    });

    it("blocks save while the condition builder reports an unfinished filter", () => {
      const r = parse({ _meta: { conditionsValid: false } });
      expect(paths(r)).toContain("query_condition.conditions");
      expect(parse({ _meta: { conditionsValid: true } }).success).toBe(true);
      expect(parse({ _meta: { conditionsValid: false, tab: "sql" } }).success).toBe(true);
    });

    // ── Threshold (REHOMED, scheduled) ──────────────────────────────────────
    it("blocks empty threshold (scheduled)", () => {
      const r = parse({ trigger_condition: { threshold: "" } });
      expect(r.success).toBe(false);
      expect(paths(r)).toContain("trigger_condition.threshold");
      expect(r.error!.issues[0].message).toBe(THRESHOLD_REQUIRED_MESSAGE);
    });

    it.each([0, "0", -5, 2.5, "2.5"])("blocks threshold %s (scheduled)", (threshold) => {
      const r = parse({ trigger_condition: { threshold } });
      expect(paths(r)).toContain("trigger_condition.threshold");
      expect(r.error!.issues[0].message).toBe(THRESHOLD_REQUIRED_MESSAGE);
    });

    it("coerces a numeric STRING threshold — '5' passes", () => {
      expect(parse({ trigger_condition: { threshold: "5" } }).success).toBe(true);
    });

    it("does NOT require threshold in realtime mode", () => {
      const r = parse({
        trigger_condition: { threshold: "" },
        _meta: { isRealTime: "true" },
      });
      expect(paths(r)).not.toContain("trigger_condition.threshold");
    });

    // ── Frequency (REHOMED, scheduled, non-cron) ────────────────────────────
    // The rule keys off the DISPLAY value (`_ui.checkEvery`) because that is the
    // path the visible "Check every" input binds, so the message renders inline.
    it("blocks empty frequency when not cron", () => {
      const r = parse({ _ui: { checkEvery: "" } });
      expect(paths(r)).toContain("_ui.checkEvery");
      expect(r.error!.issues.find((i: any) => i.path.join(".") === "_ui.checkEvery")!.message).toBe(
        FREQUENCY_REQUIRED_MESSAGE,
      );
    });

    it("does NOT require frequency in cron mode (the cron rule owns it)", () => {
      const r = parse({
        _ui: { checkEvery: "" },
        _meta: { frequencyMode: "cron" },
      });
      expect(paths(r)).not.toContain("_ui.checkEvery");
    });

    const cron = (expression: string, timezone = "UTC") => ({
      trigger_condition: { frequency_type: "cron", cron: expression, timezone },
      _meta: { frequencyMode: "cron", minAutoRefreshInterval: 300 },
    });
    it.each([
      ["a blank expression", cron(""), t("alerts.queryConfig.cronExpressionTimezoneRequired")],
      [
        "no timezone",
        cron("0 */10 * * * *", ""),
        t("alerts.queryConfig.cronExpressionTimezoneRequired"),
      ],
      ["five fields", cron("0 9 * * 1-5"), t("alerts.validation.cronSixFields")],
      ["an unparseable one", cron("a b c d e f"), t("alerts.queryConfig.invalidCronExpression")],
      [
        "one below the org floor",
        cron("0 * * * * *"),
        t("alerts.queryConfig.frequencyGreaterThanSeconds", { seconds: 299 }),
      ],
      ["a valid one", cron("0 */10 * * * *"), undefined],
    ])("checks a cron schedule with %s", (_, overrides, message) => {
      const r = parse(overrides);
      const issue = r.success
        ? undefined
        : r.error.issues.find((i: any) => i.path.join(".") === "trigger_condition.cron");
      expect(issue?.message).toBe(message);
    });

    it.each([
      ["SQL with nothing written", { tab: "sql" }, { sql: "", promql: "" }, "query_condition.sql"],
      [
        "PromQL with nothing written",
        { tab: "promql" },
        { sql: "", promql: "" },
        "query_condition.promql",
      ],
      [
        "SQL while filters hold the query",
        { tab: "sql" },
        { sql: "", conditions: group([leaf()]) },
        null,
      ],
      ["SQL with a query", { tab: "sql" }, {}, null],
    ])("asks for a query: %s", (_, metaOver, qcOver, path) => {
      const r = parse({ stream_type: "metrics", query_condition: qcOver, _meta: metaOver });
      const queryPaths = paths(r).filter((p: string) => /^query_condition\.(sql|promql)$/.test(p));
      expect(queryPaths).toEqual(path ? [path] : []);
    });

    it("blocks save on a PromQL by-label the metric lacks, with the guard's own message", () => {
      const issue = "instance isn't a label of node_cpu_seconds_total.";
      const promql = { tab: "promql" as const, isEventBased: false, promqlLabelIssue: issue };
      const query_condition = { promql_condition: { operator: ">", value: 90 } };
      const found = (r: any) =>
        r.success
          ? undefined
          : r.error.issues.find((i: any) => i.path.join(".") === "query_condition.promql");
      expect(found(parse({ query_condition, _meta: promql }))?.message).toBe(issue);
      expect(found(parse({ query_condition, _meta: { ...promql, tab: "sql" } }))).toBeUndefined();
    });

    // ── Org min-frequency floor (R5 RESTORE) ────────────────────────────────
    // Pre-migration AlertSettings.validateFrequency compared the STORED minutes
    // against ceil(min_auto_refresh_interval / 60) and blocked save.
    const FLOOR_MSG = (mins: number) => "Minimum frequency should be " + mins + " minutes";

    it("blocks a frequency below the org floor (minutes mode)", () => {
      // 300s → floor 5 min. Display 3 min < 5.
      const r = parse({
        _ui: { checkEvery: 3 },
        trigger_condition: { frequency: 3 },
        _meta: { minAutoRefreshInterval: 300 },
      });
      expect(paths(r)).toContain("_ui.checkEvery");
      expect(r.error!.issues.find((i: any) => i.path.join(".") === "_ui.checkEvery")!.message).toBe(
        FLOOR_MSG(5),
      );
    });

    it("uses ceil() for a non-whole-minute org floor (90s → 2 minutes)", () => {
      const r = parse({
        _ui: { checkEvery: 1 },
        trigger_condition: { frequency: 1 },
        _meta: { minAutoRefreshInterval: 90 },
      });
      expect(r.error!.issues.find((i: any) => i.path.join(".") === "_ui.checkEvery")!.message).toBe(
        FLOOR_MSG(2),
      );
    });

    it("allows a frequency exactly AT the org floor", () => {
      const r = parse({
        _ui: { checkEvery: 5 },
        trigger_condition: { frequency: 5 },
        _meta: { minAutoRefreshInterval: 300 },
      });
      expect(paths(r)).not.toContain("_ui.checkEvery");
    });

    it("compares the floor in MINUTES — hours mode converts display*60", () => {
      // Display 1 hour = 60 min, floor 5 min → passes even though 1 < 5.
      const r = parse({
        _ui: { checkEvery: 1 },
        trigger_condition: { frequency: 60 },
        _meta: { frequencyMode: "hours", minAutoRefreshInterval: 300 },
      });
      expect(paths(r)).not.toContain("_ui.checkEvery");
    });

    it("does NOT apply the org floor in cron mode", () => {
      const r = parse({
        _ui: { checkEvery: 1 },
        trigger_condition: { frequency: 1 },
        _meta: { frequencyMode: "cron", minAutoRefreshInterval: 300 },
      });
      expect(paths(r)).not.toContain("_ui.checkEvery");
    });

    it("does NOT invent a floor when minAutoRefreshInterval is absent/0", () => {
      const r = parse({
        _ui: { checkEvery: 1 },
        trigger_condition: { frequency: 1 },
        _meta: { minAutoRefreshInterval: 0 },
      });
      expect(paths(r)).not.toContain("_ui.checkEvery");
    });

    // ── §4 PromQL restores ──────────────────────────────────────────────────
    it("PromQL: blocks empty operator", () => {
      const r = parse({
        _meta: { tab: "promql", isEventBased: false, selectedFunction: "total_events" },
        query_condition: { promql_condition: { operator: "", value: 5 } },
      });
      expect(paths(r)).toContain("query_condition.promql_condition.operator");
      expect(r.error!.issues.find((i: any) => i.path.join(".").endsWith("operator"))!.message).toBe(
        PROMQL_OPERATOR_REQUIRED_MESSAGE,
      );
    });

    it("PromQL: value is ZERO-SAFE — 0 PASSES", () => {
      const r = parse({
        _meta: { tab: "promql", isEventBased: false },
        query_condition: { promql_condition: { operator: ">=", value: 0 } },
      });
      expect(paths(r)).not.toContain("query_condition.promql_condition.value");
      expect(r.success).toBe(true);
    });

    it('PromQL: value "" / null / undefined are BLOCKED', () => {
      for (const bad of ["", null, undefined]) {
        const r = parse({
          _meta: { tab: "promql", isEventBased: false },
          query_condition: { promql_condition: { operator: ">=", value: bad } },
        });
        expect(paths(r)).toContain("query_condition.promql_condition.value");
        expect(r.error!.issues.find((i: any) => i.path.join(".").endsWith("value"))!.message).toBe(
          PROMQL_VALUE_REQUIRED_MESSAGE,
        );
      }
    });

    it("PromQL restores DO NOT fire in custom mode", () => {
      const r = parse({
        query_condition: { promql_condition: { operator: "", value: "" } },
      });
      expect(paths(r)).not.toContain("query_condition.promql_condition.operator");
      expect(paths(r)).not.toContain("query_condition.promql_condition.value");
    });

    it("PromQL restores DO NOT fire in sql mode", () => {
      const r = parse({
        _meta: { tab: "sql" },
        query_condition: { promql_condition: { operator: "", value: "" } },
      });
      expect(paths(r)).not.toContain("query_condition.promql_condition.operator");
    });

    // ── Measure column (RESTORE of the red highlight main drew via
    // QueryConfig's `columnSelectError` ref). The rule is SCHEMA-owned so the
    // name-bound <OFormSelect> renders it; the issue path is what paints the
    // field, so assert the path, not just the failure. ──────────────────────
    const measureAgg = (overrides: Record<string, any> = {}) => ({
      _meta: { selectedFunction: "avg", aggregationEnabled: true },
      query_condition: {
        aggregation: {
          function: "avg",
          group_by: [],
          having: { column: "field2", operator: ">=", value: 5 },
          ...(overrides.aggregation || {}),
        },
      },
      ...(overrides.rest || {}),
    });

    const withColumn = (column: unknown) =>
      measureAgg({
        aggregation: { having: { column, operator: ">=", value: 5 } },
      });

    it("custom measure: blocks an empty aggregation column", () => {
      const r = parse(withColumn(""));
      expect(paths(r)).toContain("query_condition.aggregation.having.column");
      expect(r.error!.issues.find((i: any) => i.path.join(".").endsWith("column"))!.message).toBe(
        AGGREGATION_COLUMN_REQUIRED_MESSAGE,
      );
    });

    // Parity with the old `!col || col.trim() === ''` predicate.
    it("custom measure: blocks a whitespace-only aggregation column", () => {
      expect(paths(parse(withColumn("   ")))).toContain(
        "query_condition.aggregation.having.column",
      );
    });

    it("custom measure: blocks a missing aggregation column", () => {
      expect(paths(parse(withColumn(undefined)))).toContain(
        "query_condition.aggregation.having.column",
      );
    });

    it("custom measure: a set aggregation column is VALID", () => {
      expect(paths(parse(withColumn("field2")))).not.toContain(
        "query_condition.aggregation.having.column",
      );
    });

    // ── Gate parity (Rule ④ — the rule must fire in EXACTLY the states the old
    // imperative check did: aggregation ON + an aggregation object carrying a
    // non-count function). Each of these used to save and must still save. ───
    it("count mode (total_events): an empty column is VALID", () => {
      const r = parse({
        _meta: { selectedFunction: "total_events", aggregationEnabled: true },
        query_condition: {
          aggregation: {
            function: "total_events",
            group_by: [],
            having: { column: "", operator: ">=", value: 5 },
          },
        },
      });
      expect(paths(r)).not.toContain("query_condition.aggregation.having.column");
    });

    it("aggregation OFF: an empty column is VALID", () => {
      const r = parse({
        _meta: { selectedFunction: "avg", aggregationEnabled: false },
        query_condition: {
          aggregation: {
            function: "avg",
            group_by: [],
            having: { column: "", operator: ">=", value: 5 },
          },
        },
      });
      expect(paths(r)).not.toContain("query_condition.aggregation.having.column");
    });

    it("no aggregation object: an empty column is VALID", () => {
      const r = parse({
        _meta: { selectedFunction: "avg", aggregationEnabled: true },
        query_condition: { aggregation: null },
      });
      expect(paths(r)).not.toContain("query_condition.aggregation.having.column");
    });

    it("sql tab: the measure column rule does not apply", () => {
      const r = parse({
        _meta: { tab: "sql", selectedFunction: "avg", aggregationEnabled: true },
        query_condition: {
          aggregation: {
            function: "avg",
            group_by: [],
            having: { column: "", operator: ">=", value: 5 },
          },
        },
      });
      expect(paths(r)).not.toContain("query_condition.aggregation.having.column");
    });

    // ── Measure aggregation (REHOMED + conditionValue) ──────────────────────
    it("custom measure: blocks empty having.value", () => {
      const r = parse({
        _meta: { selectedFunction: "avg", aggregationEnabled: true },
        logGroupBy: ["field1"],
        query_condition: {
          aggregation: {
            group_by: ["field1"],
            having: { column: "field2", operator: ">=", value: "" },
          },
        },
      });
      expect(paths(r)).toContain("query_condition.aggregation.having.value");
      expect(r.error!.issues.find((i: any) => i.path.join(".").endsWith("value"))!.message).toBe(
        CONDITION_VALUE_REQUIRED_MESSAGE,
      );
    });

    // PARITY (pre-migration AlertSettings.validate(): "if any are added, they
    // must not be empty"). An EMPTY group_by is VALID — a measure alert with no
    // group-by saves, and alertPayload.ts (~:88-96) is purpose-built for that
    // state (forces threshold=1 / operator=">="). Only BLANK rows are rejected.
    it("custom measure (logs): an EMPTY group-by is VALID (no group-by saves)", () => {
      const r = parse({
        _meta: { selectedFunction: "avg", aggregationEnabled: true, isEventBased: true },
        logGroupBy: [],
        query_condition: {
          aggregation: {
            group_by: [],
            having: { column: "field2", operator: ">=", value: 5 },
          },
        },
      });
      expect(paths(r)).not.toContain("logGroupBy");
      expect(paths(r)).not.toContain("logGroupBy.0");
    });

    it("custom measure (metrics): an EMPTY group-by is VALID (no group-by saves)", () => {
      const r = parse({
        _meta: {
          selectedFunction: "avg",
          aggregationEnabled: true,
          isEventBased: false,
        },
        query_condition: {
          aggregation: {
            group_by: [],
            having: { column: "value", operator: ">=", value: 5 },
          },
        },
      });
      expect(paths(r)).not.toContain("query_condition.aggregation.group_by");
      expect(paths(r)).not.toContain("query_condition.aggregation.group_by.0");
    });

    it("custom measure (logs): a BLANK group-by row blocks, flagged on that row", () => {
      const r = parse({
        _meta: { selectedFunction: "avg", aggregationEnabled: true, isEventBased: true },
        logGroupBy: ["field1", ""],
        query_condition: {
          aggregation: {
            group_by: ["field1", ""],
            having: { column: "field2", operator: ">=", value: 5 },
          },
        },
      });
      // Flagged at the OFFENDING index (name="logGroupBy[1]"), not the array.
      expect(paths(r)).toContain("logGroupBy.1");
      expect(paths(r)).not.toContain("logGroupBy.0");
    });

    it("custom measure (metrics): a BLANK group-by row blocks, flagged on that row", () => {
      const r = parse({
        _meta: {
          selectedFunction: "avg",
          aggregationEnabled: true,
          isEventBased: false,
        },
        query_condition: {
          aggregation: {
            group_by: ["", "field2"],
            having: { column: "value", operator: ">=", value: 5 },
          },
        },
      });
      expect(paths(r)).toContain("query_condition.aggregation.group_by.0");
      expect(paths(r)).not.toContain("query_condition.aggregation.group_by.1");
    });

    it("custom measure with a group-by + value passes", () => {
      const r = parse({
        _meta: {
          selectedFunction: "avg",
          aggregationEnabled: true,
          isEventBased: true,
          hasGroupBy: true,
        },
        logGroupBy: ["field1"],
        query_condition: {
          aggregation: {
            group_by: ["field1"],
            having: { column: "field2", operator: ">=", value: 5 },
          },
        },
      });
      expect(r.success).toBe(true);
    });

    it("measure rules DO NOT fire for total_events (count)", () => {
      const r = parse({
        _meta: { selectedFunction: "total_events" },
        query_condition: {
          aggregation: {
            group_by: [],
            having: { column: "", operator: ">=", value: "" },
          },
        },
      });
      expect(paths(r)).not.toContain("query_condition.aggregation.having.value");
      expect(paths(r)).not.toContain("logGroupBy");
    });

    // ── Conditions tree (custom, both modes) ────────────────────────────────
    it("blocks a partial condition row in custom mode (RESTORE)", () => {
      const r = parse({
        query_condition: {
          conditions: group([leaf({ column: "" })]),
        },
      });
      expect(paths(r)).toContain("query_condition.conditions.conditions.0.column");
    });

    it("conditions tree is validated even in realtime custom mode", () => {
      const r = parse({
        _meta: { isRealTime: "true" },
        query_condition: { conditions: group([leaf({ value: "" })]) },
      });
      expect(paths(r)).toContain("query_condition.conditions.conditions.0.value");
    });

    // ── Warning/critical matrix (alerts_2.md §4.5) — blocks submit ──────────
    describe("warning threshold matrix", () => {
      it("count family: warning >= critical for '>=' blocks submit at the field path", () => {
        const r = parse({
          _meta: { tab: "sql" },
          trigger_condition: { operator: ">=", threshold: 3, warning_threshold: 5 },
        });
        expect(r.success).toBe(false);
        expect(paths(r)).toContain("trigger_condition.warning_threshold");
      });

      it.each([
        [">=", 250000000000, "alerts.validation.warnBeforeLower", { limit: "2,500,000,000" }],
        [">", 2500000000, "alerts.validation.warnBeforeLower", { limit: "2,500,000,000" }],
        ["<=", 2000000000, "alerts.validation.warnBeforeHigher", { limit: "2,500,000,000" }],
        ["<", 2500000000, "alerts.validation.warnBeforeHigher", { limit: "2,500,000,000" }],
        [
          "=",
          3,
          "alerts.validation.warnNotWith",
          { comparison: t("alerts.sections.operators.eq") },
        ],
        [
          "!=",
          3,
          "alerts.validation.warnNotWith",
          { comparison: t("alerts.sections.operators.ne") },
        ],
        [">=", -1, "alerts.validation.limitWholeNumber", {}],
        ["<=", 2.5, "alerts.validation.limitWholeNumber", {}],
      ])(
        "a bad warning count for '%s' (%s) says how to fix it",
        (operator, warning, key, named) => {
          const r = parse({
            _meta: { tab: "sql" },
            trigger_condition: { operator, threshold: 2500000000, warning_threshold: warning },
          });
          const issue = issuesOf(r).find(
            (i: any) => i.path.join(".") === "trigger_condition.warning_threshold",
          );
          expect(issue.message).toBe(t(key, named));
        },
      );

      it("count family: warning below critical passes (strings included)", () => {
        expect(
          parse({
            _meta: { tab: "sql" },
            trigger_condition: { operator: ">=", threshold: "5", warning_threshold: "3" },
          }).success,
        ).toBe(true);
      });

      it("blank warning = single-level alert = valid", () => {
        expect(
          parse({
            _meta: { tab: "sql" },
            trigger_condition: { operator: ">=", threshold: 3, warning_threshold: "" },
          }).success,
        ).toBe(true);
      });

      it("unordered operators (=, !=) reject any warning", () => {
        const r = parse({
          _meta: { tab: "sql" },
          trigger_condition: { operator: "=", threshold: 3, warning_threshold: 2 },
        });
        expect(paths(r)).toContain("trigger_condition.warning_threshold");
      });

      it("aggregation family: warning_value vs having.value on having.operator", () => {
        const agg = {
          group_by: ["host"],
          function: "avg",
          having: { column: "value", operator: "<=", value: 90 },
          // For <= the warning must be HIGHER than critical; 80 is wrong.
          warning_value: 80,
        };
        const r = parse({
          _meta: { selectedFunction: "avg", aggregationEnabled: true },
          query_condition: { aggregation: agg },
        });
        expect(paths(r)).toContain("query_condition.aggregation.warning_value");

        expect(
          parse({
            _meta: { selectedFunction: "avg", aggregationEnabled: true },
            query_condition: { aggregation: { ...agg, warning_value: 96 } },
          }).success,
        ).toBe(true);
      });

      it("promql family: promql_warning_value vs promql_condition", () => {
        const r = parse({
          _meta: { tab: "promql" },
          query_condition: {
            promql_condition: { operator: ">=", value: 1 },
            promql_warning_value: 2,
          },
        });
        expect(paths(r)).toContain("query_condition.promql_warning_value");

        expect(
          parse({
            _meta: { tab: "promql" },
            query_condition: {
              promql_condition: { operator: ">=", value: 1 },
              promql_warning_value: 0.5,
            },
          }).success,
        ).toBe(true);
      });
    });
  });

  describe("queryConfigDefaults", () => {
    it("projects trigger_condition / conditions / group-by / meta from props", () => {
      const defaults = queryConfigDefaults({
        triggerCondition: { operator: ">", threshold: 7, frequency: 15 },
        inputData: { conditions: group([leaf()]), aggregation: null },
        logGroupBy: ["a", "b"],
        meta: {
          tab: "custom",
          isRealTime: "false",
          isEventBased: true,
          selectedFunction: "total_events",
          frequencyMode: "minutes",
          hasConditions: true,
          hasGroupBy: false,
          aggregationEnabled: false,
        },
      });
      expect(defaults.trigger_condition!.threshold).toBe(7);
      expect(defaults.trigger_condition!.operator).toBe(">");
      expect(defaults.logGroupBy).toEqual(["a", "b"]);
      expect((defaults._meta as any).tab).toBe("custom");
      // A fresh copy of logGroupBy (not the same array reference).
      expect(defaults.logGroupBy).not.toBe(undefined);
    });

    it("falls back to sane defaults when props are empty", () => {
      const defaults = queryConfigDefaults({
        triggerCondition: null,
        inputData: null,
        logGroupBy: [],
        meta: {
          tab: "custom",
          isRealTime: "false",
          isEventBased: true,
          selectedFunction: "total_events",
          frequencyMode: "minutes",
          hasConditions: false,
          hasGroupBy: false,
          aggregationEnabled: false,
        },
      });
      expect(defaults.trigger_condition!.threshold).toBe(1);
      expect(defaults.trigger_condition!.operator).toBe(">=");
      expect(defaults.trigger_condition!.frequency).toBe(10);
    });
  });

  describe("isConditionGroupNode", () => {
    it("recognises V2 groups and rejects condition leaves", () => {
      expect(isConditionGroupNode(group([]))).toBe(true);
      expect(isConditionGroupNode(leaf())).toBe(false);
      expect(isConditionGroupNode(null)).toBe(false);
      expect(isConditionGroupNode(undefined)).toBe(false);
    });

    it("recognises V1-legacy groups (items[] + groupId) so they are never validated as leaves", () => {
      const v1 = { groupId: "legacy", items: [] };
      expect(isConditionGroupNode(v1)).toBe(true);
      // The walker recurses into it, finds no V2 conditions[] rows → no issues.
      expect(conditionsTreeSchema.safeParse(group([v1])).success).toBe(true);
    });
  });
});
