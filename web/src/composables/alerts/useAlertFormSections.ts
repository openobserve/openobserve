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
  dataNoun,
  durationWords,
  everyWords,
  forecastWindowWords as windowWords,
  formatNumber,
} from "@/utils/alerts/alertCopy";
import { isForecastHorizonValid } from "@/utils/alerts/forecastAlert";
import {
  CONDITION_GAP_KEYS,
  conditionGap,
  eventCountText,
  operatorSymbol,
  type ConditionGap,
  type ReadBackAlert,
} from "@/utils/alerts/alertReadBack";

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
  schedule_interval_value?: number | string;
  schedule_interval_unit?: string;
  histogram_interval_value?: number | string;
  histogram_interval_unit?: string;
  detection_window_value?: number | string;
  detection_window_unit?: string;
  alert_direction?: string | null;
}

/** The bits of the alert form the section list reads; `formData` is the form's read-view. */
export interface AlertFormSectionsInput {
  /** The form's per-field meta (`form.useStore((s) => s.fieldMeta)`). */
  fieldMeta: Readonly<Ref<FieldMetaMap | undefined>>;
  formData: Ref<AlertSectionsFormData>;
  anomalyConfig: Ref<AlertSectionsAnomalyConfig>;
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

/** "at least 1", "not exactly 5": a comparison in the words the operator menu uses. */
const comparisonWords = (operator: string | undefined, value: unknown, t: TranslateFn): I18nText =>
  t("alerts.sections.review.comparison", {
    op: t(OPERATOR_WORDS[operator ?? ">="] ?? "alerts.sections.operators.gte"),
    value: formatNumber(value),
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
  const named = Object.fromEntries(Object.entries(line.parts).map(([k, p]) => [k, p.text]));
  return t(line.keypath, named, line.plural ?? 1);
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
        ? raw(`${operatorSymbol(pc?.operator)} ${formatNumber(pc?.value)}`)
        : raw(alertConditionText(fd));
    }
    const tc = fd.trigger_condition ?? {};
    const count = countLimit(tc.operator, tc.threshold ?? 1);
    const pc = qc.promql_condition;
    if (!pc || !hasValue(pc.value)) return t("alerts.sections.condition.series", { count });
    const limit = `${operatorSymbol(pc.operator)} ${formatNumber(pc.value)}`.trim();
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
    const gap = conditionGap(fd, { queryFailed: input.queryFailed?.value === true });
    if (gap) return { kind: gap, text: t(CONDITION_GAP_KEYS[gap]) };
    const qc = fd.query_condition ?? {};
    if (qc.type === "promql") return { kind: "value", text: promqlPhrase(fd) };
    if (qc.aggregation && input.isAggregationEnabled.value) {
      const having = qc.aggregation.having ?? {};
      return {
        kind: "value",
        text: t("alerts.sections.condition.measureNav", {
          measure: measureWords(fd),
          op: operatorSymbol(having.operator),
          value: formatNumber(having.value),
        }),
      };
    }
    if (qc.type === "sql") {
      const tc = fd.trigger_condition ?? {};
      const count = countLimit(tc.operator, tc.threshold ?? "");
      return { kind: "rows", text: t("alerts.sections.condition.rows", { count }) };
    }
    return { kind: "events", text: eventCountText(fd.trigger_condition, t, fd.stream_type) };
  };

  const measureWords = (fd: AlertSectionsFormData): I18nText => {
    const agg = fd.query_condition?.aggregation;
    return t("alerts.verdict.measure", {
      fn: agg?.function ?? "",
      field: agg?.having?.column ?? "",
    });
  };

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

  const notifySummary = (fd: AlertSectionsFormData, count: number): I18nText => {
    const incident = opensIncident(fd);
    if (!incident) {
      if (count === 0) return t("alerts.sections.notify.nobody");
      return count === 1 && fd.destinations?.length === 1
        ? raw(fd.destinations[0])
        : t("alerts.sections.notify.destinationCount", { count }, count);
    }
    const listed = (fd.destinations?.length ?? 0) + (fd.workflows?.length ?? 0);
    if (listed > 0) {
      const targets =
        listed === 1 && fd.destinations?.length === 1
          ? raw(fd.destinations[0])
          : t("alerts.sections.notify.destinationCount", { count: listed }, listed);
      return t("alerts.sections.notify.targetsAndIncident", { targets });
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
        return { missing: gap && !incomplete, empty: incomplete, summary: text };
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
    return {
      keypath: WATCH_KEYS[mode.value] ?? "alerts.sections.review.watchScheduled",
      parts: {
        type: strong(typeKey ? t(typeKey) : raw(fd.stream_type)),
        stream: strong(raw(fd.stream_name)),
      },
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
        comparison: comparisonWords(having.operator, having.value, t),
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
    const { kind, text } = conditionPhrase(fd);
    const window = plain(durationPart(Number(fd.trigger_condition?.period ?? 0)));
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
    const comparison = strong(comparisonWords(pc.operator, pc.value, t));
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
    const reminder = plain(
      silence > 0
        ? t("alerts.sections.review.reminder", { duration: everyWords(silence, t) })
        : raw(""),
    );
    const listed = (fd.destinations?.length ?? 0) + (fd.workflows?.length ?? 0);
    if (incident && listed === 0) {
      return {
        keypath: "alerts.sections.review.incidentOnly",
        parts: { incident: plain(notifySummary(fd, count)), reminder },
      };
    }
    const shown = incident ? listed : count;
    const targets =
      shown === 1 && fd.destinations?.length === 1
        ? raw(fd.destinations[0])
        : t("alerts.sections.notify.destinationCount", { count: shown }, shown);
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
