// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import type { I18nKey, I18nText, TranslateFn } from "@/types/i18n";
import type { DimensionCondition } from "@/services/downtimes";
import { SESSION_FIELDS } from "@/components/rum/productAnalytics/AppSettings.schema";
import { conditionError } from "@/utils/downtimes/conditionRules";
import {
  FILTER_FIELDS,
  isFilterColumn,
  MAX_KEY_LENGTH,
  MAX_REGEX_LENGTH,
  regexProblem,
  type SessionField,
} from "@/utils/rum/productAnalyticsModel";
import {
  OPERATORS,
  type FilterArity,
  type FilterDialect,
  type FilterFieldType,
  type FilterGroup,
  type FilterOperatorId,
} from "@/utils/query/filterBar";
import {
  anomalyCodec,
  dashboardFilterCodec,
  dashboardVariableCodec,
  downtimeCodec,
  engineCodec,
  leafConditions,
  metricsLabelsCodec,
  modelPricingCodec,
  profilesCodec,
  promqlLabelsCodec,
  rumExclusionCodec,
  rumFunnelCodec,
  sqlCodec,
  syntheticsCodec,
  TIER_CONDITION_ONLY,
  TIER_RULE_OPERATORS,
  type FilterCodec,
  type ModelPricingFilter,
} from "./codecs";

export type FilterLayout = "horizontal" | "vertical";

/** `per-item`: each connector toggles alone; `per-group`: one AND/OR for a whole group; `and-only`: no OR. */
export type FilterConnectorMode = "per-item" | "per-group" | "and-only";

/** `requireComplete`: an unfinished condition makes the filter invalid; `dropIncomplete`: it is left out on save. */
export type FilterValidationMode = "requireComplete" | "dropIncomplete" | "none";

export type FilterProfileName =
  | "logs"
  | "traces"
  | "metrics"
  | "promql-builder"
  | "alert"
  | "pipeline"
  | "workflow"
  | "eval"
  | "annotation"
  | "downtime"
  | "dashboard-panel"
  | "dashboard-variable"
  | "anomaly"
  | "profiles"
  | "rum-funnel"
  | "rum-exclusion"
  | "synthetics"
  | "model-pricing";

export interface FilterLimits {
  /** Conditions (locked parts included) the whole filter may hold. */
  maxConditions?: number;
  /** Values one list condition may hold. */
  maxValues?: number;
  /** One condition per field; a used field leaves the picker. */
  uniqueFields?: boolean;
}

/** One problem the builder reports; `nodeId` is the chip it belongs to, null for the filter as a whole. */
export interface FilterIssue {
  nodeId: string | null;
  message: I18nText;
}

/** How the editing surface behaves; QueryFilterBar takes this, a profile adds a codec and validation. */
export interface FilterEditorConfig {
  layout: FilterLayout;
  /** `promql` spells regex operators `=~` / `!~` and names fields "labels". */
  dialect: FilterDialect;
  operators: Record<FilterFieldType, FilterOperatorId[]>;
  /** Names a page used before the shared builder, shown instead of the dashboard names. */
  operatorNames?: Partial<Record<FilterOperatorId, I18nKey>>;
  /** Where a format takes a list for an operator that usually takes one value. */
  arity?: Partial<Record<FilterOperatorId, FilterArity>>;
  /** Group levels allowed, the root included; 1 is a flat list, null is unlimited. */
  maxDepth: number | null;
  connectors: FilterConnectorMode;
  /** Offer a "search all text" row (SQL `match_all`). */
  freeText: boolean;
  /** Let the user name a field that is not in `fields`. */
  allowCustomFields: boolean;
  /** An empty filter shows a "Where · choose a field" line ready to click. */
  startWithEmptyRow: boolean;
  limits: FilterLimits;
}

export interface FilterValidationContext<T = unknown> {
  t: TranslateFn;
  /** The value the codec writes for this tree. */
  saved: T;
}

export interface FilterProfile<T = any> extends FilterEditorConfig {
  name: FilterProfileName;
  codec: FilterCodec<T>;
  validation: FilterValidationMode;
  /** At least one complete condition is needed. */
  required: boolean;
  /** Rules beyond completeness, mirroring the backend's own checks. */
  validate?: (tree: FilterGroup, context: FilterValidationContext<T>) => FilterIssue[];
}

const forAll = (ids: FilterOperatorId[]): Record<FilterFieldType, FilterOperatorId[]> => ({
  string: ids,
  number: ids,
  boolean: ids,
});

const SQL_STRING: FilterOperatorId[] = [
  "eq",
  "neq",
  "contains",
  "contains_ci",
  "not_contains",
  "starts_with",
  "ends_with",
  "in",
  "not_in",
  "regex",
  "not_regex",
  "is_null",
  "is_not_null",
];

const SQL_OPERATORS: Record<FilterFieldType, FilterOperatorId[]> = {
  string: SQL_STRING,
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in", "is_null", "is_not_null"],
  boolean: ["eq", "neq", "is_null", "is_not_null"],
};

const PROMQL_OPERATORS = forAll(["eq", "neq", "regex", "not_regex", "in", "not_in"]);

// Alerts offer every operator on every column today, so a type never takes one away.
const ENGINE_OPERATORS = forAll([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "contains_ci",
  "not_contains",
  "starts_with",
  "ends_with",
  "in",
  "not_in",
  "regex",
  "not_regex",
  "is_null",
  "is_not_null",
  "is_empty",
  "is_not_empty",
]);

const DASHBOARD_LIST: FilterOperatorId[] = [
  "eq",
  "neq",
  "gte",
  "lte",
  "gt",
  "lt",
  "in",
  "not_in",
  "contains",
  "contains_ci",
  "not_contains",
  "starts_with",
  "ends_with",
  "match_all",
  "regex",
  "not_regex",
  "is_null",
  "is_not_null",
];

// `= ''` fails on a number or boolean column in SQL, so the blank checks are offered on text only.
const DASHBOARD_OPERATORS: Record<FilterFieldType, FilterOperatorId[]> = {
  string: [...DASHBOARD_LIST, "is_empty", "is_not_empty"],
  number: DASHBOARD_LIST,
  boolean: DASHBOARD_LIST,
};

const RUM_FUNNEL_LIST: FilterOperatorId[] = [
  "in",
  "not_in",
  "contains",
  "not_contains",
  "starts_with",
  "not_starts_with",
  "ends_with",
  "not_ends_with",
  "regex",
  "not_regex",
];

const RUM_FUNNEL_NAMES: Partial<Record<FilterOperatorId, I18nKey>> = {
  in: "rum.analytics.funnel.conditions.in",
  not_in: "rum.analytics.funnel.conditions.notIn",
  contains: "rum.analytics.funnel.conditions.contains",
  not_contains: "rum.analytics.funnel.conditions.notContains",
  starts_with: "rum.analytics.funnel.conditions.prefix",
  not_starts_with: "rum.analytics.funnel.conditions.notPrefix",
  ends_with: "rum.analytics.funnel.conditions.suffix",
  not_ends_with: "rum.analytics.funnel.conditions.notSuffix",
  regex: "rum.analytics.funnel.conditions.regex",
  not_regex: "rum.analytics.funnel.conditions.notRegex",
};

const RUM_EXCLUSION_NAMES: Partial<Record<FilterOperatorId, I18nKey>> = {
  in: "rum.analytics.exclusions.ops.in",
  contains: "rum.analytics.exclusions.ops.contains",
  starts_with: "rum.analytics.exclusions.ops.prefix",
  ends_with: "rum.analytics.exclusions.ops.suffix",
  regex: "rum.analytics.exclusions.ops.regex",
};

const RUM_MANY: Partial<Record<FilterOperatorId, FilterArity>> = Object.fromEntries(
  RUM_FUNNEL_LIST.map((id) => [id, "many"]),
);

export const MAX_RUM_FILTERS = 10;
export const MAX_RUM_VALUES = 20;
export const MAX_RUM_EXCLUSIONS = 20;
export const MAX_PROFILE_VALUES = 1000;
export const MAX_PROFILE_REGEX_LENGTH = 1024;
export const MAX_DOWNTIME_PAIRS = 32;
export const MAX_DOWNTIME_DEPTH = 3;
export const MAX_TIER_RULES = 8;

const horizontalSql = {
  layout: "horizontal",
  dialect: "sql",
  operators: SQL_OPERATORS,
  maxDepth: null,
  connectors: "per-item",
  freeText: true,
  allowCustomFields: false,
  startWithEmptyRow: false,
  limits: {},
  codec: sqlCodec(),
  validation: "none",
  required: false,
} as const;

const promql = {
  layout: "horizontal",
  dialect: "promql",
  operators: PROMQL_OPERATORS,
  maxDepth: 1,
  connectors: "and-only",
  freeText: false,
  allowCustomFields: true,
  startWithEmptyRow: false,
  limits: {},
  validation: "dropIncomplete",
  required: false,
} as const;

const engine = {
  layout: "vertical",
  dialect: "sql",
  operators: ENGINE_OPERATORS,
  maxDepth: null,
  connectors: "per-item",
  freeText: false,
  startWithEmptyRow: true,
  limits: {},
  codec: engineCodec(),
  validation: "requireComplete",
} as const;

const flat = {
  dialect: "sql",
  maxDepth: 1,
  connectors: "and-only",
  freeText: false,
  allowCustomFields: false,
  startWithEmptyRow: false,
  limits: {},
  required: false,
} as const;

const downtimeIssues = (
  tree: FilterGroup,
  { t, saved }: FilterValidationContext<DimensionCondition | null>,
): FilterIssue[] => {
  const issues: FilterIssue[] = [];
  for (const node of leafConditions(tree)) {
    const value = node.values[0] ?? "";
    if (value === "*")
      issues.push({ nodeId: node.id, message: t("alerts.downtimes.validation.loneStar") });
    else if (value.slice(0, -1).includes("*"))
      issues.push({ nodeId: node.id, message: t("alerts.downtimes.validation.innerStar") });
  }
  const error = conditionError(saved);
  // Blank keys and values are already marked on their chips by the completeness check.
  const onChips =
    error === "alerts.downtimes.validation.pairKey" ||
    error === "alerts.downtimes.validation.pairValue";
  if (error && !onChips && !issues.length) issues.push({ nodeId: null, message: t(error) });
  return issues;
};

const funnelField = (field: string) =>
  FILTER_FIELDS.includes(field as SessionField) || isFilterColumn(field);

// App settings hide sessions by a fixed field list, page-wide `env` and `version` included.
const exclusionField = (field: string) => SESSION_FIELDS.includes(field as SessionField);

// Mirrors the RUM analytics server, which rejects the whole definition on any bad rule.
const rumIssues =
  (fieldOk: (field: string) => boolean) =>
  (tree: FilterGroup, { t }: FilterValidationContext): FilterIssue[] =>
    leafConditions(tree).flatMap((node): FilterIssue[] => {
      if (node.field && !fieldOk(node.field))
        return [{ nodeId: node.id, message: t("filterBar.validation.rumField") }];
      if (node.values.some((v) => !v || v.length > MAX_KEY_LENGTH))
        return [
          {
            nodeId: node.id,
            message: t("filterBar.validation.valueLength", { max: MAX_KEY_LENGTH }),
          },
        ];
      if (node.operator !== "regex" && node.operator !== "not_regex") return [];
      const problem = node.values.map(regexProblem).find(Boolean);
      if (!problem) return [];
      const message =
        problem === "length"
          ? t("filterBar.validation.regexLength", { max: MAX_REGEX_LENGTH })
          : t("filterBar.validation.regexInvalid");
      return [{ nodeId: node.id, message }];
    });

// The profiles API compiles regex with Rust's engine; JS catches the common mistakes before the round trip.
const profilesIssues = (tree: FilterGroup, { t }: FilterValidationContext): FilterIssue[] =>
  leafConditions(tree).flatMap((node): FilterIssue[] => {
    if (node.operator !== "regex" && node.operator !== "not_regex") return [];
    const pattern = node.values[0] ?? "";
    if (pattern.length > MAX_PROFILE_REGEX_LENGTH)
      return [
        {
          nodeId: node.id,
          message: t("filterBar.validation.regexLength", { max: MAX_PROFILE_REGEX_LENGTH }),
        },
      ];
    try {
      new RegExp(pattern);
      return [];
    } catch {
      return [{ nodeId: node.id, message: t("filterBar.validation.regexInvalid") }];
    }
  });

const modelPricingIssues = (
  tree: FilterGroup,
  { t, saved }: FilterValidationContext<ModelPricingFilter>,
): FilterIssue[] => {
  const equality = leafConditions(tree).filter((node) =>
    TIER_CONDITION_ONLY.includes(node.operator),
  );
  const issues: FilterIssue[] = equality.slice(1).map((node) => ({
    nodeId: node.id,
    message: t("filterBar.validation.oneUsageCondition"),
  }));
  // The usage condition is separate, so the server's cap counts rules alone.
  if ((saved?.rules?.length ?? 0) > MAX_TIER_RULES)
    issues.push({
      nodeId: null,
      message: t("filterBar.limits.conditions", { count: MAX_TIER_RULES }, MAX_TIER_RULES),
    });
  return issues;
};

/** Every page's filter rules, by name; a page passes the name and its own saved value. */
export const FILTER_PROFILES: Record<FilterProfileName, FilterProfile> = {
  logs: { ...horizontalSql, name: "logs" },
  traces: { ...horizontalSql, name: "traces" },
  metrics: { ...promql, name: "metrics", codec: metricsLabelsCodec() },
  "promql-builder": { ...promql, name: "promql-builder", codec: promqlLabelsCodec() },
  alert: { ...engine, name: "alert", allowCustomFields: false, required: false },
  pipeline: { ...engine, name: "pipeline", allowCustomFields: true, required: true },
  workflow: { ...engine, name: "workflow", allowCustomFields: true, required: true },
  eval: { ...engine, name: "eval", allowCustomFields: true, required: false },
  annotation: {
    ...engine,
    name: "annotation",
    allowCustomFields: false,
    startWithEmptyRow: false,
    validation: "dropIncomplete",
    required: false,
  },
  downtime: {
    name: "downtime",
    layout: "vertical",
    dialect: "sql",
    operators: forAll(["eq", "neq"]),
    maxDepth: MAX_DOWNTIME_DEPTH,
    connectors: "per-group",
    freeText: false,
    allowCustomFields: false,
    startWithEmptyRow: true,
    limits: { maxConditions: MAX_DOWNTIME_PAIRS },
    codec: downtimeCodec(),
    validation: "requireComplete",
    required: false,
    validate: downtimeIssues,
  },
  "dashboard-panel": {
    name: "dashboard-panel",
    layout: "horizontal",
    dialect: "sql",
    operators: DASHBOARD_OPERATORS,
    maxDepth: null,
    connectors: "per-item",
    freeText: false,
    allowCustomFields: false,
    startWithEmptyRow: false,
    limits: {},
    codec: dashboardFilterCodec(),
    validation: "requireComplete",
    required: false,
  },
  "dashboard-variable": {
    ...flat,
    name: "dashboard-variable",
    layout: "vertical",
    operators: forAll(DASHBOARD_LIST),
    codec: dashboardVariableCodec(),
    validation: "requireComplete",
  },
  anomaly: {
    ...flat,
    name: "anomaly",
    layout: "vertical",
    operators: forAll(DASHBOARD_LIST),
    codec: anomalyCodec(),
    validation: "requireComplete",
  },
  profiles: {
    ...flat,
    name: "profiles",
    layout: "horizontal",
    dialect: "promql",
    operators: forAll(["eq", "neq", "regex", "not_regex", "in", "not_in"]),
    // The server ANDs label filters, so a second value of one label would match nothing.
    limits: { uniqueFields: true, maxValues: MAX_PROFILE_VALUES },
    codec: profilesCodec(),
    validation: "dropIncomplete",
    validate: profilesIssues,
  },
  "rum-funnel": {
    ...flat,
    name: "rum-funnel",
    layout: "horizontal",
    operators: forAll(RUM_FUNNEL_LIST),
    operatorNames: RUM_FUNNEL_NAMES,
    arity: RUM_MANY,
    allowCustomFields: true,
    limits: { maxConditions: MAX_RUM_FILTERS, maxValues: MAX_RUM_VALUES, uniqueFields: true },
    codec: rumFunnelCodec(),
    validation: "dropIncomplete",
    validate: rumIssues(funnelField),
  },
  "rum-exclusion": {
    ...flat,
    name: "rum-exclusion",
    layout: "horizontal",
    operators: forAll(["in", "contains", "starts_with", "ends_with", "regex"]),
    operatorNames: RUM_EXCLUSION_NAMES,
    arity: RUM_MANY,
    limits: { maxConditions: MAX_RUM_EXCLUSIONS, maxValues: MAX_RUM_VALUES },
    codec: rumExclusionCodec(),
    validation: "dropIncomplete",
    validate: rumIssues(exclusionField),
  },
  synthetics: {
    ...flat,
    name: "synthetics",
    layout: "vertical",
    operators: forAll(["eq", "neq", "lt", "gt", "contains", "not_contains"]),
    codec: syntheticsCodec(),
    validation: "requireComplete",
  },
  "model-pricing": {
    ...flat,
    name: "model-pricing",
    layout: "vertical",
    // Only a plain usage key (number) can hold the usage condition's = / !=; an attribute rule cannot.
    operators: {
      string: TIER_RULE_OPERATORS,
      number: [...TIER_RULE_OPERATORS, ...TIER_CONDITION_ONLY],
      boolean: TIER_RULE_OPERATORS,
    },
    allowCustomFields: true,
    limits: { maxConditions: MAX_TIER_RULES + 1 },
    codec: modelPricingCodec(),
    validation: "requireComplete",
    validate: modelPricingIssues,
  },
};

/** How many values an operator takes under this config. */
export const arityFor = (
  config: Pick<FilterEditorConfig, "arity">,
  id: FilterOperatorId,
): FilterArity => config.arity?.[id] ?? OPERATORS[id].arity;

/** The editing config QueryFilterBar falls back to when it is given a dialect instead of a profile. */
export const dialectConfig = (
  dialect: FilterDialect,
  freeText: boolean,
  allowCustomFields: boolean,
): FilterEditorConfig => {
  const base = dialect === "promql" ? FILTER_PROFILES.metrics : FILTER_PROFILES.logs;
  return { ...base, freeText, allowCustomFields };
};
