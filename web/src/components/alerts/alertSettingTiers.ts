// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import type { I18nKey } from "@/types/i18n";
import type { AlertSectionId } from "./alertFormSections";

/** add = its own "+ name" link; more = named on the More options line; smart = more, and a suggestion may offer it. */
export type AlertSettingTier = "add" | "more" | "smart";
export type AlertKind = "scheduled" | "realtime" | "anomaly" | "composite";
export type AlertQueryShape = "filters" | "sql" | "promql" | "anomaly" | "composite";

export type AlertSettingId =
  | "generatedSql"
  | "vrl"
  | "warning"
  | "groupBy"
  | "ruleExpression"
  | "forecast"
  | "compareWithPast"
  | "holdFor"
  | "anomalySql"
  | "anomalyRetrain"
  | "anomalyDirection"
  | "anomalyWindow"
  | "anomalySqlPreview"
  | "compositeExpression"
  | "compositeWarningCounts"
  | "compositeStalePolicy"
  | "createsIncident"
  | "template"
  | "rowTemplate"
  | "variables"
  | "anomalyTemplate"
  | "recovery"
  | "keepFiring"
  | "suppressRepeats"
  | "oncall"
  | "anomalyRecordOnly"
  | "cron"
  | "description"
  | "tags"
  | "priority"
  | "anomalyTags"
  | "anomalyPriority";

export interface AlertSettingTierDef {
  id: AlertSettingId;
  section: AlertSectionId;
  tier: AlertSettingTier;
  nameKey: I18nKey;
  /** The owning step renders its "+ name" link beside the control it extends. */
  inline?: boolean;
  row?: "message";
}

export interface AlertTierContext {
  kind: AlertKind;
  shape: AlertQueryShape;
  aggregate: boolean;
  incidentsEnabled: boolean;
  oncallEnabled: boolean;
  suppressRepeatsEnabled: boolean;
  /** False until a stream gives the builder a query to show, and fields to group by. */
  generatedSql?: boolean;
}

/** The form fields the tier rules read; structural, so the loosely typed form fits. */
export interface AlertTierForm {
  description?: unknown;
  tags?: unknown[];
  priority?: unknown;
  template?: unknown;
  row_template?: unknown;
  context_attributes?: unknown[];
  creates_incident?: boolean;
  notify_on_recovery?: boolean;
  recovery_destinations?: unknown[];
  keep_firing_for?: unknown;
  suppress_repeats?: boolean;
  oncall_team?: unknown;
  pending_period_sec?: unknown;
  logGroupBy?: unknown[];
  _ui?: { forecast?: unknown } | null;
  trigger_condition?: { warning_threshold?: unknown; frequency_type?: string } | null;
  query_condition?: {
    vrl_function?: unknown;
    multi_time_range?: unknown[];
    multi_alert?: boolean;
    promql_rule_mode?: boolean;
    promql_warning_value?: unknown;
    aggregation?: { group_by?: unknown[]; warning_value?: unknown } | null;
  } | null;
  composite_condition?: {
    warning_counts_as_firing?: boolean;
    stale_child_policy?: string;
  } | null;
}

export interface AnomalyTierForm {
  query_mode?: string;
  retrain_interval_days?: unknown;
  alert_direction?: string;
  alert_window_buckets?: unknown;
  alert_window_fire_pct?: unknown;
  alert_window_recover_pct?: unknown;
  alert_enabled?: boolean;
  template?: unknown;
  tags?: unknown[];
  priority?: unknown;
}

export interface AlertTierValues {
  form: AlertTierForm;
  anomaly: AnomalyTierForm | null;
}

const tierDef = (
  id: AlertSettingId,
  section: AlertSectionId,
  tier: AlertSettingTier,
  nameKey: I18nKey,
  extra: Omit<Partial<AlertSettingTierDef>, "id" | "section" | "tier" | "nameKey"> = {},
): AlertSettingTierDef => ({ id, section, tier, nameKey, ...extra });

// Homes from inventory.json `proposed`; more/smart settings listed in More options order.
export const ALERT_SETTING_TIERS: readonly AlertSettingTierDef[] = [
  tierDef("holdFor", "condition", "smart", "alerts.tiers.names.holdFor"),
  tierDef("generatedSql", "condition", "more", "alerts.tiers.names.generatedSql"),
  tierDef("groupBy", "condition", "more", "alerts.tiers.names.groupBy"),
  tierDef("compareWithPast", "condition", "more", "alerts.tiers.names.compareWithPast"),
  tierDef("vrl", "condition", "more", "alerts.tiers.names.vrl"),
  tierDef("ruleExpression", "condition", "smart", "alerts.tiers.names.ruleExpression"),
  tierDef("anomalyDirection", "condition", "smart", "alerts.tiers.names.anomalyDirection"),
  tierDef("anomalyWindow", "condition", "more", "alerts.tiers.names.anomalyWindow"),
  tierDef("anomalySqlPreview", "condition", "more", "alerts.tiers.names.anomalySqlPreview"),
  tierDef(
    "compositeWarningCounts",
    "condition",
    "more",
    "alerts.tiers.names.compositeWarningCounts",
  ),
  tierDef("compositeStalePolicy", "condition", "more", "alerts.tiers.names.compositeStalePolicy"),
  tierDef("warning", "condition", "add", "alerts.tiers.add.warning", { inline: true }),
  tierDef("forecast", "condition", "add", "alerts.tiers.add.forecast", { inline: true }),
  tierDef("anomalySql", "condition", "add", "alerts.tiers.add.anomalySql", { inline: true }),
  tierDef("anomalyRetrain", "condition", "add", "alerts.tiers.add.anomalyRetrain", {
    inline: true,
  }),
  tierDef("compositeExpression", "condition", "add", "alerts.tiers.add.compositeExpression", {
    inline: true,
  }),
  tierDef("recovery", "notify", "smart", "alerts.tiers.names.recovery"),
  tierDef("keepFiring", "notify", "smart", "alerts.tiers.names.keepFiring"),
  tierDef("suppressRepeats", "notify", "more", "alerts.tiers.names.suppressRepeats"),
  tierDef("oncall", "notify", "smart", "alerts.tiers.names.oncall"),
  tierDef("anomalyRecordOnly", "notify", "more", "alerts.tiers.names.anomalyRecordOnly"),
  tierDef("createsIncident", "notify", "add", "alerts.tiers.add.createsIncident"),
  tierDef("template", "notify", "add", "alerts.tiers.add.template", { row: "message" }),
  tierDef("rowTemplate", "notify", "add", "alerts.tiers.add.rowTemplate", { row: "message" }),
  tierDef("variables", "notify", "add", "alerts.tiers.add.variables", { row: "message" }),
  tierDef("anomalyTemplate", "notify", "add", "alerts.tiers.add.anomalyTemplate", {
    row: "message",
  }),
  tierDef("cron", "schedule", "add", "alerts.tiers.add.cron", { inline: true }),
  tierDef("tags", "details", "more", "alerts.tiers.names.tags"),
  tierDef("priority", "details", "smart", "alerts.tiers.names.priority"),
  tierDef("anomalyTags", "details", "more", "alerts.tiers.names.anomalyTags"),
  tierDef("anomalyPriority", "details", "more", "alerts.tiers.names.anomalyPriority"),
  tierDef("description", "details", "add", "alerts.tiers.add.description"),
];

// Composite is the one kind whose More options line puts Must last after its own settings.
const COMPOSITE_MORE_ORDER: readonly AlertSettingId[] = [
  "compositeWarningCounts",
  "compositeStalePolicy",
  "holdFor",
];
// A setting with no row while another one is set: forecast replaces the query, custom SQL the generated one,
// record only the message.
const REPLACED_BY: Partial<Record<AlertSettingId, AlertSettingId>> = {
  ruleExpression: "forecast",
  anomalySqlPreview: "anomalySql",
  anomalyTemplate: "anomalyRecordOnly",
};
// Matches `defaultAnomalyConfig().retrain_interval_days`; imported by value it would pull in the whole form.
const ANOMALY_DEFAULT_RETRAIN_DAYS = 7;

export interface AlertTierState {
  /** The setting applies to this alert type and build at all. */
  available: (id: AlertSettingId) => boolean;
  /** The setting holds a non-default value, so it always shows. */
  isSet: (id: AlertSettingId) => boolean;
  revealed: ReadonlySet<AlertSettingId>;
  showAll: boolean;
  expanded: (section: AlertSectionId) => boolean;
}

export interface AlertSectionTierView {
  addLinks: AlertSettingTierDef[];
  /** Every available, unset, unrevealed rare setting: the More options line names them all. */
  more: AlertSettingTierDef[];
  expanded: boolean;
}

const defOf = (id: AlertSettingId) => ALERT_SETTING_TIERS.find((d) => d.id === id);
const has = (v: unknown) => v !== undefined && v !== null && v !== "";
const filled = (list: unknown[] | undefined) => (list ?? []).some(has);

export function alertTierContext(input: {
  isRealTime: string;
  queryType?: string;
  aggregate: boolean;
  incidentsEnabled: boolean;
  oncallEnabled: boolean;
  suppressRepeatsEnabled: boolean;
  generatedSql?: boolean;
}): AlertTierContext {
  const { isRealTime, queryType, ...flags } = input;
  const kind: AlertKind =
    isRealTime === "true"
      ? "realtime"
      : isRealTime === "anomaly" || isRealTime === "composite"
        ? isRealTime
        : "scheduled";
  let shape: AlertQueryShape = "filters";
  if (kind === "anomaly" || kind === "composite") shape = kind;
  else if (kind === "scheduled" && (queryType === "sql" || queryType === "promql"))
    shape = queryType;
  return { kind, shape, ...flags };
}

export function tierAvailable(id: AlertSettingId, ctx: AlertTierContext): boolean {
  const scheduled = ctx.kind === "scheduled";
  switch (id) {
    case "generatedSql":
    case "groupBy":
      return scheduled && ctx.shape === "filters" && ctx.generatedSql !== false;
    case "vrl":
    case "compareWithPast":
      return scheduled && ctx.shape === "sql";
    case "ruleExpression":
    case "forecast":
      return scheduled && ctx.shape === "promql";
    case "warning":
    case "recovery":
    case "keepFiring":
    case "cron":
      return scheduled;
    case "suppressRepeats":
      return scheduled && ctx.suppressRepeatsEnabled;
    case "holdFor":
      return scheduled || ctx.kind === "composite";
    case "createsIncident":
      return ctx.kind !== "anomaly" && ctx.incidentsEnabled;
    case "oncall":
      return ctx.kind !== "anomaly" && ctx.oncallEnabled;
    case "anomalySql":
    case "anomalyRetrain":
    case "anomalyDirection":
    case "anomalyWindow":
    case "anomalySqlPreview":
    case "anomalyTemplate":
    case "anomalyRecordOnly":
    case "anomalyTags":
    case "anomalyPriority":
      return ctx.kind === "anomaly";
    case "compositeExpression":
    case "compositeWarningCounts":
    case "compositeStalePolicy":
      return ctx.kind === "composite";
    default:
      return ctx.kind !== "anomaly";
  }
}

/** Availability for this alert as filled in: the one rule both the line and the rows read. */
export function tierApplies(
  id: AlertSettingId,
  ctx: AlertTierContext,
  values: AlertTierValues,
): boolean {
  const replacedBy = REPLACED_BY[id];
  return tierAvailable(id, ctx) && !(replacedBy && tierIsSet(replacedBy, values));
}

function anomalyIsSet(id: AlertSettingId, a: AnomalyTierForm): boolean {
  switch (id) {
    case "anomalySql":
      return a.query_mode === "custom_sql";
    case "anomalyRetrain":
      return (
        has(a.retrain_interval_days) &&
        Number(a.retrain_interval_days) !== ANOMALY_DEFAULT_RETRAIN_DAYS
      );
    case "anomalyDirection":
      return has(a.alert_direction) && a.alert_direction !== "both";
    case "anomalyWindow":
      return (
        (has(a.alert_window_buckets) && Number(a.alert_window_buckets) !== 1) ||
        (has(a.alert_window_fire_pct) && Number(a.alert_window_fire_pct) !== 100) ||
        has(a.alert_window_recover_pct)
      );
    case "anomalyTemplate":
      return has(a.template);
    case "anomalyRecordOnly":
      return a.alert_enabled === false;
    case "anomalyTags":
      return filled(a.tags);
    case "anomalyPriority":
      return has(a.priority);
    default:
      return false;
  }
}

export function tierIsSet(id: AlertSettingId, v: AlertTierValues): boolean {
  if (id.startsWith("anomaly")) return v.anomaly ? anomalyIsSet(id, v.anomaly) : false;
  const fd = v.form;
  const qc = fd.query_condition ?? {};
  switch (id) {
    case "vrl":
      return has(qc.vrl_function);
    case "warning":
      return (
        has(fd.trigger_condition?.warning_threshold) ||
        has(qc.aggregation?.warning_value) ||
        has(qc.promql_warning_value)
      );
    case "groupBy":
      return filled(fd.logGroupBy) || filled(qc.aggregation?.group_by) || qc.multi_alert === true;
    case "ruleExpression":
      return qc.promql_rule_mode === true;
    case "forecast":
      return has(fd._ui?.forecast);
    case "compareWithPast":
      return (qc.multi_time_range ?? []).length > 0;
    case "holdFor":
      return Number(fd.pending_period_sec) > 0;
    case "compositeWarningCounts":
      return fd.composite_condition?.warning_counts_as_firing === false;
    case "compositeStalePolicy":
      return has(fd.composite_condition?.stale_child_policy)
        ? fd.composite_condition?.stale_child_policy !== "use_last_state"
        : false;
    case "createsIncident":
      return fd.creates_incident === true;
    case "template":
      return has(fd.template);
    case "rowTemplate":
      return has(fd.row_template);
    case "variables":
      return (fd.context_attributes ?? []).length > 0;
    case "recovery":
      return fd.notify_on_recovery === true || (fd.recovery_destinations ?? []).length > 0;
    case "keepFiring":
      return Number(fd.keep_firing_for) > 0;
    case "suppressRepeats":
      return fd.suppress_repeats === true;
    case "oncall":
      return has(fd.oncall_team);
    case "cron":
      return fd.trigger_condition?.frequency_type === "cron";
    case "description":
      return has(fd.description);
    case "tags":
      return filled(fd.tags);
    case "priority":
      return has(fd.priority);
    default:
      return false;
  }
}

/** Whether a tiered control renders; unknown ids always render. */
export function isTierVisible(id: AlertSettingId, state: AlertTierState): boolean {
  const def = defOf(id);
  if (!def || state.isSet(id) || state.revealed.has(id)) return true;
  if (!state.available(id)) return false;
  if (state.showAll) return true;
  return def.tier !== "add" && state.expanded(def.section);
}

export function sectionTierView(
  section: AlertSectionId,
  state: AlertTierState,
): AlertSectionTierView {
  const expanded = state.showAll || state.expanded(section);
  if (state.showAll) return { addLinks: [], more: [], expanded };
  const own = ALERT_SETTING_TIERS.filter(
    (d) =>
      d.section === section &&
      state.available(d.id) &&
      !state.isSet(d.id) &&
      !state.revealed.has(d.id),
  );
  const more = inMoreOrder(
    own.filter((d) => d.tier !== "add"),
    state,
  );
  return { addLinks: own.filter((d) => d.tier === "add"), more, expanded };
}

/** Where rows the user brings in render, below the section's line: More options order, then the "+ add" rows. */
export function sectionPlacementOrder(
  section: AlertSectionId,
  state: Pick<AlertTierState, "available">,
): AlertSettingId[] {
  const own = ALERT_SETTING_TIERS.filter(
    (d) => d.section === section && !d.inline && state.available(d.id),
  );
  return [
    ...inMoreOrder(
      own.filter((d) => d.tier !== "add"),
      state,
    ),
    ...own.filter((d) => d.tier === "add"),
  ].map((d) => d.id);
}

function inMoreOrder(
  defs: AlertSettingTierDef[],
  state: Pick<AlertTierState, "available">,
): AlertSettingTierDef[] {
  if (!state.available("compositeExpression")) return defs;
  const rank = (d: AlertSettingTierDef) => COMPOSITE_MORE_ORDER.indexOf(d.id);
  return [...defs].sort((a, b) => rank(a) - rank(b));
}
