// Copyright 2026 OpenObserve Inc.
//
// Validation schema for AddSettingVariable.vue. Scalar fields are schema-driven
// via a single conditional superRefine on type/scope; cross-field rules that
// cannot be expressed in Zod (filter-cycle detection via API, AddPanel
// duplicate-name) run imperatively after the schema passes.
//
// Required BEFORE rules:
//   • name              → required + `^[a-zA-Z0-9_-]*$` regex
//   • selectedTabs       → required when scope is "tabs" | "panels"
//   • selectedPanels     → required when scope is "panels"
//   • query_data.stream_type → required when type === "query_values"
//   • query_data.stream / field + filter_group conditions → required for an auto query_values
//   • query_data.query   → required for a custom query_values
//   • value (constant)   → required+trim when type === "constant"
//
// Dynamic arrays are form-owned field-arrays; their row rules are enforced in
// the conditional superRefine (only for the relevant `type`) so a
// non-`custom`/non-`query_values` type's default rows never block submit.

import { z } from "zod";
import { PROMQL_FILTER_OPERATORS } from "@/utils/dashboard/variables/queryVariableUtils";
import {
  createFilterGroup,
  filterGroupHasNesting,
  filterGroupHasOr,
  getFilterConditionIssues,
  type VariableFilterCondition,
  type VariableFilterGroup,
  type VariableFilterIssue,
} from "@/utils/dashboard/variables/variableFilterGroupUtils";

export { FILTER_OPERATORS_WITHOUT_VALUE } from "@/utils/dashboard/variables/variableFilterGroupUtils";

export const VARIABLE_NAME_REGEX = /^[a-zA-Z0-9_-]*$/;

const filterConditionSchema: z.ZodType<VariableFilterCondition> = z.object({
  filterType: z.literal("condition"),
  type: z.literal("condition"),
  column: z
    .object({
      field: z.string().nullable().optional(),
      streamAlias: z.string().nullable().optional(),
    })
    .nullable(),
  operator: z.string().nullable().optional(),
  value: z.string().nullable().optional(),
  values: z.array(z.string()),
  logicalOperator: z.string(),
});

const filterGroupSchema: z.ZodType<VariableFilterGroup> = z.lazy(() =>
  z.object({
    filterType: z.literal("group"),
    logicalOperator: z.string(),
    conditions: z.array(z.union([filterConditionSchema, filterGroupSchema])),
  }),
);

const FILTER_ISSUE_PATHS: Record<VariableFilterIssue, string[]> = {
  field: ["column", "field"],
  operator: ["operator"],
  promqlOperator: ["operator"],
  value: ["value"],
};

const FILTER_ISSUE_MESSAGES: Record<VariableFilterIssue, string> = {
  field: "dashboard.fieldRequired",
  operator: "dashboard.operatorRequired",
  promqlOperator: "dashboard.queryVariable.promqlOperatorUnsupported",
  value: "dashboard.filterValueRequired",
};

const addFilterGroupIssues = (
  group: VariableFilterGroup,
  path: (string | number)[],
  isPromql: boolean,
  ctx: z.RefinementCtx,
  t: (_key: string) => string,
) => {
  group.conditions.forEach((node, index) => {
    const nodePath = [...path, "conditions", index];
    if (node.filterType === "group") {
      addFilterGroupIssues(node, nodePath, isPromql, ctx, t);
      return;
    }
    getFilterConditionIssues(node, isPromql ? PROMQL_FILTER_OPERATORS : undefined).forEach(
      (issue) =>
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...nodePath, ...FILTER_ISSUE_PATHS[issue]],
          message: t(FILTER_ISSUE_MESSAGES[issue]),
        }),
    );
  });
};

export const makeAddSettingVariableSchema = (t: (_key: string) => string) =>
  z
    .object({
      scope: z.string().optional().default("global"),
      // selectedTabs / selectedPanels are form-owned top-level fields.
      selectedTabs: z.array(z.string()).optional().default([]),
      selectedPanels: z.array(z.string()).optional().default([]),
      type: z.string().optional().default("query_values"),
      // No .trim() here: a saved name must be referenceable as `$name`, and the
      // dependency graph extracts refs with `\$([a-zA-Z0-9_-]+)`. `.trim()` would
      // let "test_form " pass validation yet be saved with the space (TanStack
      // does not apply the transform to the submitted value), producing a name
      // that `$test_form` can never match. Validate the raw value so any
      // whitespace is rejected outright.
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
          max_record_size: z.union([z.number(), z.string(), z.null()]).optional(),
          // form-owned filter tree; condition rules enforced in superRefine below.
          filter_group: filterGroupSchema.optional().default(createFilterGroup("AND", [])),
          query_type: z.string().optional().default("sql"),
          custom_query: z.boolean().optional().default(false),
          query: z.string().optional().default(""),
          value_field: z.string().nullable().optional().default(""),
          label_field: z.string().nullable().optional().default(""),
        })
        .optional()
        // Fully-shaped default: zod v4's .default() returns the value as-is
        // (no inner-default fill), so it must match the output shape.
        .default({
          stream_type: "",
          stream: "",
          field: "",
          filter_group: createFilterGroup("AND", []),
          query_type: "sql",
          custom_query: false,
          query: "",
          value_field: "",
          label_field: "",
        }),
      value: z.string().optional().default(""),
      // form-owned custom option rows; row rules enforced in superRefine below.
      options: z.array(z.record(z.string(), z.any())).optional().default([]),
      multiSelect: z.boolean().optional().default(false),
      hideOnDashboard: z.boolean().optional().default(false),
      selectAllValueForMultiSelect: z.string().optional().default("first"),
      customMultiSelectValue: z.array(z.string()).optional().default([]),
      // Escaping is unconditional now; kept only so old saved dashboards still parse.
      escapeSingleQuotes: z.boolean().optional().default(true),
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
      const isAutoQuery = val.type === "query_values" && !val.query_data?.custom_query;
      const isPromql = val.query_data?.query_type === "promql";
      if (val.type === "query_values" && !val.query_data?.stream_type) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["query_data", "stream_type"],
          message: t("dashboard.streamTypeRequired"),
        });
      }
      if (isAutoQuery) {
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
      if (
        val.type === "query_values" &&
        val.query_data?.custom_query &&
        !String(val.query_data?.query ?? "").trim()
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["query_data", "query"],
          message: t("dashboard.queryVariable.queryRequired"),
        });
      }
      if (val.type === "constant" && !String(val.value ?? "").trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["value"],
          message: t("dashboard.constantValueRequired"),
        });
      }

      // Filter conditions (only for an auto query_values), at any depth.
      if (isAutoQuery && val.query_data?.filter_group) {
        const group = val.query_data.filter_group;
        addFilterGroupIssues(group, ["query_data", "filter_group"], isPromql, ctx, t);
        if (isPromql && (filterGroupHasOr(group) || filterGroupHasNesting(group))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["query_data", "filter_group"],
            message: t("dashboard.queryVariable.promqlFiltersAndOnly"),
          });
        }
      }

      // Custom option rows (only for custom). label required; value required+trim.
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

export type AddSettingVariableForm = z.infer<ReturnType<typeof makeAddSettingVariableSchema>>;
