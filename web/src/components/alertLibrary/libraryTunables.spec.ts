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

import { DEFAULT_TUNABLES, coerceTunable, readTunables } from "./libraryTunables";
import type { AlertLibraryFile } from "@/types/alertLibrary";

// Trimmed from the real library files (verified against the live bucket).
const promqlFile = (): AlertLibraryFile => ({
  stream_name: "go_gc_duration_seconds_sum",
  stream_type: "metrics",
  query_condition: {
    type: "promql",
    sql: null,
    promql: "rate(go_gc_duration_seconds_sum[5m])",
    promql_condition: { column: "value", operator: ">", value: 100, ignore_case: false },
  },
  trigger_condition: {
    period: 5,
    operator: ">=",
    threshold: 1,
    frequency: 5,
    silence: 30,
    frequency_type: "minutes",
    timezone: "UTC",
  },
});

const sqlFile = (): AlertLibraryFile => ({
  stream_name: "k8s_events",
  stream_type: "logs",
  query_condition: {
    type: "sql",
    sql: 'SELECT count(*) as event_count FROM "k8s_events" GROUP BY k8s_cluster HAVING event_count > 12',
    promql: null,
    promql_condition: null,
  },
  trigger_condition: {
    period: 5,
    operator: ">=",
    threshold: 1,
    frequency: 5,
    silence: 120,
  },
});

describe("readTunables", () => {
  it("lifts the four structured trigger fields every alert carries", () => {
    expect(readTunables(sqlFile())).toMatchObject({
      threshold: 1,
      period: 5,
      frequency: 5,
      silence: 120,
    });
  });

  it("lifts the PromQL threshold that lives BESIDE the query", () => {
    const tunables = readTunables(promqlFile());
    expect(tunables.promqlOperator).toBe(">");
    expect(tunables.promqlValue).toBe(100);
  });

  it("reports no promql condition for a SQL alert, so the row is not offered", () => {
    const tunables = readTunables(sqlFile());
    expect(tunables.promqlOperator).toBeNull();
    expect(tunables.promqlValue).toBeNull();
  });

  it("falls back to the alert form's own defaults, never to zero", () => {
    // A blank field must not silently become "evaluate over 0 minutes".
    expect(readTunables({})).toEqual(DEFAULT_TUNABLES);
  });

  it("ignores non-numeric values from the fetched file", () => {
    const file = { trigger_condition: { period: "soon", threshold: null, silence: 7 } };
    const tunables = readTunables(file as AlertLibraryFile);
    expect(tunables.period).toBe(DEFAULT_TUNABLES.period);
    expect(tunables.threshold).toBe(DEFAULT_TUNABLES.threshold);
    expect(tunables.silence).toBe(7);
  });

  it("survives a file whose query_condition is missing entirely", () => {
    expect(() => readTunables({ trigger_condition: {} } as AlertLibraryFile)).not.toThrow();
  });
});

describe("coerceTunable", () => {
  it("parses what a number input actually emits — a string", () => {
    expect(coerceTunable("period", "15")).toBe(15);
    expect(coerceTunable("promqlValue", "0.75")).toBe(0.75);
  });

  it("floors a CLEARED field at 1 instead of letting it read as zero", () => {
    // OInput emits "" on clear, and Number("") is 0 — an alert that evaluates
    // over 0 minutes, or every 0 minutes, can never fire.
    expect(coerceTunable("period", "")).toBe(1);
    expect(coerceTunable("frequency", "")).toBe(1);
    expect(coerceTunable("threshold", "")).toBe(1);
  });

  it("mirrors the alert form's own validation floors", () => {
    // AlertSettings.schema: period ≥ 1; QueryConfig.schema: threshold ≥ 1,
    // frequency ≥ 1; AddAlert.schema: silence ≥ 0.
    expect(coerceTunable("period", -5)).toBe(1);
    expect(coerceTunable("threshold", 0)).toBe(1);
    expect(coerceTunable("frequency", 0)).toBe(1);
    expect(coerceTunable("silence", 0)).toBe(0);
    expect(coerceTunable("silence", -3)).toBe(0);
  });

  it("leaves the PromQL threshold unfloored — a metric value may be zero or negative", () => {
    expect(coerceTunable("promqlValue", 0)).toBe(0);
    expect(coerceTunable("promqlValue", -12.5)).toBe(-12.5);
  });

  it("falls back rather than propagating NaN from unparseable text", () => {
    expect(coerceTunable("period", "soon")).toBe(1);
    expect(coerceTunable("promqlValue", "soon")).toBe(0);
  });

  it("does not invent a promql threshold from an EMPTY promql_condition", () => {
    const file = {
      query_condition: { type: "promql", promql: "up", promql_condition: {} },
    } as unknown as AlertLibraryFile;

    expect(readTunables(file).promqlOperator).toBeNull();
  });

  it("floors numbers that came from the FILE, not just numbers the user typed", () => {
    // A published period of 0 means "look at 0 minutes of data" and threshold 0
    // fires every evaluation. Both used to reach install untouched, because the
    // floors were applied only on the edit path.
    const file = {
      trigger_condition: { period: 0, frequency: 0, threshold: 0, silence: -5 },
    } as unknown as AlertLibraryFile;

    const tunables = readTunables(file);
    expect(tunables.period).toBe(1);
    expect(tunables.frequency).toBe(1);
    expect(tunables.threshold).toBe(1);
    expect(tunables.silence).toBe(0);
  });
});
