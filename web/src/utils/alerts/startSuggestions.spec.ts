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

import { afterEach, describe, expect, it } from "vitest";
import {
  intentSchemaKey,
  type IntentField,
  type IntentSchemas,
  type IntentStream,
} from "@/utils/alerts/intents";
import {
  SUGGESTION_BACKTEST_TTL_MS,
  SUGGESTION_LIMIT,
  buildIntentChoices,
  clearCachedBacktests,
  pickSuggestions,
  readCachedBacktest,
  runOneAtATime,
  schemaPassStreams,
  scoreSuggestion,
  suggestionRule,
  visibleIntents,
  writeCachedBacktest,
} from "@/utils/alerts/startSuggestions";

const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const stream = (name: string, stream_type: string, doc_num: number): IntentStream => ({
  name,
  stream_type,
  stats: { doc_num, doc_time_max: (NOW - MINUTE_MS) * 1000 },
});

const fields = (...names: string[]): IntentField[] => names.map((name) => ({ name, type: "Utf8" }));

const schemasOf = (entries: Array<[IntentStream, IntentField[]]>): IntentSchemas =>
  Object.fromEntries(entries.map(([s, f]) => [intentSchemaKey(s), f]));

const app = stream("app", "logs", 900);
const spans = stream("spans", "traces", 500);
const cpu = stream("cpu_latency", "metrics", 300);
const schemas = schemasOf([
  [app, fields("level", "body", "service")],
  [spans, fields("span_status", "duration")],
]);

afterEach(() => clearCachedBacktests());

describe("visibleIntents", () => {
  it("hides the anomaly intent unless anomaly detection is on", () => {
    expect(visibleIntents(false).map((i) => i.id)).not.toContain("something_unusual");
    expect(visibleIntents(true).map((i) => i.id)).toContain("something_unusual");
    expect(visibleIntents(false)).toHaveLength(5);
  });
});

describe("schemaPassStreams", () => {
  it("fetches each schema-needing stream once across intents", () => {
    const keys = schemaPassStreams(visibleIntents(true), [app, spans, cpu], NOW).map(
      intentSchemaKey,
    );
    expect(keys.sort()).toEqual(["logs/app", "metrics/cpu_latency", "traces/spans"]);
  });
});

describe("buildIntentChoices", () => {
  it("gives each intent its best stream and that stream's prefill", () => {
    const choices = buildIntentChoices(visibleIntents(false), [app, spans, cpu], schemas, NOW);
    const errors = choices.find((c) => c.intent.id === "errors_increase");
    expect(errors?.stream?.name).toBe("app");
    expect(errors?.prefill?.source).toBe("intent");
    expect(errors?.prefill?.streamName).toBe("app");
  });

  it("leaves an intent without a stream when none fits", () => {
    const choices = buildIntentChoices(visibleIntents(false), [cpu], {}, NOW);
    const message = choices.find((c) => c.intent.id === "message_appears");
    expect(message?.stream).toBeNull();
    expect(message?.prefill).toBeNull();
  });
});

describe("pickSuggestions", () => {
  it("offers up to three suggestions, never Data stops arriving", () => {
    const choices = buildIntentChoices(visibleIntents(true), [app, spans, cpu], schemas, NOW);
    const picked = pickSuggestions(choices);
    expect(picked.length).toBe(SUGGESTION_LIMIT);
    expect(picked.map((s) => s.intent.id)).not.toContain("data_stops_arriving");
  });

  it("never suggests A message appears, whose match text the user must type", () => {
    const choices = buildIntentChoices(visibleIntents(true), [app, spans, cpu], schemas, NOW);
    expect(choices.find((c) => c.intent.id === "message_appears")?.stream?.name).toBe("app");
    expect(pickSuggestions(choices).map((s) => s.intent.id)).not.toContain("message_appears");
  });

  it("tags each suggestion's prefill as a suggestion with a unique key", () => {
    const choices = buildIntentChoices(visibleIntents(false), [app, spans, cpu], schemas, NOW);
    const picked = pickSuggestions(choices);
    expect(picked.every((s) => s.prefill.source === "suggestion")).toBe(true);
    expect(new Set(picked.map((s) => s.key)).size).toBe(picked.length);
  });

  it("offers nothing when only Data stops arriving fits", () => {
    const quiet = stream("quiet", "logs", 10);
    const choices = buildIntentChoices(visibleIntents(false), [quiet], {}, NOW);
    expect(choices.find((c) => c.intent.id === "data_stops_arriving")?.stream?.name).toBe("quiet");
    expect(pickSuggestions(choices)).toEqual([]);
  });
});

describe("suggestionRule", () => {
  const choices = buildIntentChoices(visibleIntents(true), [app, spans, cpu], schemas, NOW);
  const prefillOf = (id: string) => choices.find((c) => c.intent.id === id)!;

  it("back-tests an Errors increase card as a count of its filtered rows", () => {
    const choice = prefillOf("errors_increase");
    const rule = suggestionRule(choice.prefill!, choice.schema);
    expect(rule?.kind).toBe("count");
    expect(rule?.operator).toBe(">=");
    expect(rule?.historySql).toMatch(/histogram\(_timestamp, '10 minute'\)/);
    expect(rule?.historySql).toMatch(/level = 'error'/);
  });

  it("back-tests a Requests get slow card on its aggregated value", () => {
    const choice = prefillOf("requests_get_slow");
    const rule = suggestionRule(choice.prefill!, choice.schema);
    expect(rule?.kind).toBe("value");
    expect(rule?.historySql).toMatch(/approx_percentile_cont\(duration, 0.95\)/);
  });

  it("skips cards whose limit is not fitted from history", () => {
    const message = prefillOf("message_appears");
    const unusual = prefillOf("something_unusual");
    expect(suggestionRule(message.prefill!, message.schema)).toBeNull();
    expect(suggestionRule(unusual.prefill!, unusual.schema)).toBeNull();
  });
});

describe("scoreSuggestion", () => {
  const rule = {
    streamName: "app",
    streamType: "logs",
    kind: "count" as const,
    operator: ">=",
    periodMinutes: 10,
    silenceMinutes: 60,
    historySql: "SELECT 1",
  };
  const steady = (start: number, end: number) => {
    const buckets = [];
    for (let time = start; time < end; time += 10 * MINUTE_MS) buckets.push({ time, value: 2 });
    return buckets;
  };

  it("counts yesterday's episodes at the suggested limit", () => {
    const buckets = steady(NOW - 7 * DAY_MS, NOW);
    buckets.push({ time: NOW - 2 * HOUR_MS + 1, value: 500 });
    const result = scoreSuggestion(
      { buckets, now: NOW, historyStart: NOW - 7 * DAY_MS, truncatedDays: null },
      rule,
    );
    expect(result).toEqual({ state: "tested", episodes: 1 });
  });

  it("reports a quiet day as zero episodes", () => {
    const result = scoreSuggestion(
      {
        buckets: steady(NOW - 7 * DAY_MS, NOW),
        now: NOW,
        historyStart: NOW - 7 * DAY_MS,
        truncatedDays: null,
      },
      rule,
    );
    expect(result).toEqual({ state: "tested", episodes: 0 });
  });

  it("says untested when the stream is under two days old", () => {
    const result = scoreSuggestion(
      {
        buckets: steady(NOW - 5 * HOUR_MS, NOW),
        now: NOW,
        historyStart: NOW - 5 * HOUR_MS,
        truncatedDays: null,
      },
      rule,
    );
    expect(result).toEqual({ state: "untested" });
  });
});

describe("back-test cache", () => {
  const tested = { state: "tested" as const, episodes: 2 };

  it("returns a result for an hour, then forgets it", () => {
    writeCachedBacktest("org1", "k", tested, NOW);
    expect(readCachedBacktest("org1", "k", NOW + SUGGESTION_BACKTEST_TTL_MS - 1)).toEqual(tested);
    expect(readCachedBacktest("org1", "k", NOW + SUGGESTION_BACKTEST_TTL_MS + 1)).toBeNull();
  });

  it("keeps each org's results apart", () => {
    writeCachedBacktest("org1", "k", tested, NOW);
    expect(readCachedBacktest("org2", "k", NOW)).toBeNull();
  });
});

describe("runOneAtATime", () => {
  it("starts the next back-test only once the previous one settles", async () => {
    const order: string[] = [];
    let releaseFirst: () => void = () => {};
    const first = runOneAtATime(
      () =>
        new Promise<void>((resolve) => {
          order.push("first:start");
          releaseFirst = () => {
            order.push("first:end");
            resolve();
          };
        }),
    );
    const second = runOneAtATime(async () => {
      order.push("second:start");
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("keeps the queue moving after a failed back-test", async () => {
    await expect(runOneAtATime(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(runOneAtATime(async () => "next")).resolves.toBe("next");
  });
});
