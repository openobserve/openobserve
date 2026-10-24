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
import {
  ALERT_PREFILL_VERSION,
  type AlertPrefill,
  type AlertPrefillAggregation,
} from "@/ts/interfaces/alertPrefill";

export type IntentId =
  | "errors_increase"
  | "requests_get_slow"
  | "data_stops_arriving"
  | "message_appears"
  | "metric_crosses_limit"
  | "something_unusual";

export interface IntentStream {
  name: string;
  stream_type: string;
  stats?: { doc_num?: number; doc_time_max?: number };
}

/** A schema field, or one of the form's column options (`value` is the field name). */
export interface IntentField {
  name?: string;
  value?: string;
  type?: string;
  label?: string;
}

/** Schemas of the pass-1 streams, keyed by `intentSchemaKey`. */
export type IntentSchemas = Record<string, IntentField[]>;

export interface AlertIntent {
  id: IntentId;
  titleKey: I18nKey;
  streamTypes: string[];
  /** Pass 2 reads the schema; without one the stream is dropped. */
  needsSchema: boolean;
  /** Offers the "Add a service filter" chip row in the form. */
  valueChips: boolean;
  /** The caller hides it unless anomaly detection is available. */
  requiresAnomaly?: true;
  rankStreams(streams: IntentStream[], schemas: IntentSchemas, now?: number): IntentStream[];
  buildPrefill(stream: IntentStream, schema: IntentField[]): AlertPrefill;
}

/** Fit of one stream to an intent: its tier (0 = no fit) and the field the rule reads. */
interface IntentFit {
  tier: number;
  field: string | null;
}

/** Only the top streams by stats get a schema fetch (useStreams lists streams without schemas). */
export const INTENT_SCHEMA_LIMIT = 10;

const HOUR_MS = 3_600_000;
const WEEK_MS = 7 * 24 * HOUR_MS;
const INTENT_SILENCE_MINUTES = 60;
const INTENT_PERIOD_MINUTES = 10;
const ABSENCE_PERIOD_MINUTES = 15;

const LEVEL_FIELDS = ["level", "severity", "log_level", "severity_text", "loglevel"];
const TEXT_FIELDS = ["body", "message", "msg", "log"];
const TRACE_STATUS_FIELD = "span_status";
const DURATION_FIELD = "duration";
const METRIC_VALUE_FIELD = "value";
const LATENCY_NAME = /duration|latency/i;
// Order is preference: the design names service, then app, then the k8s namespace.
const VALUE_CHIP_FIELDS = [
  "service",
  "service_name",
  "app",
  "app_name",
  "application",
  "k8s_namespace_name",
  "kubernetes_namespace_name",
  "namespace",
];

export const intentSchemaKey = (stream: IntentStream): string =>
  `${stream.stream_type}/${stream.name}`;

const fieldName = (field: IntentField): string => String(field.name ?? field.value ?? "");

const findField = (schema: IntentField[], candidates: string[]): string | null => {
  const names = new Map(schema.map((f) => [fieldName(f).toLowerCase(), fieldName(f)]));
  for (const candidate of candidates) {
    const found = names.get(candidate);
    if (found) return found;
  }
  return null;
};

/** The first low-cardinality field the chip row can offer values for, or null. */
export const valueChipField = (schema: IntentField[]): string | null =>
  findField(schema, VALUE_CHIP_FIELDS);

const docNum = (stream: IntentStream): number => Number(stream.stats?.doc_num ?? 0) || 0;
const lastSeenMs = (stream: IntentStream): number =>
  (Number(stream.stats?.doc_time_max ?? 0) || 0) / 1000;

// Names are identifiers shared across the org, so they stay English and snake_case.
const intentAlertName = (stream: IntentStream, id: IntentId): string =>
  `${stream.name}_${id}`
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/_+$/g, "");

const condition = (column: string, operator: string, value: string) => ({
  filterType: "condition",
  column,
  operator,
  value,
  values: [],
  logicalOperator: "AND",
  ignore_case: false,
  id: `intent-${column}`,
});

const conditionGroup = (conditions: any[]) => ({
  filterType: "group" as const,
  logicalOperator: "AND",
  groupId: "intent-root",
  conditions,
});

const valueAggregation = (fn: string, column: string): AlertPrefillAggregation => ({
  group_by: [],
  function: fn,
  having: { column, operator: ">=", value: null },
});

const basePrefill = (stream: IntentStream, id: IntentId): AlertPrefill => ({
  version: ALERT_PREFILL_VERSION,
  source: "intent",
  sourceLabel: stream.name,
  name: intentAlertName(stream, id),
  streamType: stream.stream_type,
  streamName: stream.name,
  queryType: "custom",
  conditions: conditionGroup([]),
  periodMinutes: INTENT_PERIOD_MINUTES,
  silenceMinutes: INTENT_SILENCE_MINUTES,
  contextAttributes: { intent_id: id },
  intentDefaults: true,
  warnings: [],
});

/** Pass 1: the intent's stream types with data in its window, by volume, capped for the schema fetch. */
export const streamsForSchemaPass = (
  intent: AlertIntent,
  streams: IntentStream[],
  now: number = Date.now(),
): IntentStream[] => {
  const windowMs = intent.id === "data_stops_arriving" ? HOUR_MS : WEEK_MS;
  return streams
    .filter(
      (s) =>
        intent.streamTypes.includes(s.stream_type) &&
        docNum(s) > 0 &&
        lastSeenMs(s) >= now - windowMs,
    )
    .sort((a, b) => docNum(b) - docNum(a) || lastSeenMs(b) - lastSeenMs(a))
    .slice(0, INTENT_SCHEMA_LIMIT);
};

/** Pass 2 over pass 1's streams: fitting streams only, best tier first, volume order kept within a tier. */
const rankByFit = (
  intent: AlertIntent,
  fit: (stream: IntentStream, schema: IntentField[]) => IntentFit,
  streams: IntentStream[],
  schemas: IntentSchemas,
  now: number = Date.now(),
): IntentStream[] =>
  streamsForSchemaPass(intent, streams, now)
    .map((stream, order) => {
      const schema = schemas[intentSchemaKey(stream)];
      if (intent.needsSchema && !schema) return { stream, order, tier: 0 };
      return { stream, order, tier: fit(stream, schema ?? []).tier };
    })
    .filter((entry) => entry.tier > 0)
    .sort((a, b) => b.tier - a.tier || a.order - b.order)
    .map((entry) => entry.stream);

const errorFit = (stream: IntentStream, schema: IntentField[]): IntentFit => {
  if (stream.stream_type === "traces") {
    const status = findField(schema, [TRACE_STATUS_FIELD]);
    return { tier: status ? 2 : 0, field: status };
  }
  const level = findField(schema, LEVEL_FIELDS);
  if (level) return { tier: 3, field: level };
  const text = findField(schema, TEXT_FIELDS);
  return { tier: text ? 1 : 0, field: text };
};

const slowFit = (stream: IntentStream, schema: IntentField[]): IntentFit => {
  if (stream.stream_type === "metrics") {
    return { tier: LATENCY_NAME.test(stream.name) ? 1 : 0, field: METRIC_VALUE_FIELD };
  }
  const duration = findField(schema, [DURATION_FIELD]);
  return { tier: duration ? 1 : 0, field: duration };
};

const textFit = (_stream: IntentStream, schema: IntentField[]): IntentFit => {
  const text = findField(schema, TEXT_FIELDS);
  return { tier: text ? 1 : 0, field: text };
};

const anyFit = (): IntentFit => ({ tier: 1, field: null });

const errorsIncrease: AlertIntent = {
  id: "errors_increase",
  titleKey: "alerts.intents.errors_increase.title",
  streamTypes: ["logs", "traces"],
  needsSchema: true,
  valueChips: true,
  rankStreams: (streams, schemas, now) =>
    rankByFit(errorsIncrease, errorFit, streams, schemas, now),
  buildPrefill: (stream, schema) => {
    const prefill = basePrefill(stream, "errors_increase");
    const { tier, field } = errorFit(stream, schema);
    if (!field) return prefill;
    const rule =
      stream.stream_type === "traces"
        ? condition(field, "=", "ERROR")
        : tier === 3
          ? condition(field, "=", "error")
          : condition(field, "Contains", "error");
    return { ...prefill, conditions: conditionGroup([rule]) };
  },
};

const requestsGetSlow: AlertIntent = {
  id: "requests_get_slow",
  titleKey: "alerts.intents.requests_get_slow.title",
  streamTypes: ["traces", "metrics"],
  needsSchema: true,
  valueChips: false,
  rankStreams: (streams, schemas, now) =>
    rankByFit(requestsGetSlow, slowFit, streams, schemas, now),
  buildPrefill: (stream, schema) => {
    const isMetric = stream.stream_type === "metrics";
    const column = isMetric ? METRIC_VALUE_FIELD : (findField(schema, [DURATION_FIELD]) ?? "");
    return {
      ...basePrefill(stream, "requests_get_slow"),
      aggregation: valueAggregation(isMetric ? "avg" : "p95", column),
      pendingPeriodMinutes: INTENT_PERIOD_MINUTES,
    };
  },
};

const dataStopsArriving: AlertIntent = {
  id: "data_stops_arriving",
  titleKey: "alerts.intents.data_stops_arriving.title",
  streamTypes: ["logs", "traces", "metrics"],
  needsSchema: false,
  valueChips: false,
  rankStreams: (streams, schemas, now) =>
    rankByFit(dataStopsArriving, anyFit, streams, schemas, now),
  buildPrefill: (stream) => {
    return {
      ...basePrefill(stream, "data_stops_arriving"),
      periodMinutes: ABSENCE_PERIOD_MINUTES,
      triggerThreshold: 1,
      triggerOperator: "<",
    };
  },
};

const messageAppears: AlertIntent = {
  id: "message_appears",
  titleKey: "alerts.intents.message_appears.title",
  streamTypes: ["logs"],
  needsSchema: true,
  valueChips: false,
  rankStreams: (streams, schemas, now) => rankByFit(messageAppears, textFit, streams, schemas, now),
  buildPrefill: (stream, schema) => {
    const text = textFit(stream, schema).field;
    return {
      ...basePrefill(stream, "message_appears"),
      conditions: conditionGroup(text ? [condition(text, "Contains", "")] : []),
      triggerThreshold: 1,
      triggerOperator: ">=",
    };
  },
};

const metricCrossesLimit: AlertIntent = {
  id: "metric_crosses_limit",
  titleKey: "alerts.intents.metric_crosses_limit.title",
  streamTypes: ["metrics"],
  needsSchema: false,
  valueChips: false,
  rankStreams: (streams, schemas, now) =>
    rankByFit(metricCrossesLimit, anyFit, streams, schemas, now),
  buildPrefill: (stream) => {
    return {
      ...basePrefill(stream, "metric_crosses_limit"),
      aggregation: valueAggregation("avg", METRIC_VALUE_FIELD),
      pendingPeriodMinutes: INTENT_PERIOD_MINUTES,
    };
  },
};

const somethingUnusual: AlertIntent = {
  id: "something_unusual",
  titleKey: "alerts.intents.something_unusual.title",
  streamTypes: ["logs", "traces", "metrics"],
  needsSchema: false,
  valueChips: false,
  requiresAnomaly: true,
  rankStreams: (streams, schemas, now) =>
    rankByFit(somethingUnusual, anyFit, streams, schemas, now),
  buildPrefill: (stream) => {
    return { ...basePrefill(stream, "something_unusual"), alertType: "anomaly" };
  },
};

export const ALERT_INTENTS: AlertIntent[] = [
  errorsIncrease,
  requestsGetSlow,
  dataStopsArriving,
  messageAppears,
  metricCrossesLimit,
  somethingUnusual,
];

export const getIntent = (id: string | undefined): AlertIntent | undefined =>
  ALERT_INTENTS.find((intent) => intent.id === id);
