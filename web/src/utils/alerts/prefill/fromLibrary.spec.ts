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

import { buildPrefillFromLibrary } from "./fromLibrary";
import { ALERT_PREFILL_VERSION } from "@/ts/interfaces/alertPrefill";
import type { AlertLibraryEntry, AlertLibraryFile } from "@/types/alertLibrary";

const entry = (over: Partial<AlertLibraryEntry> = {}): AlertLibraryEntry => ({
  id: "k8s/go_gc_pause_high",
  name: "go_gc_pause_high",
  pack: "k8s",
  category: "app-performance",
  title: "Go GC Pause High",
  severity: "warning",
  description: "Go GC average pause time exceeds 100ms.",
  stream: "go_gc_duration_seconds_sum",
  stream_type: "metrics",
  query_type: "promql",
  required_streams: ["go_gc_duration_seconds_sum"],
  path: "packs/k8s/alerts/app-performance/go_gc_pause_high.json",
  content_hash: "1c09e8f6ac33",
  ...over,
});

const promqlFile = (): AlertLibraryFile => ({
  id: "3Dnovc9lnVMx1H6gvcRZbN01FYu",
  name: "go_gc_pause_high",
  stream_type: "metrics",
  stream_name: "go_gc_duration_seconds_sum",
  query_condition: {
    type: "promql",
    sql: null,
    promql: "rate(go_gc_duration_seconds_sum[5m])",
    promql_condition: { column: "value", operator: ">", value: 100, ignore_case: false },
    vrl_function: null,
  },
  trigger_condition: {
    period: 5,
    operator: ">=",
    threshold: 1,
    frequency: 5,
    silence: 30,
    timezone: "UTC",
  },
});

const sqlFile = (): AlertLibraryFile => ({
  name: "azure_maintenance_scheduled_events",
  stream_type: "logs",
  stream_name: "k8s_events",
  query_condition: {
    type: "sql",
    sql: 'SELECT count(*) as event_count FROM "k8s_events" HAVING event_count > 0',
    promql: null,
    promql_condition: null,
  },
  trigger_condition: { period: 5, operator: ">=", threshold: 1, frequency: 5, silence: 120 },
});

describe("buildPrefillFromLibrary", () => {
  it("declares the library as its source, labelled with the alert's title", () => {
    const prefill = buildPrefillFromLibrary({ entry: entry(), file: promqlFile() });
    expect(prefill.source).toBe("library");
    expect(prefill.sourceLabel).toBe("Go GC Pause High");
    expect(prefill.version).toBe(ALERT_PREFILL_VERSION);
  });

  it("carries the PromQL query and its structured threshold across intact", () => {
    const prefill = buildPrefillFromLibrary({ entry: entry(), file: promqlFile() });
    expect(prefill.queryType).toBe("promql");
    expect(prefill.promql).toBe("rate(go_gc_duration_seconds_sum[5m])");
    expect(prefill.promqlCondition).toEqual({ column: "value", operator: ">", value: 100 });
    expect(prefill.sql).toBeUndefined();
  });

  it("carries the SQL query and leaves promqlCondition unset", () => {
    const prefill = buildPrefillFromLibrary({
      entry: entry({ query_type: "sql", stream_type: "logs" }),
      file: sqlFile(),
    });
    expect(prefill.queryType).toBe("sql");
    expect(prefill.sql).toContain("HAVING event_count > 0");
    expect(prefill.promqlCondition).toBeNull();
  });

  it("keeps the query byte-for-byte — this path exists BECAUSE nothing is substituted", () => {
    const file = sqlFile();
    const prefill = buildPrefillFromLibrary({ entry: entry({ query_type: "sql" }), file });
    expect(prefill.sql).toBe((file.query_condition as any).sql);
  });

  it("maps the stream from the file, which is what the query actually reads", () => {
    const prefill = buildPrefillFromLibrary({ entry: entry(), file: promqlFile() });
    expect(prefill.streamName).toBe("go_gc_duration_seconds_sum");
    expect(prefill.streamType).toBe("metrics");
  });

  it("falls back to the manifest entry when the file omits the stream", () => {
    const file = promqlFile();
    delete file.stream_name;
    delete file.stream_type;
    const prefill = buildPrefillFromLibrary({ entry: entry(), file });
    expect(prefill.streamName).toBe("go_gc_duration_seconds_sum");
    expect(prefill.streamType).toBe("metrics");
  });

  it("carries the tuned period and frequency as minutes", () => {
    const file = promqlFile();
    (file.trigger_condition as any).period = 30;
    (file.trigger_condition as any).frequency = 15;
    const prefill = buildPrefillFromLibrary({ entry: entry(), file });
    expect(prefill.periodMinutes).toBe(30);
    expect(prefill.frequencyMinutes).toBe(15);
    expect(prefill.timezone).toBe("UTC");
  });

  // The drawer's tunables edit trigger_condition and hand the RESULT here as
  // `file`. Anything this adapter drops is tuning the user watched themselves
  // do and then never sees again — which is what made "Customize in editor"
  // open on a threshold of 3 for an alert whose file says 1.
  it("carries the whole trigger across, not just the window", () => {
    const prefill = buildPrefillFromLibrary({ entry: entry(), file: promqlFile() });
    expect(prefill.triggerThreshold).toBe(1);
    expect(prefill.triggerOperator).toBe(">=");
    expect(prefill.silenceMinutes).toBe(30);
  });

  it("carries a threshold the drawer tuned, not the form's default", () => {
    const file = promqlFile();
    (file.trigger_condition as any).threshold = 7;
    (file.trigger_condition as any).operator = ">";
    (file.trigger_condition as any).silence = 120;
    const prefill = buildPrefillFromLibrary({ entry: entry(), file });
    expect(prefill.triggerThreshold).toBe(7);
    expect(prefill.triggerOperator).toBe(">");
    expect(prefill.silenceMinutes).toBe(120);
  });

  it("leaves the trigger fields unset when the file has no trigger at all", () => {
    const prefill = buildPrefillFromLibrary({ entry: entry(), file: {} });
    expect(prefill.triggerThreshold).toBeUndefined();
    expect(prefill.triggerOperator).toBeUndefined();
    expect(prefill.silenceMinutes).toBeUndefined();
  });

  it("names the alert after the library alert, not after the surface", () => {
    const prefill = buildPrefillFromLibrary({ entry: entry(), file: promqlFile() });
    expect(prefill.name).toBe("go_gc_pause_high");
  });

  it("stamps provenance in meta, which the form never reads", () => {
    const prefill = buildPrefillFromLibrary({ entry: entry(), file: promqlFile() });
    expect(prefill.meta).toMatchObject({
      libraryId: "k8s/go_gc_pause_high",
      contentHash: "1c09e8f6ac33",
      pack: "k8s",
    });
  });

  it("never throws on a file that carries nothing at all", () => {
    expect(() =>
      buildPrefillFromLibrary({ entry: entry(), file: {} as AlertLibraryFile }),
    ).not.toThrow();
  });

  it("is pure — the same input yields an equal, independent object", () => {
    const input = { entry: entry(), file: promqlFile() };
    expect(buildPrefillFromLibrary(input)).toEqual(buildPrefillFromLibrary(input));
  });
});
