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

import { computed, type ComputedRef, type Ref } from "vue";
import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import type {
  SectionNavItem,
  SectionNavState,
} from "@/lib/navigation/SectionNav/OSectionNav.types";
import {
  ALERT_SECTIONS,
  sectionOfField,
  type AlertSectionDef,
  type AlertSectionId,
} from "@/components/alerts/alertFormSections";
import { operatorsToWords } from "@/components/alerts/composite/expression";
import { alertConditionText } from "@/utils/alerts/alertCondition";
import { hasDeliveryTarget } from "@/utils/alerts/deliveryTarget";
import {
  compactDuration,
  dataNoun,
  durationText,
  durationWords,
  everyWords,
  forecastWindowWords as windowWords,
  formatNumber,
  joinList,
  joinListMore,
  measureWords as measurePhrase,
} from "@/utils/alerts/alertCopy";
import { isForecastHorizonValid } from "@/utils/alerts/forecastAlert";
import { compareFactor, compareRule } from "@/utils/alerts/alertIntents";
import { promqlMetricNames, promqlScaledToPercent } from "@/utils/alerts/promqlMetrics";
import { sqlWhereText } from "@/utils/alerts/alertSqlUtils";
import {
  CONDITION_GAP_KEYS,
  conditionGap,
  eventCountText,
  filterPhrase,
  limitText,
  measureValueText,
  operatorSymbol,
  type ConditionGap,
  type ReadBackAlert,
} from "@/utils/alerts/alertReadBack";
import { describeDestinations } from "@/utils/alerts/destinationDescription";
import {
  anomalyIntervalSeconds,
  anomalyTrainingFact,
} from "@/components/anomaly_detection/steps/AnomalyDetectionConfig.schema";
import {
  promqlByLabels,
  promqlTrailingComparison,
  sqlGroupByLabels,
} from "@/utils/alerts/queryGroupLabels";

/** The org's destination objects, as the picker lists them. */
export type AlertDestinationObjects = Parameters<typeof describeDestinations>[0];

export type FieldMetaMap = Record<string, { errors?: readonly unknown[] } | undefined>;

/** The slice of the alert form the section list reads. */
export interface AlertSectionsFormData extends Omit<
  ReadBackAlert,
  "is_real_time" | "query_condition"
> {
  query_condition?: ReadBackAlert["query_condition"] & {
    promql_rule_mode?: boolean;
    promql_multi_alert?: boolean;
  };
  is_real_time?: string | boolean;
  stream_type?: string;
  name?: string;
  creates_incident?: boolean;
  children?: { alert_id?: string }[];
  composite_condition?: { expression?: string } | null;
  _ui?: {
    forecast?: { T?: number | string | null; W?: string; direction?: string } | null;
  } | null;
}

/** The slice of the anomaly config the section list reads. */
export interface AlertSectionsAnomalyConfig {
  query_mode?: string;
  custom_sql?: string;
  detection_function?: string;
  detection_function_field?: string;
  alert_enabled?: boolean;
  alert_destination_ids?: string[];
  filters?: unknown;
  schedule_interval_value?: number | string;
  schedule_interval_unit?: string;
  histogram_interval_value?: number | string;
  histogram_interval_unit?: string;
  detection_window_value?: number | string;
  detection_window_unit?: string;
  alert_direction?: string | null;
  training_window_days?: number | string;
}

/** The bits of the alert form the section list reads; `formData` is the form's read-view. */
export interface AlertFormSectionsInput {
  /** The form's per-field meta (`form.useStore((s) => s.fieldMeta)`). */
  fieldMeta: Readonly<Ref<FieldMetaMap | undefined>>;
  formData: Ref<AlertSectionsFormData>;
  /** The org's destinations, so a picked one can be named with its kind. */
  destinationObjects?: Readonly<Ref<AlertDestinationObjects | undefined>>;
  anomalyConfig: Ref<AlertSectionsAnomalyConfig>;
  /** Whole days of data the anomaly's stream holds; undefined while unknown. */
  anomalyStreamDays?: Readonly<Ref<number | undefined>>;
  isAnomalyMode: Ref<boolean>;
  /** Builder/SQL threshold on an aggregate rather than on the event count. */
  isAggregationEnabled: Ref<boolean>;
  isEditing: Ref<boolean>;
  /** Incidents exist in this build and org, so `creates_incident` reaches someone. */
  incidentsEnabled?: Ref<boolean>;
  /** Sections holding unsaved edits; edit mode only. */
  changedSections?: Ref<ReadonlySet<AlertSectionId>>;
  /** Sections the user has moved past; until then a section reports no progress or problem. */
  visited?: Ref<ReadonlySet<AlertSectionId>>;
  /** Problems a save found outside the form's field meta, counted per section. */
  extraErrors?: Readonly<Ref<Partial<Record<AlertSectionId, number>>>>;
  /** Sections that cannot save as they stand, even with no field error shown yet. */
  invalid?: ComputedRef<Partial<Record<AlertSectionId, boolean>>>;
  /** The server rejected the query (SQL check or preview run), so no rule can be read from it. */
  queryFailed?: Readonly<Ref<boolean>>;
  t: TranslateFn;
}

/** One read-back sentence; a strong part is a value the user chose. */
export interface AlertReviewLine {
  id: Exclude<AlertSectionId, "details">;
  keypath: I18nKey;
  parts: Record<string, { text: I18nText; strong?: boolean }>;
  plural?: number;
  /** Further sentences about the same section, read after the first. */
  more?: Omit<AlertReviewLine, "id" | "more">[];
}

type ConditionKind =
  | "events"
  | "rows"
  | "value"
  | "promqlAny"
  | "promqlEach"
  | "forecast"
  | "forecastUnset"
  | "realtime"
  | "anomaly"
  | "composite"
  | "unset"
  | ConditionGap;
type ReviewSentence = Omit<AlertReviewLine, "id">;

const FIRES_KEYS: Record<ConditionKind, I18nKey> = {
  events: "alerts.sections.review.firesCount",
  rows: "alerts.sections.review.firesRows",
  value: "alerts.sections.review.firesValue",
  promqlAny: "alerts.sections.review.firesPromqlAny",
  promqlEach: "alerts.sections.review.firesPromqlEach",
  forecast: "alerts.sections.review.firesForecast",
  forecastUnset: "alerts.forecast.needsThreshold",
  realtime: "alerts.sections.review.firesRealtime",
  anomaly: "alerts.sections.review.firesAnomaly",
  composite: "alerts.sections.review.firesComposite",
  unset: "alerts.sections.review.firesCompositeUnset",
  ...CONDITION_GAP_KEYS,
};

const WATCH_KEYS: Record<string, I18nKey> = {
  true: "alerts.sections.review.watchRealtime",
  anomaly: "alerts.sections.review.watchAnomaly",
};

const WATCH_WHERE_KEYS: Record<string, I18nKey> = {
  true: "alerts.sections.review.watchRealtimeWhere",
  anomaly: "alerts.sections.review.watchAnomalyWhere",
};

const OFFSET_KEYS: Record<string, I18nKey> = {
  s: "alerts.form.duration.seconds",
  m: "alerts.sections.review.minutes",
  h: "alerts.sections.review.hours",
  d: "alerts.form.duration.days",
  w: "alerts.sections.review.weeks",
  M: "alerts.sections.review.months",
};

const NAV_SEPARATOR = " · ";
// A WHERE clause longer than this is cut in the read-back; the query itself is one step up.
const WHERE_CLIP = 80;

const STREAM_TYPE_LABELS: Record<string, I18nKey> = {
  logs: "alerts.sections.dataTypes.logs.label",
  metrics: "alerts.sections.dataTypes.metrics.label",
  traces: "alerts.sections.dataTypes.traces.label",
};

const OPERATOR_WORDS: Record<string, I18nKey> = {
  ">=": "alerts.sections.operators.gte",
  ">": "alerts.sections.operators.gt",
  "<=": "alerts.sections.operators.lte",
  "<": "alerts.sections.operators.lt",
  "=": "alerts.sections.operators.eq",
  "==": "alerts.sections.operators.eq",
  "!=": "alerts.sections.operators.ne",
};

const DIRECTION_WORDS: Record<string, I18nKey> = {
  both: "alerts.sections.review.anomalyBoth",
  above: "alerts.sections.review.anomalyAbove",
  below: "alerts.sections.review.anomalyBelow",
};

const hasValue = (v: unknown): boolean => v !== null && v !== undefined && String(v).trim() !== "";

/** "1 week", "15 minutes": a compare-with-past offset code ("1w", "15m") in words. */
const offsetWords = (code: string | undefined, t: TranslateFn): I18nText => {
  const match = /^(\d+)([smhdwM])$/.exec(String(code ?? ""));
  if (!match) return raw(code ?? "");
  const count = Number(match[1]);
  return t(OFFSET_KEYS[match[2]], { count }, count);
};

/** "at least 1", "not exactly 5": a comparison in the words the operator menu uses. */
const comparisonWords = (
  operator: string | undefined,
  value: unknown,
  t: TranslateFn,
  shown: I18nText = formatNumber(value),
): I18nText =>
  t("alerts.sections.review.comparison", {
    op: t(OPERATOR_WORDS[operator ?? ">="] ?? "alerts.sections.operators.gte"),
    value: shown,
  });

const minutesOf = (value: unknown, unit: string | undefined): number =>
  Number(value ?? 0) * (unit === "h" ? 60 : unit === "d" ? 1440 : 1);

/** Label for the scheduled "How it checks" choice, from the stored frequency (always minutes). */
export function checkEveryLabel(formData: AlertSectionsFormData, t: TranslateFn): I18nText {
  const tc = formData?.trigger_condition ?? {};
  if (tc.frequency_type === "cron") return t("alerts.sections.onCron");
  const minutes = Number(tc.frequency ?? 10);
  if (minutes >= 60 && minutes % 60 === 0) {
    return t("alerts.sections.everyHours", { count: minutes / 60 }, minutes / 60);
  }
  return t("alerts.sections.everyMinutes", { count: minutes }, minutes);
}

/** A read-back line as plain text, the way its slots render it. */
export function reviewLineText(line: AlertReviewLine, t: TranslateFn): I18nText {
  const sentence = (one: Omit<AlertReviewLine, "id" | "more">) =>
    t(
      one.keypath,
      Object.fromEntries(Object.entries(one.parts).map(([k, p]) => [k, p.text])),
      one.plural ?? 1,
    );
  return raw([line, ...(line.more ?? [])].map(sentence).join(" "));
}

// "3+" for the default at-least limit, otherwise "> 3", "≤ 3"...
const countLimit = (operator: string | undefined, threshold: unknown): string =>
  !operator || operator === ">=" ? `${threshold}+` : `${operatorSymbol(operator)} ${threshold}`;

/** Status, a one-line phrase and the title of each section, for the section list. */
// The stored expression names child alerts by id; the editor labels them A, B, … in list order.
const lettersForAlertIds = (expression: string, childIds: string[]): string => {
  const letters = new Map(
    childIds.map((id, index) => [`{${id}}`, String.fromCharCode(65 + index)]),
  );
  const lettered = expression.replace(/\{[^}]+\}/g, (token) => {
    if (!letters.has(token)) letters.set(token, String.fromCharCode(65 + letters.size));
    return letters.get(token)!;
  });
  return operatorsToWords(lettered);
};

export function useAlertFormSections(input: AlertFormSectionsInput): {
  /** The steps this alert type has; real-time and composite alerts have no schedule to set. */
  sections: ComputedRef<readonly AlertSectionDef[]>;
  items: ComputedRef<SectionNavItem[]>;
  errorCounts: ComputedRef<Record<AlertSectionId, number>>;
  review: ComputedRef<AlertReviewLine[]>;
} {
  const { t } = input;
  const { fieldMeta } = input;

  const mode = computed(() => String(input.formData.value?.is_real_time ?? "false"));
  const sections = computed(() =>
    mode.value === "true" || mode.value === "composite"
      ? ALERT_SECTIONS.filter((section) => section.id !== "schedule")
      : ALERT_SECTIONS,
  );

  const errorCounts = computed(() => {
    const counts: Record<AlertSectionId, number> = {
      watch: 0,
      condition: 0,
      notify: 0,
      schedule: 0,
      details: 0,
    };
    for (const [name, meta] of Object.entries(fieldMeta.value ?? {})) {
      if (meta?.errors?.some((e) => e !== null && e !== undefined && e !== "")) {
        counts[sectionOfField(name)] += 1;
      }
    }
    for (const [id, extra] of Object.entries(input.extraErrors?.value ?? {})) {
      counts[id as AlertSectionId] += extra ?? 0;
    }
    return counts;
  });

  const forecastOf = (fd: AlertSectionsFormData) => fd._ui?.forecast ?? null;
  const forecastReady = (fd: AlertSectionsFormData): boolean => {
    const forecast = forecastOf(fd);
    return (
      !!forecast &&
      hasValue(forecast.T) &&
      Number.isFinite(Number(forecast.T)) &&
      isForecastHorizonValid(Number(fd.query_condition?.promql_condition?.value))
    );
  };
  const forecastHorizon = (fd: AlertSectionsFormData): I18nText => {
    const days = Number(fd.query_condition?.promql_condition?.value);
    return t("alerts.forecast.dayCount", { n: days }, days);
  };

  // The payload keeps a SQL measure only for one alert per row, and a builder one only while it is on.
  const sqlRowValue = (fd: AlertSectionsFormData): boolean => {
    const qc = fd.query_condition ?? {};
    return (
      qc.type === "sql" && !!qc.aggregation?.multi_alert && hasValue(qc.aggregation?.having?.column)
    );
  };
  const builderMeasure = (fd: AlertSectionsFormData): boolean => {
    const qc = fd.query_condition ?? {};
    return (
      (qc.type ?? "custom") === "custom" && input.isAggregationEnabled.value && !!qc.aggregation
    );
  };
  // "count" with no column is the builder's count of every matching event.
  const countsAllEvents = (fd: AlertSectionsFormData): boolean => {
    const agg = fd.query_condition?.aggregation;
    const column = agg?.having?.column;
    // Every row of a group carries the group's own field, so counting it counts the group's events.
    return (
      agg?.function === "count" && (!hasValue(column) || groupLabels(fd).includes(column ?? ""))
    );
  };
  const ruleComparison = (fd: AlertSectionsFormData) => {
    const qc = fd.query_condition ?? {};
    return qc.type === "promql" && qc.promql_rule_mode
      ? promqlTrailingComparison(qc.promql ?? "")
      : null;
  };
  const groupLabels = (fd: AlertSectionsFormData): string[] => {
    const qc = fd.query_condition ?? {};
    if (qc.type === "promql") return promqlByLabels(qc.promql ?? "");
    if (qc.type === "sql") return sqlGroupByLabels(qc.sql ?? "");
    if (!builderMeasure(fd)) return [];
    const logFields = fd.stream_type !== "metrics" ? fd.logGroupBy : undefined;
    const fields = logFields?.length ? logFields : qc.aggregation?.group_by;
    return (fields ?? []).filter((field) => field?.trim());
  };
  const perGroup = (fd: AlertSectionsFormData): boolean => {
    const qc = fd.query_condition ?? {};
    if (qc.type === "promql") return !!qc.promql_multi_alert && !forecastOf(fd);
    if (qc.type === "sql") return sqlRowValue(fd);
    return builderMeasure(fd) && !!qc.aggregation?.multi_alert && groupLabels(fd).length > 0;
  };
  const filterOf = (fd: AlertSectionsFormData) => {
    if (mode.value === "anomaly") {
      const anomaly = input.anomalyConfig.value ?? {};
      return anomaly.query_mode === "custom_sql"
        ? null
        : filterPhrase(anomaly.filters, "anomaly", t);
    }
    const qc = fd.query_condition ?? {};
    const builder =
      mode.value === "true" || (mode.value === "false" && (qc.type ?? "custom") === "custom");
    return builder ? filterPhrase(qc.conditions, "alert", t) : null;
  };
  const sqlFilterOf = (fd: AlertSectionsFormData) => {
    const qc = fd.query_condition ?? {};
    const where = mode.value === "false" && qc.type === "sql" ? sqlWhereText(qc.sql ?? "") : null;
    if (!where) return null;
    const flat = where.replace(/\s+/g, " ");
    return { text: raw(flat.length > WHERE_CLIP ? `${flat.slice(0, WHERE_CLIP)}…` : flat) };
  };
  // A query scaled by 100 reads in percent, so its limits do too.
  const promqlValueText = (fd: AlertSectionsFormData, value: unknown): I18nText =>
    promqlScaledToPercent(fd.query_condition?.promql ?? "")
      ? t("alerts.units.short.percent", { value: formatNumber(value) })
      : formatNumber(value);
  const warningLimit = (
    fd: AlertSectionsFormData,
  ): { operator?: string; value: unknown; shown?: I18nText } | null => {
    const qc = fd.query_condition ?? {};
    if (qc.type === "promql") {
      if (forecastOf(fd) || qc.promql_rule_mode || !hasValue(qc.promql_warning_value)) return null;
      return {
        operator: qc.promql_condition?.operator,
        value: qc.promql_warning_value,
        shown: promqlValueText(fd, qc.promql_warning_value),
      };
    }
    if (sqlRowValue(fd) || builderMeasure(fd)) {
      const agg = qc.aggregation;
      return hasValue(agg?.warning_value)
        ? {
            operator: agg?.having?.operator,
            value: agg?.warning_value,
            shown: measureValueText(fd, agg?.warning_value, t),
          }
        : null;
    }
    const tc = fd.trigger_condition ?? {};
    return hasValue(tc.warning_threshold)
      ? { operator: tc.operator, value: tc.warning_threshold }
      : null;
  };
  const compareOffsets = (fd: AlertSectionsFormData): I18nText[] => {
    const qc = fd.query_condition ?? {};
    if (qc.type !== "sql") return [];
    return (qc.multi_time_range ?? []).map((range) => offsetWords(range?.offSet, t));
  };
  const hasFunction = (fd: AlertSectionsFormData): boolean =>
    hasValue(fd.query_condition?.vrl_function);
  // A comparison the intent wrote reads as its factor, not as rows through a function.
  const pastComparison = (fd: AlertSectionsFormData) => {
    const offsets = compareOffsets(fd);
    const factor = compareFactor(fd.query_condition?.vrl_function);
    const tc = fd.trigger_condition ?? {};
    const onAnyRow = (tc.operator ?? ">=") === ">=" && Number(tc.threshold ?? 1) === 1;
    return offsets.length && factor && onAnyRow
      ? { factor: formatNumber(factor), offsets: joinList(offsets) }
      : null;
  };

  // PromQL's one-alert answer counts the series past the value limit.
  const promqlPhrase = (fd: AlertSectionsFormData): I18nText => {
    const qc = fd.query_condition ?? {};
    if (forecastOf(fd)) {
      return forecastReady(fd)
        ? t("alerts.forecast.navSummary", {
            threshold: formatNumber(forecastOf(fd)?.T),
            horizon: forecastHorizon(fd),
          })
        : t("alerts.forecast.needsThreshold");
    }
    if (qc.promql_rule_mode) return raw(alertConditionText(fd));
    if (qc.promql_multi_alert) {
      const pc = qc.promql_condition;
      return hasValue(pc?.value)
        ? raw(`${operatorSymbol(pc?.operator)} ${promqlValueText(fd, pc?.value)}`)
        : raw(alertConditionText(fd));
    }
    const tc = fd.trigger_condition ?? {};
    const count = countLimit(tc.operator, tc.threshold ?? 1);
    const pc = qc.promql_condition;
    if (!pc || !hasValue(pc.value)) return t("alerts.sections.condition.series", { count });
    const limit = `${operatorSymbol(pc.operator)} ${promqlValueText(fd, pc.value)}`.trim();
    return t("alerts.sections.condition.seriesOver", { count, limit });
  };

  const conditionPhrase = (fd: AlertSectionsFormData): { kind: ConditionKind; text: I18nText } => {
    if (mode.value === "true") {
      return { kind: "realtime", text: t("alerts.sections.condition.realtime") };
    }
    if (mode.value === "anomaly") {
      return { kind: "anomaly", text: t("alerts.sections.condition.anomaly") };
    }
    if (mode.value === "composite") {
      const expression = fd.composite_condition?.expression;
      return typeof expression === "string" && hasValue(expression)
        ? {
            kind: "composite",
            text: raw(
              lettersForAlertIds(
                expression,
                (fd.children ?? []).map((child) => child.alert_id ?? ""),
              ),
            ),
          }
        : { kind: "unset", text: t("alerts.sections.condition.composite") };
    }
    const gap = conditionGap(fd, {
      queryFailed: input.queryFailed?.value === true,
      aggregationEnabled: input.isAggregationEnabled.value,
    });
    if (gap) return { kind: gap, text: t(CONDITION_GAP_KEYS[gap]) };
    const qc = fd.query_condition ?? {};
    if (qc.type === "promql") {
      const rule = ruleComparison(fd);
      const text = rule
        ? raw(`${operatorSymbol(rule.operator)} ${formatNumber(rule.value)}`)
        : promqlPhrase(fd);
      return { kind: "value", text };
    }
    const having = qc.aggregation?.having ?? {};
    // Value thresholds start empty, so the line names the measure alone until one is typed.
    const measureNav = (measure: I18nText) =>
      hasValue(having.value)
        ? t("alerts.sections.condition.measureNav", {
            measure,
            op: operatorSymbol(having.operator),
            value: measureValueText(fd, having.value, t),
          })
        : measure;
    if (qc.type === "sql") {
      if (sqlRowValue(fd)) return { kind: "value", text: measureNav(raw(having.column)) };
      const tc = fd.trigger_condition ?? {};
      const count = countLimit(tc.operator, tc.threshold ?? "");
      return { kind: "rows", text: t("alerts.sections.condition.rows", { count }) };
    }
    if (builderMeasure(fd)) {
      const text = countsAllEvents(fd)
        ? eventCountText({ operator: having.operator, threshold: having.value }, t, fd.stream_type)
        : measureNav(measureWords(fd));
      return { kind: "value", text };
    }
    return { kind: "events", text: eventCountText(fd.trigger_condition, t, fd.stream_type) };
  };

  // The list's short line: the rule, then each setting that changes it, by the name its row shows.
  const conditionFacts = (fd: AlertSectionsFormData): I18nText[] => {
    const facts: I18nText[] = [];
    const fact = (name: I18nText, value: I18nText) =>
      t("alerts.sections.condition.navFact", { name, value });
    const labels = mode.value === "false" ? groupLabels(fd) : [];
    if (labels.length && perGroup(fd)) {
      facts.push(t("alerts.form.group.eachOfPlain", { labels: joinListMore(labels, t) }));
    } else if (labels.length && builderMeasure(fd)) {
      facts.push(fact(t("alerts.tiers.names.groupBy"), joinListMore(labels, t)));
    }
    const filter = filterOf(fd);
    if (filter) facts.push(t("alerts.plain.whereFilters", { count: filter.count }, filter.count));
    if (mode.value !== "false") return facts;
    const hold = Number(fd.pending_period_sec ?? 0);
    if (hold > 0) facts.push(fact(t("alerts.tiers.names.holdFor"), compactDuration(hold * 60, t)));
    const keep = Number(fd.keep_firing_for ?? 0);
    if (keep > 0) facts.push(fact(t("alerts.tiers.names.keepFiring"), compactDuration(keep, t)));
    const warning = warningLimit(fd);
    if (warning) {
      facts.push(
        fact(
          t("alerts.form.warning.label"),
          raw(limitText(warning.operator, warning.value, warning.shown)),
        ),
      );
    }
    if (pastComparison(fd)) return facts;
    const offsets = compareOffsets(fd);
    if (offsets.length)
      facts.push(fact(t("alerts.tiers.names.compareWithPast"), joinList(offsets)));
    if (hasFunction(fd)) facts.push(t("alerts.tiers.names.vrl"));
    return facts;
  };

  const measureWords = (fd: AlertSectionsFormData): I18nText =>
    measurePhrase(fd.query_condition?.aggregation, groupLabels(fd), fd.stream_type, t);

  // Until the detection is fully described there is nothing for the step to be done with.
  const anomalyConditionMissing = (): boolean => {
    const anomaly = input.anomalyConfig.value ?? {};
    if (anomaly.query_mode === "custom_sql") return !hasValue(anomaly.custom_sql);
    if (!hasValue(anomaly.detection_function)) return true;
    return anomaly.detection_function !== "count" && !hasValue(anomaly.detection_function_field);
  };

  const notifyCount = (fd: AlertSectionsFormData): number => {
    if (mode.value === "anomaly") {
      const anomaly = input.anomalyConfig.value ?? {};
      return anomaly.alert_enabled ? (anomaly.alert_destination_ids?.length ?? 0) : 0;
    }
    const oncall = hasDeliveryTarget({ oncall_team: fd.oncall_team }) ? 1 : 0;
    return (fd.destinations?.length ?? 0) + (fd.workflows?.length ?? 0) + oncall;
  };

  const opensIncident = (fd: AlertSectionsFormData): boolean =>
    input.incidentsEnabled?.value === true &&
    mode.value !== "anomaly" &&
    fd.creates_incident === true;

  const destinationTypes = computed(() =>
    describeDestinations(input.destinationObjects?.value ?? [], t),
  );

  // Names every target, its kind beside it when `typed`; workflows are stored by id, so they are counted.
  const targetNames = (
    fd: AlertSectionsFormData,
    opts: { typed: boolean; oncall: boolean },
  ): I18nText[] => {
    const named = (name: string, type: I18nText | null) =>
      opts.typed && type
        ? t("alerts.sections.review.destinationTyped", { name: raw(name), type })
        : raw(name);
    const typeOf = (name: string) => destinationTypes.value[name]?.type ?? null;
    if (mode.value === "anomaly") {
      const anomaly = input.anomalyConfig.value ?? {};
      const ids = anomaly.alert_enabled ? (anomaly.alert_destination_ids ?? []) : [];
      return ids.map((name) => named(name, typeOf(name)));
    }
    const names = (fd.destinations ?? []).map((name) => named(name, typeOf(name)));
    const workflows = fd.workflows?.length ?? 0;
    if (workflows) {
      names.push(t("alert_dependencies.countWorkflow", { count: workflows }, workflows));
    }
    const team = fd.oncall_team?.trim();
    if (opts.oncall && team && hasDeliveryTarget({ oncall_team: team })) {
      names.push(named(team, t("alerts.tiers.names.oncall")));
    }
    return names;
  };

  const notifySummary = (fd: AlertSectionsFormData, count: number): I18nText => {
    const incident = opensIncident(fd);
    if (!incident) {
      if (count === 0) return t("alerts.sections.notify.nobody");
      return joinListMore(targetNames(fd, { typed: false, oncall: true }), t);
    }
    const listed = targetNames(fd, { typed: false, oncall: false });
    if (listed.length > 0) {
      return t("alerts.sections.notify.targetsAndIncident", { targets: joinListMore(listed, t) });
    }
    const team = fd.oncall_team?.trim();
    return team && hasDeliveryTarget({ oncall_team: team })
      ? t("alerts.sections.notify.incidentForTeam", { team: raw(team) })
      : t("alerts.sections.notify.incident");
  };

  const schedulePhrase = (fd: AlertSectionsFormData): I18nText => {
    if (mode.value === "true" || mode.value === "composite") {
      return t("alerts.sections.schedule.realtime");
    }
    if (mode.value === "anomaly") {
      const anomaly = input.anomalyConfig.value ?? {};
      const value = Number(anomaly.schedule_interval_value ?? 1);
      return anomaly.schedule_interval_unit === "m"
        ? t("alerts.sections.everyMinutes", { count: value }, value)
        : t("alerts.sections.everyHours", { count: value }, value);
    }
    if (fd.trigger_condition?.frequency_type === "cron") {
      return t("alerts.sections.schedule.cron", { cron: fd.trigger_condition?.cron ?? "" });
    }
    return checkEveryLabel(fd, t);
  };

  const sectionFacts = (id: AlertSectionId, fd: AlertSectionsFormData) => {
    switch (id) {
      case "watch": {
        if (mode.value === "composite") {
          return { missing: false, summary: t("alerts.sections.whenCombined") };
        }
        if (!hasValue(fd.stream_name)) {
          return { missing: true, summary: t("alerts.sections.watch.pickStream") };
        }
        const stream = raw(fd.stream_name);
        if (!hasValue(fd.stream_type)) return { missing: false, summary: stream };
        const typeKey = STREAM_TYPE_LABELS[fd.stream_type!];
        const type = typeKey ? t(typeKey) : raw(fd.stream_type);
        return { missing: false, summary: t("alerts.sections.watch.navSummary", { stream, type }) };
      }
      case "condition": {
        const count = fd.children?.length ?? 0;
        if (mode.value === "composite" && count === 0) {
          return {
            missing: true,
            summary: t("alerts.sections.watch.childCount", { count }, count),
          };
        }
        // No stream means nothing to count yet, so the step cannot be done.
        const incomplete =
          mode.value !== "composite" &&
          (!hasValue(fd.stream_name) || (mode.value === "anomaly" && anomalyConditionMissing()));
        const { kind, text } = conditionPhrase(fd);
        const gap = kind in CONDITION_GAP_KEYS;
        const facts = gap || mode.value === "composite" ? [] : conditionFacts(fd);
        const past = gap ? null : pastComparison(fd);
        const head = past ? t("alerts.sections.condition.compareShort", past) : text;
        const summary = facts.length ? raw([head, ...facts].join(NAV_SEPARATOR)) : head;
        return { missing: gap && !incomplete, empty: incomplete, summary };
      }
      case "notify": {
        const count = notifyCount(fd);
        const incident = opensIncident(fd);
        return {
          missing: false,
          empty: count === 0 && !incident,
          summary: notifySummary(fd, count),
        };
      }
      case "schedule":
        return { missing: false, summary: schedulePhrase(fd) };
      default:
        return {
          missing: !hasValue(fd.name),
          summary: hasValue(fd.name) ? raw(fd.name) : t("alerts.sections.details.unnamed"),
        };
    }
  };

  const items = computed<SectionNavItem[]>(() => {
    const fd = input.formData.value ?? {};
    return sections.value.map(({ id, navKey }) => {
      const facts = sectionFacts(id, fd);
      const errors = errorCounts.value[id];
      const seen = input.isEditing.value || (input.visited?.value.has(id) ?? true);
      // A section that cannot save is never ticked, even before its error shows.
      const invalid = input.invalid?.value[id] === true;
      let state: SectionNavState = "none";
      let stateLabel: I18nText | undefined;
      if (errors > 0) {
        state = "error";
        stateLabel = t("alerts.sections.needsFix", { count: errors }, errors);
      } else if (facts.missing) {
        if (seen) {
          state = "attention";
          stateLabel = facts.summary;
        }
      } else if (input.changedSections?.value.has(id)) {
        state = "changed";
        stateLabel = t("alerts.editMode.unsaved.changed");
      } else if (seen && !invalid && !("empty" in facts && facts.empty)) {
        state = input.isEditing.value ? "saved" : "done";
      }
      return { id, title: t(navKey), summary: facts.summary, state, stateLabel };
    });
  });

  const durationPart = (minutes: number): I18nText => durationWords(minutes, t);
  const strong = (text: I18nText) => ({ text, strong: true });
  const plain = (text: I18nText) => ({ text });

  const watchLine = (fd: AlertSectionsFormData): ReviewSentence => {
    if (mode.value === "composite") {
      const count = fd.children?.length ?? 0;
      return {
        keypath: "alerts.sections.review.watchCombined",
        parts: { count: strong(raw(String(count))) },
        plural: count,
      };
    }
    if (!hasValue(fd.stream_name)) {
      return { keypath: "alerts.sections.review.watchNoStream", parts: {} };
    }
    const typeKey = STREAM_TYPE_LABELS[fd.stream_type ?? ""];
    const qc = fd.query_condition ?? {};
    const metrics = qc.type === "promql" ? promqlMetricNames(qc.promql ?? "") : [];
    const parts: ReviewSentence["parts"] = {
      type: strong(typeKey ? t(typeKey) : raw(fd.stream_type)),
      stream: strong(metrics.length > 1 ? joinListMore(metrics, t) : raw(fd.stream_name)),
    };
    const filter = filterOf(fd) ?? sqlFilterOf(fd);
    if (!filter) {
      return { keypath: WATCH_KEYS[mode.value] ?? "alerts.sections.review.watchScheduled", parts };
    }
    return {
      keypath: WATCH_WHERE_KEYS[mode.value] ?? "alerts.sections.review.watchScheduledWhere",
      parts: { ...parts, filter: plain(filter.text) },
    };
  };

  // The review says in words what the nav line says in symbols.
  const reviewCondition = (fd: AlertSectionsFormData, kind: ConditionKind, text: I18nText) => {
    const tc = fd.trigger_condition ?? {};
    const qc = fd.query_condition ?? {};
    if ((kind === "events" || kind === "rows") && (!tc.operator || tc.operator === ">=")) {
      return t("alerts.sections.review.atLeastCount", {
        count: formatNumber(tc.threshold ?? 1),
        noun: dataNoun(fd.stream_type, kind === "rows" ? "sql" : "custom", 2, t),
      });
    }
    if (kind === "value" && qc.type !== "promql") {
      const having = qc.aggregation?.having ?? {};
      return t("alerts.sections.review.measureIs", {
        measure: measureWords(fd),
        comparison: comparisonWords(
          having.operator,
          having.value,
          t,
          measureValueText(fd, having.value, t),
        ),
      });
    }
    return text;
  };

  // PromQL's one alert counts a series met at any step; one per series judges only its latest value.
  const promqlKind = (fd: AlertSectionsFormData): ConditionKind | null => {
    const qc = fd.query_condition ?? {};
    if (qc.type !== "promql" || qc.promql_rule_mode) return null;
    if (forecastOf(fd)) return forecastReady(fd) ? "forecast" : "forecastUnset";
    if (!hasValue(qc.promql_condition?.value)) return null;
    if (qc.promql_multi_alert) return "promqlEach";
    const op = fd.trigger_condition?.operator;
    return !op || op === ">=" ? "promqlAny" : null;
  };

  const conditionLine = (fd: AlertSectionsFormData): ReviewSentence => {
    const main = conditionSentence(fd);
    const gap = conditionPhrase(fd).kind in CONDITION_GAP_KEYS;
    const more = gap ? [] : conditionExtras(fd);
    return more.length ? { ...main, more } : main;
  };

  // "50 or more events", "more than 50 events": a count in the words the operator menu uses.
  const countWords = (operator: string | undefined, value: unknown, streamType?: string) =>
    !operator || operator === ">="
      ? t("alerts.sections.review.atLeastCount", {
          count: formatNumber(value),
          noun: dataNoun(streamType, "custom", 2, t),
        })
      : eventCountText({ operator, threshold: value as number }, t, streamType);

  // One sentence for a rule that fires per group, series or row, or over some groups.
  const groupedSentence = (
    fd: AlertSectionsFormData,
    window: { text: I18nText },
  ): ReviewSentence | null => {
    const qc = fd.query_condition ?? {};
    const labels = groupLabels(fd);
    const groups = (list: string[]) => strong(joinListMore(list, t));
    if (qc.type === "promql") {
      const rule = ruleComparison(fd);
      const pc = rule ?? (qc.promql_rule_mode ? null : qc.promql_condition);
      if (forecastOf(fd) || !pc || !hasValue(pc.value)) return null;
      const comparison = strong(
        comparisonWords(pc.operator, pc.value, t, promqlValueText(fd, pc.value)),
      );
      if (qc.promql_multi_alert) {
        return labels.length
          ? {
              keypath: "alerts.sections.review.firesEachSeries",
              parts: { labels: groups(labels), comparison },
            }
          : { keypath: FIRES_KEYS.promqlEach, parts: { comparison } };
      }
      if (!rule) return null;
      const count = Number(fd.trigger_condition?.threshold ?? 1);
      return {
        keypath: FIRES_KEYS.promqlAny,
        parts: { count: strong(formatNumber(count)), comparison, window },
        plural: count,
      };
    }
    const having = qc.aggregation?.having ?? {};
    const comparison = strong(
      comparisonWords(having.operator, having.value, t, measureValueText(fd, having.value, t)),
    );
    if (sqlRowValue(fd)) {
      return {
        keypath: "alerts.sections.review.firesEachGroupValue",
        parts: {
          groups: groups(labels.length ? labels : [t("alerts.form.group.row")]),
          measure: strong(raw(having.column)),
          comparison,
          window,
        },
      };
    }
    if (!builderMeasure(fd)) return null;
    const counts = countsAllEvents(fd);
    const condition = strong(countWords(having.operator, having.value, fd.stream_type));
    const measure = strong(measureWords(fd));
    if (!labels.length) {
      return counts ? { keypath: FIRES_KEYS.events, parts: { condition, window } } : null;
    }
    if (qc.aggregation?.multi_alert) {
      return counts
        ? {
            keypath: "alerts.sections.review.firesEachGroupCount",
            parts: { groups: groups(labels), condition, window },
          }
        : {
            keypath: "alerts.sections.review.firesEachGroupValue",
            parts: { groups: groups(labels), measure, comparison, window },
          };
    }
    const count = Number(fd.trigger_condition?.threshold ?? 1);
    const shared = { count: strong(formatNumber(count)), groups: groups(labels), window };
    return counts
      ? {
          keypath: "alerts.sections.review.firesSomeGroupsCount",
          parts: { ...shared, condition },
          plural: count,
        }
      : {
          keypath: "alerts.sections.review.firesSomeGroupsValue",
          parts: { ...shared, measure, comparison },
          plural: count,
        };
  };

  // Must last, Keep firing for, the warning and Compare with, each as its own sentence.
  const anomalyLearns = (): ReviewSentence => {
    const anomaly = input.anomalyConfig.value ?? {};
    const fact = anomalyTrainingFact(
      Number(anomaly.training_window_days),
      input.anomalyStreamDays?.value,
      anomalyIntervalSeconds(
        Number(anomaly.histogram_interval_value ?? 5),
        String(anomaly.histogram_interval_unit ?? "m"),
      ),
    );
    if (fact.kind === "waits")
      return {
        keypath: "alerts.sections.review.anomalyLearnsWaits",
        parts: {
          measures: strong(formatNumber(fact.measures)),
          duration: plain(durationText(fact.minutes * 60, t)),
        },
      };
    if (fact.kind === "reads")
      return {
        keypath: "alerts.sections.review.anomalyLearns",
        parts: { days: strong(formatNumber(fact.days)) },
      };
    return {
      keypath:
        fact.kind === "has"
          ? "alerts.sections.review.anomalyLearnsHas"
          : "alerts.sections.review.anomalyLearnsFlat",
      parts: { count: strong(formatNumber(fact.days)) },
      plural: fact.days,
    };
  };

  const conditionExtras = (fd: AlertSectionsFormData): ReviewSentence[] => {
    if (mode.value === "anomaly") return [anomalyLearns()];
    if (mode.value !== "false" && mode.value !== "composite") return [];
    const extras: ReviewSentence[] = [];
    const hold = Number(fd.pending_period_sec ?? 0);
    if (hold > 0) {
      extras.push({
        keypath: "alerts.sections.review.holdsFor",
        parts: { duration: strong(durationPart(hold)) },
      });
    }
    if (mode.value !== "false") return extras;
    const keep = Number(fd.keep_firing_for ?? 0);
    if (keep > 0) {
      extras.push({
        keypath: "alerts.sections.review.keepsFiring",
        parts: { duration: strong(durationText(keep, t)) },
      });
    }
    const warning = warningLimit(fd);
    if (warning) {
      const atLeast = !warning.operator || warning.operator === ">=";
      extras.push({
        keypath: "alerts.sections.review.warns",
        parts: {
          comparison: strong(
            atLeast
              ? (warning.shown ?? formatNumber(warning.value))
              : comparisonWords(warning.operator, warning.value, t, warning.shown),
          ),
        },
      });
    }
    const offsets = compareOffsets(fd);
    if (pastComparison(fd)) {
      extras.push({
        keypath: compareRule(fd.query_condition?.vrl_function)?.needsBaseline
          ? "alerts.sections.review.compareNeedsBaseline"
          : "alerts.sections.review.compareAnyBaseline",
        parts: {},
      });
      return extras;
    }
    if (offsets.length) {
      extras.push({
        keypath: hasFunction(fd)
          ? "alerts.sections.review.compareFunction"
          : "alerts.sections.review.compare",
        parts: { offsets: strong(joinList(offsets)) },
      });
    } else if (hasFunction(fd)) {
      extras.push({ keypath: "alerts.sections.review.function", parts: {} });
    }
    return extras;
  };

  const conditionSentence = (fd: AlertSectionsFormData): ReviewSentence => {
    const { kind, text } = conditionPhrase(fd);
    const window = plain(durationPart(Number(fd.trigger_condition?.period ?? 0)));
    const past = kind === "rows" ? pastComparison(fd) : null;
    if (past) {
      return {
        keypath: "alerts.sections.review.firesCompare",
        parts: { window, factor: strong(past.factor), offsets: strong(past.offsets) },
      };
    }
    const grouped = kind === "value" ? groupedSentence(fd, window) : null;
    if (grouped) return grouped;
    const promql = kind === "value" ? promqlKind(fd) : null;
    if (promql) return promqlLine(fd, promql, window);
    let parts: ReviewSentence["parts"] = {};
    if (kind === "composite") parts = { expression: strong(text) };
    else if (kind === "anomaly") parts = anomalyParts();
    else if (kind === "events" || kind === "rows" || kind === "value") {
      parts = { condition: strong(reviewCondition(fd, kind, text)), window };
    }
    return { keypath: FIRES_KEYS[kind], parts };
  };

  const promqlLine = (
    fd: AlertSectionsFormData,
    kind: ConditionKind,
    window: { text: I18nText },
  ): ReviewSentence => {
    const pc = fd.query_condition?.promql_condition ?? {};
    const forecast = forecastOf(fd);
    if (kind === "forecastUnset") return { keypath: FIRES_KEYS[kind], parts: {} };
    if (kind === "forecast") {
      const trigger = t(
        forecast?.direction === "falls"
          ? "alerts.forecast.triggerFalls"
          : "alerts.forecast.triggerRises",
        { threshold: formatNumber(forecast?.T), horizon: forecastHorizon(fd) },
      );
      return {
        keypath: FIRES_KEYS.forecast,
        parts: { trigger: strong(trigger), window: plain(forecastWindowWords(fd)) },
      };
    }
    const comparison = strong(
      comparisonWords(pc.operator, pc.value, t, promqlValueText(fd, pc.value)),
    );
    if (kind === "promqlEach") return { keypath: FIRES_KEYS.promqlEach, parts: { comparison } };
    const count = Number(fd.trigger_condition?.threshold ?? 1);
    return {
      keypath: FIRES_KEYS.promqlAny,
      parts: { count: strong(formatNumber(count)), comparison, window },
      plural: count,
    };
  };

  const forecastWindowWords = (fd: AlertSectionsFormData): I18nText =>
    windowWords(forecastOf(fd)?.W, t);

  const anomalyParts = (): ReviewSentence["parts"] => {
    const anomaly = input.anomalyConfig.value ?? {};
    const fn = anomaly.detection_function ?? "count";
    const measure =
      anomaly.query_mode === "custom_sql" || fn === "count" || !anomaly.detection_function_field
        ? raw(fn)
        : t("alerts.verdict.measure", { fn, field: anomaly.detection_function_field });
    const resolution = minutesOf(
      anomaly.histogram_interval_value ?? 5,
      anomaly.histogram_interval_unit ?? "m",
    );
    return {
      measure: strong(measure),
      resolution: strong(durationPart(resolution)),
      direction: plain(
        t(DIRECTION_WORDS[anomaly.alert_direction ?? "both"] ?? DIRECTION_WORDS.both),
      ),
    };
  };

  const notifyLine = (fd: AlertSectionsFormData): ReviewSentence => {
    const count = notifyCount(fd);
    const incident = opensIncident(fd);
    if (count === 0 && !incident)
      return { keypath: "alerts.sections.review.tellsNobody", parts: {} };
    const silence = mode.value === "anomaly" ? 0 : Number(fd.trigger_condition?.silence ?? 0);
    // Real-time and anomaly alerts keep no firing state, so the payload drops both switches for them.
    const stateful = mode.value !== "true" && mode.value !== "anomaly";
    const reminder = plain(
      raw(
        [
          silence > 0
            ? t("alerts.sections.review.reminder", { duration: everyWords(silence, t) })
            : "",
          stateful && fd.suppress_repeats ? t("alerts.sections.review.suppressTail") : "",
          stateful && fd.notify_on_recovery ? t("alerts.sections.review.recoveryTail") : "",
        ].join(""),
      ),
    );
    const listed = targetNames(fd, { typed: true, oncall: !incident });
    if (incident && listed.length === 0) {
      return {
        keypath: "alerts.sections.review.incidentOnly",
        parts: { incident: plain(notifySummary(fd, count)), reminder },
      };
    }
    const targets = joinListMore(listed, t);
    return {
      keypath: "alerts.sections.review.tells",
      parts: {
        targets: strong(targets),
        incident: plain(incident ? t("alerts.sections.review.incidentTail") : raw("")),
        reminder,
      },
    };
  };

  const scheduleLine = (fd: AlertSectionsFormData): ReviewSentence => {
    if (mode.value === "composite") {
      return { keypath: "alerts.sections.review.checksComposite", parts: {} };
    }
    if (mode.value === "anomaly") {
      const anomaly = input.anomalyConfig.value ?? {};
      const value = Number(anomaly.schedule_interval_value ?? 1);
      return {
        keypath: "alerts.sections.review.checksEvery",
        parts: {
          every: strong(everyWords(anomaly.schedule_interval_unit === "m" ? value : value * 60, t)),
          window: plain(
            durationPart(
              minutesOf(anomaly.detection_window_value ?? 3, anomaly.detection_window_unit ?? "h"),
            ),
          ),
        },
      };
    }
    const tc = fd.trigger_condition ?? {};
    if (forecastOf(fd) && fd.query_condition?.type === "promql" && tc.frequency_type !== "cron") {
      return {
        keypath: "alerts.sections.review.checksForecast",
        parts: {
          every: strong(everyWords(Number(tc.frequency ?? 10), t)),
          window: plain(forecastWindowWords(fd)),
        },
      };
    }
    const window = plain(durationPart(Number(tc.period ?? 0)));
    if (tc.frequency_type === "cron") {
      return {
        keypath: "alerts.sections.review.checksCron",
        parts: { cron: strong(raw(tc.cron ?? "")), window },
      };
    }
    return {
      keypath: "alerts.sections.review.checksEvery",
      parts: { every: strong(everyWords(Number(tc.frequency ?? 10), t)), window },
    };
  };

  const review = computed<AlertReviewLine[]>(() => {
    const fd = input.formData.value ?? {};
    const lines: AlertReviewLine[] = [
      { id: "watch", ...watchLine(fd) },
      { id: "condition", ...conditionLine(fd) },
      { id: "notify", ...notifyLine(fd) },
    ];
    // A real-time alert has no schedule; its watch line and verdict already say so.
    if (mode.value !== "true") lines.push({ id: "schedule", ...scheduleLine(fd) });
    return lines;
  });

  return { sections, items, errorCounts, review };
}
