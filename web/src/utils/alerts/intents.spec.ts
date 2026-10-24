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

import { describe, expect, it } from "vitest";
import i18n from "@/locales";
import { ALERT_NAME_UNSUPPORTED_CHARS } from "@/components/alerts/AddAlert.schema";
import { ALERT_PREFILL_VERSION } from "@/ts/interfaces/alertPrefill";
import {
  ALERT_INTENTS,
  INTENT_SCHEMA_LIMIT,
  getIntent,
  intentSchemaKey,
  streamsForSchemaPass,
  valueChipField,
  type IntentField,
  type IntentSchemas,
  type IntentStream,
} from "@/utils/alerts/intents";

const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);
const MINUTE_US = 60_000_000;
const HOUR_US = 60 * MINUTE_US;
const DAY_US = 24 * HOUR_US;
const nowUs = NOW * 1000;

const stream = (
  name: string,
  stream_type: string,
  doc_num: number,
  ageUs: number = MINUTE_US,
): IntentStream => ({ name, stream_type, stats: { doc_num, doc_time_max: nowUs - ageUs } });

const fields = (...names: string[]): IntentField[] => names.map((name) => ({ name, type: "Utf8" }));

const schemasOf = (entries: Array<[IntentStream, IntentField[]]>): IntentSchemas =>
  Object.fromEntries(entries.map(([s, f]) => [intentSchemaKey(s), f]));

describe("ALERT_INTENTS", () => {
  it("offers the six intents of the design, each titled in English", () => {
    expect(ALERT_INTENTS.map((intent) => intent.id)).toEqual([
      "errors_increase",
      "requests_get_slow",
      "data_stops_arriving",
      "message_appears",
      "metric_crosses_limit",
      "something_unusual",
    ]);
    expect(ALERT_INTENTS.map((intent) => i18n.global.t(intent.titleKey))).toEqual([
      "Errors increase",
      "Requests get slow",
      "Data stops arriving",
      "A message appears",
      "A metric crosses a limit",
      "Something unusual",
    ]);
  });

  it("looks an intent up by id and returns undefined for an unknown one", () => {
    expect(getIntent("errors_increase")?.id).toBe("errors_increase");
    expect(getIntent("nope")).toBeUndefined();
    expect(getIntent(undefined)).toBeUndefined();
  });

  it("carries a value-chip row only on Errors increase", () => {
    expect(ALERT_INTENTS.filter((intent) => intent.valueChips).map((i) => i.id)).toEqual([
      "errors_increase",
    ]);
  });
});

describe("streamsForSchemaPass (pass 1, stream stats only)", () => {
  it("keeps the intent's stream types with recent data, by volume, capped at ten", () => {
    const streams = [
      ...Array.from({ length: 12 }, (_, i) => stream(`logs_${i}`, "logs", 100 + i)),
      stream("big_metrics", "metrics", 10_000),
      stream("empty_logs", "logs", 0),
      stream("stale_logs", "logs", 99_999, 8 * DAY_US),
    ];
    const picked = streamsForSchemaPass(getIntent("message_appears")!, streams, NOW);

    expect(INTENT_SCHEMA_LIMIT).toBe(10);
    expect(picked).toHaveLength(10);
    expect(picked[0].name).toBe("logs_11");
    expect(picked.map((s) => s.name)).not.toContain("big_metrics");
    expect(picked.map((s) => s.name)).not.toContain("empty_logs");
    expect(picked.map((s) => s.name)).not.toContain("stale_logs");
  });

  it("asks Data stops arriving only for streams with data in the last hour", () => {
    const streams = [
      stream("fresh", "logs", 10, 5 * MINUTE_US),
      stream("quiet", "traces", 10_000, 2 * HOUR_US),
      stream("fresh_metrics", "metrics", 5, 30 * MINUTE_US),
    ];
    const picked = streamsForSchemaPass(getIntent("data_stops_arriving")!, streams, NOW);
    expect(picked.map((s) => s.name)).toEqual(["fresh", "fresh_metrics"]);
  });
});

describe("rankStreams (pass 2, schemas of the top ten)", () => {
  it("ranks Errors increase by fit: a level field before error text, then traces with a status", () => {
    const textOnly = stream("text_logs", "logs", 9_000);
    const levelled = stream("app_logs", "logs", 10);
    const spans = stream("default", "traces", 500);
    const unfit = stream("audit", "logs", 99_000);
    const schemas = schemasOf([
      [textOnly, fields("body", "host")],
      [levelled, fields("level", "body")],
      [spans, fields("span_status", "duration")],
      [unfit, fields("user", "action")],
    ]);
    const ranked = getIntent("errors_increase")!.rankStreams(
      [textOnly, levelled, spans, unfit],
      schemas,
      NOW,
    );
    expect(ranked.map((s) => s.name)).toEqual(["app_logs", "default", "text_logs"]);
  });

  it("drops a stream whose schema was not fetched rather than guessing", () => {
    const outside = stream("outside", "logs", 10);
    const ranked = getIntent("errors_increase")!.rankStreams([outside], {}, NOW);
    expect(ranked).toEqual([]);
  });

  it("only reads schemas for the streams pass 1 kept", () => {
    const streams = Array.from({ length: 11 }, (_, i) => stream(`l${i}`, "logs", 100 - i));
    const all = schemasOf(streams.map((s) => [s, fields("level")]));
    const ranked = getIntent("errors_increase")!.rankStreams(streams, all, NOW);
    expect(ranked).toHaveLength(10);
    expect(ranked.map((s) => s.name)).not.toContain("l10");
  });

  it("ranks Requests get slow on traces with a duration and latency-named metrics", () => {
    const spans = stream("default", "traces", 10);
    const noDuration = stream("other", "traces", 10_000);
    const latency = stream("http_request_duration_seconds", "metrics", 50);
    const cpu = stream("cpu_usage", "metrics", 90_000);
    const ranked = getIntent("requests_get_slow")!.rankStreams(
      [spans, noDuration, latency, cpu],
      schemasOf([
        [spans, fields("duration")],
        [noDuration, fields("service_name")],
        [latency, fields("value")],
        [cpu, fields("value")],
      ]),
      NOW,
    );
    expect(ranked.map((s) => s.name)).toEqual(["http_request_duration_seconds", "default"]);
  });

  it("ranks Data stops arriving without any schema", () => {
    const ranked = getIntent("data_stops_arriving")!.rankStreams(
      [stream("a", "logs", 5), stream("b", "logs", 50)],
      {},
      NOW,
    );
    expect(ranked.map((s) => s.name)).toEqual(["b", "a"]);
  });
});

describe("buildPrefill", () => {
  const payments = stream("payment", "logs", 1000);

  it("builds Errors increase as a Builder count rule filtered on the level field", () => {
    const prefill = getIntent("errors_increase")!.buildPrefill(
      payments,
      fields("level", "body", "service"),
    );
    expect(prefill).toMatchObject({
      version: ALERT_PREFILL_VERSION,
      source: "intent",
      sourceLabel: "payment",
      name: "payment_errors_increase",
      streamType: "logs",
      streamName: "payment",
      queryType: "custom",
      periodMinutes: 10,
      silenceMinutes: 60,
      contextAttributes: { intent_id: "errors_increase" },
      intentDefaults: true,
      warnings: [],
    });
    expect(prefill.aggregation).toBeUndefined();
    expect(prefill.pendingPeriodMinutes).toBeUndefined();
    expect(prefill.conditions?.logicalOperator).toBe("AND");
    expect(prefill.conditions?.conditions).toEqual([
      expect.objectContaining({
        filterType: "condition",
        column: "level",
        operator: "=",
        value: "error",
      }),
    ]);
  });

  it("falls back to error text when the logs have no level field", () => {
    const prefill = getIntent("errors_increase")!.buildPrefill(payments, fields("message"));
    expect(prefill.conditions?.conditions[0]).toMatchObject({
      column: "message",
      operator: "Contains",
      value: "error",
    });
  });

  it("filters traces on the span status", () => {
    const prefill = getIntent("errors_increase")!.buildPrefill(
      stream("default", "traces", 10),
      fields("span_status"),
    );
    expect(prefill.conditions?.conditions[0]).toMatchObject({
      column: "span_status",
      operator: "=",
      value: "ERROR",
    });
  });

  it("builds Requests get slow as a p95 value rule that holds for one period and asks for the limit", () => {
    const prefill = getIntent("requests_get_slow")!.buildPrefill(
      stream("default", "traces", 10),
      fields("duration"),
    );
    expect(prefill.aggregation).toEqual({
      group_by: [],
      function: "p95",
      having: { column: "duration", operator: ">=", value: null },
    });
    expect(prefill.pendingPeriodMinutes).toBe(prefill.periodMinutes);
    expect(prefill.silenceMinutes).toBe(60);
  });

  it("builds Data stops arriving as fewer than one event in 15 minutes", () => {
    const prefill = getIntent("data_stops_arriving")!.buildPrefill(payments, []);
    expect(prefill).toMatchObject({
      queryType: "custom",
      periodMinutes: 15,
      triggerThreshold: 1,
      triggerOperator: "<",
      name: "payment_data_stops_arriving",
    });
    expect(prefill.conditions?.conditions).toEqual([]);
  });

  it("builds A message appears with an empty text match the user fills in", () => {
    const prefill = getIntent("message_appears")!.buildPrefill(payments, fields("body"));
    expect(prefill.conditions?.conditions[0]).toMatchObject({
      column: "body",
      operator: "Contains",
      value: "",
    });
    expect(prefill).toMatchObject({ triggerThreshold: 1, triggerOperator: ">=" });
  });

  it("builds A metric crosses a limit as an average of the value that holds for one period", () => {
    const prefill = getIntent("metric_crosses_limit")!.buildPrefill(
      stream("cpu_usage", "metrics", 10),
      fields("value"),
    );
    expect(prefill.aggregation?.function).toBe("avg");
    expect(prefill.aggregation?.having.column).toBe("value");
    expect(prefill.pendingPeriodMinutes).toBe(10);
  });

  it("marks Something unusual as needing anomaly detection", () => {
    const intent = getIntent("something_unusual")!;
    expect(intent.requiresAnomaly).toBe(true);
    const prefill = intent.buildPrefill(payments, []);
    expect(prefill.alertType).toBe("anomaly");
    expect(prefill.meta).toBeUndefined();
    expect(ALERT_INTENTS.filter((i) => i.requiresAnomaly).map((i) => i.id)).toEqual([
      "something_unusual",
    ]);
  });

  it("never sets recovery and always tags the intent", () => {
    for (const intent of ALERT_INTENTS) {
      const prefill = intent.buildPrefill(payments, fields("level", "body", "duration", "value"));
      expect(prefill.contextAttributes).toEqual({ intent_id: intent.id });
      expect(prefill.intentDefaults).toBe(true);
      expect(prefill.silenceMinutes).toBe(60);
    }
  });

  it("names every intent's alert in snake_case English the form accepts", () => {
    const awkward = stream("my app:logs", "logs", 10);
    for (const intent of ALERT_INTENTS) {
      const name = intent.buildPrefill(awkward, fields("level", "body", "duration", "value"))
        .name as string;
      expect(name).toMatch(/^[a-z0-9_]+$/);
      expect(name).not.toMatch(ALERT_NAME_UNSUPPORTED_CHARS);
      expect(name.endsWith(`_${intent.id}`)).toBe(true);
    }
    expect(getIntent("errors_increase")!.buildPrefill(awkward, fields("level")).name).toBe(
      "my_app_logs_errors_increase",
    );
  });
});

describe("valueChipField", () => {
  it("picks the first low-cardinality field the design names", () => {
    expect(valueChipField(fields("body", "k8s_namespace_name", "service"))).toBe("service");
    expect(valueChipField(fields("app"))).toBe("app");
    expect(valueChipField(fields("k8s_namespace_name"))).toBe("k8s_namespace_name");
    expect(valueChipField(fields("body", "host"))).toBeNull();
  });

  it("reads the form's column options as well as schema fields", () => {
    expect(valueChipField([{ label: "service_name", value: "service_name" }])).toBe("service_name");
  });
});
