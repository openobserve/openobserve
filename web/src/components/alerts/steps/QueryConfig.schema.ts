// Copyright 2026 OpenObserve Inc.
//
// Schema pieces for QueryConfig.vue.
//
// ── The tree shape (from FilterGroup.vue / FilterCondition.vue) ──
// The alert-conditions tree saved at `query_condition.conditions` is a single
// ROOT GROUP node whose `conditions[]` mixes two node kinds:
//   • condition leaf: { filterType: "condition", column, operator, value,
//     values: [], logicalOperator, id }            (FilterGroup.addCondition)
//   • nested group:   { filterType: "group", logicalOperator, groupId,
//     conditions: [...] }                          (FilterGroup.addGroup)
// FilterGroup.isGroup() additionally recognises a V1-legacy group shape
// (`items[]` + `groupId`); form mode renders only V2 `conditions[]` children,
// and the walker below mirrors that exactly.
//
// Validation timing is owned by OForm; this file only describes WHAT is valid.
// Requiredness is enforced by the `refineConditionsTree` walker — NOT by the
// structural node schemas — so the issue paths land on the exact nested field
// the OForm* wrapper is bound to (e.g. ["tree", "conditions", 1, "conditions",
// 0, "column"] → `tree.conditions[1].conditions[0].column`).

import { z } from "zod";

/** i18n translator injected by the component: `(key, namedParams?) => string`.
 *  Every user-facing validation message resolves through this against the
 *  `alerts.validation.*` locale keys. */
export type Translator = (key: string, named?: Record<string, unknown>) => string;

// ── Structural node schemas (deliberately loose) ────────────────────────────
// These describe SHAPE only. All per-field requiredness lives in
// `refineConditionsTree` so rules stay path-addressed and zero-safe; keeping
// the node schemas permissive guarantees an empty/absent tree parses clean.

/** One condition leaf (a FilterCondition row). */
export const conditionNodeSchema = z.looseObject({
  id: z.string().optional(),
  filterType: z.literal("condition").optional(),
  column: z.string().optional(),
  operator: z.string().optional(),
  // `value` may be a string, a number (0 is VALID — zero-safe), etc. Typed
  // `unknown` on purpose: requiredness is the walker's job.
  value: z.unknown().optional(),
  values: z.array(z.unknown()).optional(),
  logicalOperator: z.string().optional(),
});
export type ConditionNode = z.infer<typeof conditionNodeSchema>;

/** A group node — recursive: `conditions[]` holds leaves and/or sub-groups. */
export const conditionGroupNodeSchema = z.looseObject({
  filterType: z.literal("group").optional(),
  groupId: z.string().optional(),
  logicalOperator: z.string().optional(),
  get conditions() {
    return z.array(z.union([conditionGroupNodeSchema, conditionNodeSchema])).optional();
  },
});
export type ConditionGroupNode = z.infer<typeof conditionGroupNodeSchema>;

// ── Node-kind detection (mirrors FilterGroup.isGroup exactly) ───────────────
export function isConditionGroupNode(item: unknown): boolean {
  const node = item as Record<string, unknown> | null | undefined;
  // V2: filterType === "group" with a conditions array.
  if (node && node.filterType === "group" && Array.isArray(node.conditions)) {
    return true;
  }
  // V1 compatibility (legacy `items[]` + groupId) — recognised as a group so
  // it is never mis-validated as a condition leaf. It carries no V2
  // `conditions[]` rows, so the walker recurses into it and finds nothing.
  if (node && Array.isArray(node.items) && node.groupId) {
    return true;
  }
  return false;
}

// ── The recursive superRefine walker ────────────────────────────────────────
/**
 * Walk a conditions tree from `root` (a group node) and add one issue per
 * missing field of every condition leaf, at the EXACT nested path derived
 * from `basePath` (the path of `root` inside the form values, e.g.
 * `["query_condition", "conditions"]` — or `["tree"]` in specs).
 *
 * Per condition leaf:
 *   • `column`   — truthy-required
 *   • `operator` — truthy-required
 *   • `value`    — required but ZERO-SAFE: fails ONLY on undefined/null/""
 *     (numeric 0 PASSES — never `.min(1)` on a number)
 * Message is the caller-supplied `requiredMessage` (i18n
 * `alerts.validation.fieldRequired` → "Field is required!").
 *
 * An EMPTY tree (no root / no conditions / empty array) adds NO issues —
 * alerts save with zero conditions today.
 */
export function refineConditionsTree(
  root: unknown,
  ctx: z.RefinementCtx,
  basePath: (string | number)[] = [],
  requiredMessage = "",
): void {
  if (!root || typeof root !== "object") return;
  const children = (root as { conditions?: unknown }).conditions;
  if (!Array.isArray(children)) return;

  children.forEach((item, index) => {
    const itemPath = [...basePath, "conditions", index];

    if (isConditionGroupNode(item)) {
      refineConditionsTree(item, ctx, itemPath, requiredMessage);
      return;
    }

    if (!item || typeof item !== "object") return;
    const row = item as { column?: unknown; operator?: unknown; value?: unknown };

    if (!row.column) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...itemPath, "column"],
        message: requiredMessage,
      });
    }
    if (!row.operator) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...itemPath, "operator"],
        message: requiredMessage,
      });
    }
    if (row.value === undefined || row.value === null || row.value === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...itemPath, "value"],
        message: requiredMessage,
      });
    }
  });
}

// ── Standalone tree schema ──────────────────────────────────────────────────
/**
 * A root group node validated by the walker (basePath = [] — issue paths are
 * relative to the tree root, e.g. ["conditions", 0, "column"]). Used for
 * schema-level tests and anywhere the tree is validated on its own; the
 * QueryConfig/AddAlert form schemas call `refineConditionsTree` from their own
 * superRefine with the real basePath instead.
 */
export const makeConditionsTreeSchema = (t: Translator) =>
  conditionGroupNodeSchema.superRefine((root, ctx) =>
    refineConditionsTree(root, ctx, [], t("alerts.validation.fieldRequired")),
  );
export type ConditionsTree = z.infer<typeof conditionGroupNodeSchema>;

// ════════════════════════════════════════════════════════════════════════════
//  FULL QueryConfig form schema — QueryConfig scalars, group_by[], PromQL
//  conditions, aggregation, and the AlertSettings cross-step checks.
//
//  DESIGN — a SINGLE schema with a `_meta` discriminator object. QueryConfig's
//  mode (query tab, event-based vs metrics, realtime vs scheduled, the selected
//  function, the frequency unit, whether group-by / conditions exist,
//  aggregation on/off) is NOT itself form data — those are bare mode-selectors
//  (tabs, function dropdown, …). They are BRIDGED into the form as `_meta.*` via
//  `watch → setFieldValue`, and the superRefine reads `_meta` to fire each rule
//  ONLY in its branch. This lets ONE static schema cover every mode (OForm reads
//  `:schema` once at creation — a per-mode schema swap would not re-wire the
//  validators).
//
//  ⚠️ Numbers come out of OFormInput as STRINGS. Requiredness / min checks are
//  done in the superRefine on the RAW value so we control empty-vs-0 exactly
//  (z.coerce.number() would turn "" into 0 and silently pass a required check).
//  `promql_condition.value` is ZERO-SAFE (0 is valid; only undefined/null/"" fail).
// ════════════════════════════════════════════════════════════════════════════

// ── Validation messages are i18n-driven (`alerts.validation.*` locale keys),
//    resolved via the injected `t` inside `makeQueryConfigSchema`:
//      threshold ≥ 1   → alerts.validation.thresholdPositive
//      frequency ≥ 1   → alerts.validation.frequencyPositive
//      org min-freq    → alerts.validation.minimumFrequency ({minutes} = the
//                        ceil(min_auto_refresh_interval / 60) floor)
//      "value is"      → alerts.validation.fieldRequired
//      promql operator → alerts.validation.fieldRequired
//      promql value    → alerts.validation.fieldRequired
//      blank group-by  → alerts.validation.fieldRequired (per offending row;
//                        an EMPTY group_by is VALID)

/** The mode discriminators bridged into the form (NOT part of the alert
 *  payload — they gate the superRefine only). */
export interface QueryConfigMeta {
  tab: "custom" | "sql" | "promql";
  /** "true" | "false" | "anomaly" — string, mirrors the prop. */
  isRealTime: string;
  isEventBased: boolean;
  /** "total_events" (COUNT, no aggregation) or a measure function. */
  selectedFunction: string;
  frequencyMode: "minutes" | "hours" | "cron";
  hasConditions: boolean;
  hasGroupBy: boolean;
  aggregationEnabled: boolean;
  /** Org floor for the evaluation frequency, in SECONDS — raw
   *  `store.state.zoConfig.min_auto_refresh_interval`. Drives the
   *  "Minimum frequency should be N minutes" rule below. 0/absent → rule
   *  skipped (never invent a floor). */
  minAutoRefreshInterval: number;
}

/** True when the RAW input value is empty (unset). Shared by the number checks
 *  so "" / null / undefined always count as "not provided". */
const isBlank = (v: unknown): boolean => v === undefined || v === null || v === "";

/** A number field that must be present AND ≥ 1. Empty OR NaN OR < 1 → invalid.
 *  Operates on the raw (possibly string) value so 0 fails but "" is caught as
 *  "required" rather than silently coerced to 0. */
const isBelowOne = (v: unknown): boolean => {
  if (isBlank(v)) return true;
  const n = Number(v);
  return Number.isNaN(n) || n < 1;
};

/**
 * The full QueryConfig form schema. `looseObject` throughout so the many bridged
 * runtime keys (aggregation.function, conditions ids, values[], etc.) pass
 * through untouched — requiredness lives entirely in the superRefine, keyed on
 * `_meta`, so an untouched form parses clean.
 */
export const makeQueryConfigSchema = (t: Translator) =>
  z
    .looseObject({
      trigger_condition: z
        .looseObject({
          operator: z.string().optional(),
          threshold: z.unknown().optional(),
          frequency: z.unknown().optional(),
        })
        .optional(),
      query_condition: z
        .looseObject({
          conditions: conditionGroupNodeSchema.optional(),
          aggregation: z
            .looseObject({
              group_by: z.array(z.string()).optional(),
              function: z.string().optional(),
              having: z
                .looseObject({
                  column: z.string().optional(),
                  operator: z.string().optional(),
                  value: z.unknown().optional(),
                })
                .optional(),
            })
            .nullable()
            .optional(),
          promql_condition: z
            .looseObject({
              operator: z.string().optional(),
              value: z.unknown().optional(),
            })
            .nullable()
            .optional(),
        })
        .optional(),
      /** Logs/traces group-by lives on its own field (metrics group-by lives on
       *  query_condition.aggregation.group_by). */
      logGroupBy: z.array(z.string()).optional(),
      /** DISPLAY-ONLY form state — never sent to the backend (stripped by
       *  getAlertPayload alongside `_meta`/`logGroupBy`). `checkEvery` holds the
       *  number the user actually sees in the "Check every" input: a HOURS-count
       *  in hours mode, a MINUTES-count otherwise. The stored
       *  `trigger_condition.frequency` is ALWAYS minutes — QueryConfig's
       *  onCheckEveryChange bridges display → minutes. Both frequency rules live
       *  on this path because it is the one bound to the visible input. */
      _ui: z
        .looseObject({
          checkEvery: z.unknown().optional(),
        })
        .optional(),
      _meta: z.looseObject({
        tab: z.string(),
        isRealTime: z.string(),
        isEventBased: z.boolean(),
        selectedFunction: z.string(),
        frequencyMode: z.string(),
        hasConditions: z.boolean(),
        hasGroupBy: z.boolean(),
        aggregationEnabled: z.boolean(),
        minAutoRefreshInterval: z.number().optional(),
      }),
    })
    .superRefine((val, ctx) => {
      const meta = val._meta as QueryConfigMeta;
      const scheduled = meta.isRealTime === "false";
      const isCustom = meta.tab === "custom";
      const isSql = meta.tab === "sql";
      const isPromql = meta.tab === "promql";
      const isMeasure = meta.selectedFunction !== "total_events";

      const tc = (val.trigger_condition ?? {}) as Record<string, unknown>;
      const qc = (val.query_condition ?? {}) as Record<string, any>;

      // ── Conditions tree (custom mode, realtime + scheduled) ──────────────────
      // Blocks save on partially-filled rows.
      if (isCustom && qc.conditions) {
        refineConditionsTree(
          qc.conditions,
          ctx,
          ["query_condition", "conditions"],
          t("alerts.validation.fieldRequired"),
        );
      }

      // Everything below is SCHEDULED-only (realtime alerts show filters only —
      // no threshold sentence / "Check every").
      if (!scheduled) return;

      // ── Threshold ≥ 1 ────────────────────────────────────────────────────────
      // Shown+required in every scheduled branch: custom (count OR the measure
      // "having groups" — forced to 1 when no group-by, so ≥1 always holds), SQL
      // ("no. of events"), PromQL ("having series"). One rule covers them all.
      if (isBelowOne(tc.threshold)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["trigger_condition", "threshold"],
          message: t("alerts.validation.thresholdPositive"),
        });
      }

      // ── Frequency ≥ 1 ────────────────────────────────────────────────────────
      // Only when NOT in cron mode (cron is validated separately — the component
      // renders `cronError`, useAlertForm.runImperativeQueryChecks gates save).
      // Keyed on the DISPLAY value (`_ui.checkEvery`) because that is the path the
      // visible "Check every" input binds, so the message renders inline. Display
      // ≥ 1 ⇔ stored ≥ 1 in both modes (hours multiplies by 60).
      const ui = (val._ui ?? {}) as Record<string, unknown>;
      const display = ui.checkEvery;
      if (meta.frequencyMode !== "cron") {
        if (isBelowOne(display)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["_ui", "checkEvery"],
            message: t("alerts.validation.frequencyPositive"),
          });
        } else {
          // ── Org min-frequency floor ─────────────────────────────────────────
          // Compare the frequency in MINUTES against ceil(min_auto_refresh_interval
          // / 60): convert the display value the same way onCheckEveryChange does.
          // Skipped entirely when the org sets no floor.
          const floorSecs = Number(meta.minAutoRefreshInterval) || 0;
          if (floorSecs > 0) {
            const freqMins =
              meta.frequencyMode === "hours" ? Number(display) * 60 : Number(display);
            const floorMins = Math.ceil(floorSecs / 60);
            if (freqMins < floorMins) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["_ui", "checkEvery"],
                message: t("alerts.validation.minimumFrequency", {
                  minutes: floorMins,
                }),
              });
            }
          }
        }
      }

      // ── PromQL branch ────────────────────────────────────────────────────────
      if (isPromql) {
        const pc = (qc.promql_condition ?? {}) as Record<string, unknown>;
        if (!pc.operator) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["query_condition", "promql_condition", "operator"],
            message: t("alerts.validation.fieldRequired"),
          });
        }
        // ZERO-SAFE: 0 is a valid PromQL threshold; only unset fails.
        if (isBlank(pc.value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["query_condition", "promql_condition", "value"],
            message: t("alerts.validation.fieldRequired"),
          });
        }
      }

      // ── Custom + measure aggregation ─────────────────────────────────────────
      if (isCustom && isMeasure) {
        const having = (qc.aggregation?.having ?? {}) as Record<string, unknown>;

        // ── Measure column — required ───────────────────────────────────────────
        // Must live in form state, not an imperative gate: the two selects are
        // name-bound <OFormSelect>, which derives `:error` from
        // `field.state.meta.errors` and OMITS a parent-passed `:error`. Form state
        // is the ONLY thing that can paint the field.
        //
        // ONE path covers BOTH branches — the logs select and the metrics select
        // bind the same `query_condition.aggregation.having.column` name.
        //
        // Predicate: aggregation ON + an aggregation object carrying a non-count
        // function.
        const aggregation = qc.aggregation;
        const fn = aggregation?.function;
        if (meta.aggregationEnabled && aggregation && fn && fn !== "total_events") {
          // Trim-aware — a whitespace-only column is not a column.
          const column = having.column;
          if (column == null || String(column).trim() === "") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["query_condition", "aggregation", "having", "column"],
              message: t("alerts.validation.aggregationColumnRequired"),
            });
          }
        }

        // "value is" field — required (non-empty).
        if (isBlank(having.value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["query_condition", "aggregation", "having", "value"],
            message: t("alerts.validation.fieldRequired"),
          });
        }
        // Group-by rows — PARITY with pre-migration AlertSettings.validate()
        // (HEAD ~828-837): "if any are added, they must not be empty".
        //   • EMPTY group_by array  → VALID. A measure alert with NO group-by
        //     saves, exactly as before. alertPayload.ts (~:88-96) is purpose-built
        //     for that state: it forces threshold=1 / operator=">=" because the
        //     "Having groups" row is hidden. Requiring a group-by here would make
        //     that pre-existing branch dead code.
        //   • A BLANK row          → INVALID (the old loop rejected any empty
        //     entry). The issue is attached to THAT row's index so the row's own
        //     <OFormSelect> (name="…group_by[i]" / "logGroupBy[i]") surfaces it,
        //     matching the old "show inline error only" behavior.
        // Predicate `!g` mirrors the old `!field || field === ""` exactly.
        if (meta.aggregationEnabled) {
          const groupByPath = meta.isEventBased
            ? ["logGroupBy"]
            : ["query_condition", "aggregation", "group_by"];
          const groupBy =
            (meta.isEventBased
              ? (val.logGroupBy as unknown[])
              : (qc.aggregation?.group_by as unknown[])) ?? [];
          if (Array.isArray(groupBy)) {
            groupBy.forEach((g, i) => {
              if (!g) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: [...groupByPath, i],
                  message: t("alerts.validation.fieldRequired"),
                });
              }
            });
          }
        }
      }
    });

export type QueryConfigForm = z.infer<ReturnType<typeof makeQueryConfigSchema>>;

/**
 * Typed defaults projected from the parent-owned runtime model (props). A
 * factory over the live records, NOT an inline literal (playbook Step-1). The
 * `_meta` block seeds the discriminators from the initial props; the component
 * keeps them fresh via `watch → setFieldValue`.
 */
export const queryConfigDefaults = (args: {
  triggerCondition: Record<string, any> | null | undefined;
  inputData: Record<string, any> | null | undefined;
  logGroupBy: string[];
  meta: QueryConfigMeta;
}): QueryConfigForm => {
  const tc = args.triggerCondition ?? {};
  const inputData = args.inputData ?? {};
  return {
    trigger_condition: {
      operator: tc.operator ?? ">=",
      threshold: tc.threshold ?? 1,
      frequency: tc.frequency ?? 10,
    },
    query_condition: {
      conditions: inputData.conditions ?? {
        filterType: "group",
        logicalOperator: "AND",
        groupId: "",
        conditions: [],
      },
      aggregation: inputData.aggregation ?? null,
      promql_condition: inputData.promql_condition ?? null,
    },
    logGroupBy: [...args.logGroupBy],
    _meta: { ...args.meta },
  } as QueryConfigForm;
};
