// Copyright 2026 OpenObserve Inc.
//
// Validation schema for AddSettingVariable.vue. This form was "shell-only": it
// rendered an <OForm> with NO :schema, so its validate() was a no-op and every
// required field was enforced by a hand-rolled onSubmit. This schema makes the
// SCALAR fields schema-driven (a single conditional superRefine on type/scope);
// the cross-field rules that cannot be expressed in Zod (filter-cycle detection
// via API, AddPanel duplicate-name) still run imperatively AFTER the schema
// passes.
//
// Restored / preserved BEFORE rules (complete-validation-inventory):
//   • name              → required + `^[a-zA-Z0-9_-]*$` regex
//   • selectedTabs       → required when scope is "tabs" | "panels"
//   • selectedPanels     → required when scope is "panels"
//   • query_data.stream_type / stream / field → required when type === "query_values"
//   • value (constant)   → required+trim when type === "constant"
//
// Dynamic arrays are now FORM-OWNED field-arrays (the field-array pattern):
//   • query_data.filter[] (name / operator / value) — restores §4 #6: `value`
//     is required for value-needing operators (was `v?.length > 0 || 'Required'`).
//   • options[] (label / value / selected) — restores §4 #7: `value` required+trim
//     (was `!!v.trim() || 'Field is required!'`).
//   • customMultiSelectValue[] (string rows) — form-owned, no validation rule.
// Row rules are enforced in the conditional superRefine (only for the relevant
// `type`) so a non-`custom`/non-`query_values` type's default rows never block.
// Every control is an OForm* bound by name (the filter value is OFormCombobox,
// selectAllValueForMultiSelect is OFormToggleGroup); the owner reads form state
// via form.useStore (no mirror), so the #6 rule gates submit directly.
//
// Validation TIMING is owned by OForm (submit-then-change).

import { z } from "zod";

export const VARIABLE_NAME_REGEX = /^[a-zA-Z0-9_-]*$/;

// Operators that do NOT need a value (the filter value field is hidden for them).
export const FILTER_OPERATORS_WITHOUT_VALUE = ["Is Null", "Is Not Null"];

export const makeAddSettingVariableSchema = (t: (_key: string) => string) =>
  z
    .object({
      scope: z.string().optional().default("global"),
      // selectedTabs / selectedPanels are sibling refs (not nested under
      // variableData) — form-owned top-level fields.
      selectedTabs: z.array(z.string()).optional().default([]),
      selectedPanels: z.array(z.string()).optional().default([]),
      type: z.string().optional().default("query_values"),
      // NO .trim() here (matches main): a saved name must be referenceable as
      // `$name`, and the dependency graph extracts refs with `\$([a-zA-Z0-9_-]+)`.
      // `.trim()` would let a value like "test_form " PASS validation (trimmed)
      // yet be SAVED with the space (TanStack does not apply the transform to the
      // submitted value), producing a name that `$test_form` can never match —
      // silently breaking parent↔child dependencies. Validate the RAW value so
      // any leading/trailing/internal whitespace is rejected outright.
      name: z
        .string()
        .min(1, t("dashboard.variableNameRequired"))
        .regex(VARIABLE_NAME_REGEX, t("dashboard.variableNameInvalid")),
      label: z.string().optional().default(""),
      query_data: z
        .object({
          stream_type: z.string().optional().default(""),
          stream: z.string().optional().default(""),
          field: z.string().optional().default(""),
          // number <input> emits string / null — keep loose, not validated.
          max_record_size: z
            .union([z.number(), z.string(), z.null()])
            .optional(),
          // form-owned filter rows; row rules enforced in superRefine below.
          filter: z.array(z.record(z.string(), z.any())).optional().default([]),
        })
        .optional()
        .default({}),
      value: z.string().optional().default(""),
      // form-owned custom option rows; row rules enforced in superRefine below.
      options: z.array(z.record(z.string(), z.any())).optional().default([]),
      multiSelect: z.boolean().optional().default(false),
      hideOnDashboard: z.boolean().optional().default(false),
      // bare OToggleGroup, bridged through the mirror sync.
      selectAllValueForMultiSelect: z.string().optional().default("first"),
      customMultiSelectValue: z
        .array(z.string())
        .optional()
        .default([]),
      escapeSingleQuotes: z.boolean().optional().default(false),
    })
    .superRefine((val, ctx) => {
      if (
        (val.scope === "tabs" || val.scope === "panels") &&
        (val.selectedTabs ?? []).length === 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["selectedTabs"],
          message: t("dashboard.atLeastOneTabRequired"),
        });
      }
      if (val.scope === "panels" && (val.selectedPanels ?? []).length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["selectedPanels"],
          message: t("dashboard.atLeastOnePanelRequired"),
        });
      }
      if (val.type === "query_values") {
        if (!val.query_data?.stream_type) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["query_data", "stream_type"],
            message: t("dashboard.streamTypeRequired"),
          });
        }
        if (!val.query_data?.stream) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["query_data", "stream"],
            message: t("dashboard.streamIndexRequired"),
          });
        }
        if (!val.query_data?.field) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["query_data", "field"],
            message: t("dashboard.fieldRequired"),
          });
        }
      }
      if (val.type === "constant" && !String(val.value ?? "").trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["value"],
          message: t("dashboard.constantValueRequired"),
        });
      }

      // Filter rows (only for query_values). name + operator required per row;
      // value required for value-needing operators (restored §4 #6).
      if (val.type === "query_values") {
        (val.query_data?.filter ?? []).forEach((row: any, i: number) => {
          if (!String(row?.name ?? "").trim()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["query_data", "filter", i, "name"],
              message: t("dashboard.fieldRequired"),
            });
          }
          if (!String(row?.operator ?? "").trim()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["query_data", "filter", i, "operator"],
              message: t("dashboard.operatorRequired"),
            });
          }
          const needsValue = !FILTER_OPERATORS_WITHOUT_VALUE.includes(
            String(row?.operator ?? ""),
          );
          if (needsValue && String(row?.value ?? "").length === 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["query_data", "filter", i, "value"],
              message: t("dashboard.filterValueRequired"),
            });
          }
        });
      }

      // Custom option rows (only for custom). label required; value required+trim
      // (restored §4 #7).
      if (val.type === "custom") {
        (val.options ?? []).forEach((row: any, i: number) => {
          if (!String(row?.label ?? "").trim()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["options", i, "label"],
              message: t("dashboard.labelRequired"),
            });
          }
          if (!String(row?.value ?? "").trim()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["options", i, "value"],
              message: t("dashboard.optionValueRequired"),
            });
          }
        });
      }
    });

export type AddSettingVariableForm = z.infer<
  ReturnType<typeof makeAddSettingVariableSchema>
>;
