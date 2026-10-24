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

import type { AlertPrefill } from "@/ts/interfaces/alertPrefill";
import { generateWhereClause, type StreamFieldsMap } from "@/utils/alerts/alertQueryBuilder";
import { scoreHistory, type Bucket, type RuleKind } from "@/utils/alerts/backtest";
import {
  ALERT_INTENTS,
  intentSchemaKey,
  streamsForSchemaPass,
  type AlertIntent,
  type IntentField,
  type IntentSchemas,
  type IntentStream,
} from "@/utils/alerts/intents";

/** One intent with the stream that fits it best, or none when nothing in the org fits. */
export interface IntentChoice {
  intent: AlertIntent;
  stream: IntentStream | null;
  schema: IntentField[];
  prefill: AlertPrefill | null;
}

/** A ready-to-review alert computed from the org's own streams. */
export interface AlertSuggestion {
  key: string;
  intent: AlertIntent;
  stream: IntentStream;
  schema: IntentField[];
  prefill: AlertPrefill;
}

/** The inputs one suggestion's back-test query needs. */
export interface SuggestionRule {
  streamName: string;
  streamType: string;
  kind: RuleKind;
  operator: string;
  periodMinutes: number;
  silenceMinutes: number;
  historySql: string;
}

/** What a suggestion's chip says about yesterday. */
export type SuggestionBacktest =
  { state: "tested"; episodes: number } | { state: "untested" } | { state: "failed" };

interface CachedBacktest {
  at: number;
  value: SuggestionBacktest;
}

/** The parts of a fetched history the score reads. */
interface SuggestionHistory {
  buckets: Bucket[];
  now: number;
  historyStart: number;
}

export const SUGGESTION_LIMIT = 3;
export const SUGGESTION_BACKTEST_TTL_MS = 3_600_000;

// Absence alerts can't be back-tested, and a message alert needs text only the user can type.
const NOT_SUGGESTED = new Set(["data_stops_arriving", "message_appears"]);
const DEFAULT_PERIOD_MINUTES = 10;
const PERCENTILES: Record<string, number> = { p50: 0.5, p75: 0.75, p90: 0.9, p95: 0.95, p99: 0.99 };

const backtestCache = new Map<string, CachedBacktest>();
let backtestQueue: Promise<unknown> = Promise.resolve();

const cacheKey = (org: string, key: string) => `${org}\u0000${key}`;

const fieldsMap = (schema: IntentField[]): StreamFieldsMap =>
  Object.fromEntries(
    schema
      .map((field) => ({ name: String(field.name ?? field.value ?? ""), type: field.type }))
      .filter((field) => field.name)
      .map(({ name, type }) => [name, { label: name, value: name, type: String(type ?? "") }]),
  );

/** Intents the org can use; the anomaly intent needs anomaly detection switched on. */
export const visibleIntents = (anomalyEnabled: boolean): AlertIntent[] =>
  ALERT_INTENTS.filter((intent) => !intent.requiresAnomaly || anomalyEnabled);

/** Streams whose schema at least one intent's ranking reads, each listed once. */
export const schemaPassStreams = (
  intents: AlertIntent[],
  streams: IntentStream[],
  now: number = Date.now(),
): IntentStream[] => {
  const byKey = new Map<string, IntentStream>();
  for (const intent of intents) {
    if (!intent.needsSchema) continue;
    for (const s of streamsForSchemaPass(intent, streams, now)) byKey.set(intentSchemaKey(s), s);
  }
  return [...byKey.values()];
};

/** Each intent's best-fitting stream and the prefill it builds there. */
export const buildIntentChoices = (
  intents: AlertIntent[],
  streams: IntentStream[],
  schemas: IntentSchemas,
  now: number = Date.now(),
): IntentChoice[] =>
  intents.map((intent) => {
    const stream = intent.rankStreams(streams, schemas, now)[0] ?? null;
    if (!stream) return { intent, stream: null, schema: [], prefill: null };
    const schema = schemas[intentSchemaKey(stream)] ?? [];
    return { intent, stream, schema, prefill: intent.buildPrefill(stream, schema) };
  });

/** Up to three suggestions in catalogue order, each opening as a "suggestion" prefill. */
export const pickSuggestions = (choices: IntentChoice[]): AlertSuggestion[] =>
  choices
    .filter((choice) => choice.stream && choice.prefill && !NOT_SUGGESTED.has(choice.intent.id))
    .slice(0, SUGGESTION_LIMIT)
    .map((choice) => ({
      key: `${choice.intent.id}:${intentSchemaKey(choice.stream as IntentStream)}`,
      intent: choice.intent,
      stream: choice.stream as IntentStream,
      schema: choice.schema,
      prefill: { ...(choice.prefill as AlertPrefill), source: "suggestion" },
    }));

/** The back-test query for a card whose limit is fitted from history; null for fixed or model-learned limits. */
export const suggestionRule = (
  prefill: AlertPrefill,
  schema: IntentField[],
): SuggestionRule | null => {
  if (prefill.triggerThreshold !== undefined || prefill.alertType === "anomaly") return null;
  const aggregation = prefill.aggregation ?? null;
  const column = aggregation?.having.column ?? "";
  if (aggregation && !column) return null;
  const periodMinutes = prefill.periodMinutes ?? DEFAULT_PERIOD_MINUTES;
  const percentile = aggregation ? PERCENTILES[aggregation.function] : undefined;
  const measure = !aggregation
    ? "COUNT(*)"
    : percentile
      ? `approx_percentile_cont(${column}, ${percentile})`
      : `${aggregation.function}(${column})`;
  const where = generateWhereClause(prefill.conditions, fieldsMap(schema));
  const interval = `'${Math.max(1, Math.round(periodMinutes))} minute'`;
  const historySql = [
    `SELECT histogram(_timestamp, ${interval}) AS zo_sql_key, ${measure} AS zo_sql_num`,
    `FROM "${prefill.streamName}"`,
    where.trim(),
    "GROUP BY zo_sql_key ORDER BY zo_sql_key ASC",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    streamName: prefill.streamName,
    streamType: prefill.streamType,
    kind: aggregation ? "value" : "count",
    operator: aggregation?.having.operator ?? prefill.triggerOperator ?? ">=",
    periodMinutes,
    silenceMinutes: prefill.silenceMinutes ?? 0,
    historySql,
  };
};

/** Yesterday's episodes at the limit the form would suggest, or untested without two days of history. */
export const scoreSuggestion = (
  history: SuggestionHistory,
  rule: SuggestionRule,
): SuggestionBacktest => {
  const score = scoreHistory({
    buckets: history.buckets,
    now: history.now,
    historyStart: history.historyStart,
    kind: rule.kind,
    operator: rule.operator,
    silenceMinutes: rule.silenceMinutes,
    periodMinutes: rule.periodMinutes,
  });
  const result = score.backtestFor(score.suggested);
  return result ? { state: "tested", episodes: result.episodes } : { state: "untested" };
};

/** A cached back-test for this org, or null once it is an hour old. */
export const readCachedBacktest = (
  org: string,
  key: string,
  now: number = Date.now(),
): SuggestionBacktest | null => {
  const hit = backtestCache.get(cacheKey(org, key));
  if (!hit) return null;
  if (now - hit.at >= SUGGESTION_BACKTEST_TTL_MS) {
    backtestCache.delete(cacheKey(org, key));
    return null;
  }
  return hit.value;
};

export const writeCachedBacktest = (
  org: string,
  key: string,
  value: SuggestionBacktest,
  now: number = Date.now(),
): void => {
  backtestCache.set(cacheKey(org, key), { at: now, value });
};

export const clearCachedBacktests = (): void => {
  backtestCache.clear();
};

/** Runs back-tests one at a time, so a sheet of cards never fires its queries together. */
export const runOneAtATime = <T>(task: () => Promise<T>): Promise<T> => {
  const run = backtestQueue.then(task, task);
  backtestQueue = run.catch(() => undefined);
  return run;
};
