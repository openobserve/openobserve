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
import { buildHistoryEntry, historyEntryToLoad, pickerSavedDate } from "./queryHistory";
import { decodeMetricsConfig } from "@/composables/metrics/metricsUrlState";

const panel = (overrides: Record<string, any> = {}) => ({
  data: {
    id: "p1",
    title: "t",
    type: "bar",
    queryType: "promql",
    config: { step_value: "30s" },
    queries: [
      { query: "up", fields: {} },
      { query: "rate(x[5m])", fields: {} },
      { query: "  ", fields: {} },
    ],
    ...overrides,
  },
  layout: { hiddenQueries: [] as number[] },
});

describe("query history entries", () => {
  it("joins the visible, non-empty queries with a newline", () => {
    const entry = buildHistoryEntry(panel(), { valueType: "relative", relativeTimePeriod: "1h" });
    expect(entry?.query).toBe("up\nrate(x[5m])");
  });

  it("leaves hidden queries out of the text", () => {
    const p = panel();
    p.layout.hiddenQueries = [0];
    expect(buildHistoryEntry(p, { valueType: "relative", relativeTimePeriod: "1h" })?.query).toBe(
      "rate(x[5m])",
    );
  });

  it("returns nothing when there is no query text", () => {
    const p = panel({ queries: [{ query: "" }] });
    expect(buildHistoryEntry(p, { valueType: "relative", relativeTimePeriod: "1h" })).toBeNull();
  });

  it("records the time range, step, chart type and the panel blob", () => {
    const entry = buildHistoryEntry(panel(), {
      valueType: "absolute",
      startTime: 1000,
      endTime: 2000,
      relativeTimePeriod: "15m",
    });
    expect(entry?.context.time_range).toEqual({ from: 1000, to: 2000 });
    expect(entry?.context.step).toBe("30s");
    expect(entry?.context.chart_type).toBe("bar");
    const blob = decodeMetricsConfig(entry?.context.metrics_data);
    expect(blob?.data.type).toBe("bar");
    expect(blob?.data.queries[1].query).toBe("rate(x[5m])");
  });

  it("restores the panel blob and the picker range from an entry", () => {
    const entry = buildHistoryEntry(panel(), { valueType: "relative", relativeTimePeriod: "6h" });
    const loaded = historyEntryToLoad(entry!.context);
    expect(loaded?.metricsData).toBe(entry!.context.metrics_data);
    expect(loaded?.timeRange).toMatchObject({ valueType: "relative", relativeTimePeriod: "6h" });
  });

  it("returns null for a context without a panel blob", () => {
    expect(historyEntryToLoad({})).toBeNull();
    expect(historyEntryToLoad(null)).toBeNull();
  });

  it("converts a picker model into the picker's setSavedDate shape", () => {
    expect(
      pickerSavedDate({
        valueType: "relative",
        relativeTimePeriod: "6h",
        startTime: null,
        endTime: null,
      }),
    ).toEqual({ type: "relative", relativeTimePeriod: "6h" });
    expect(
      pickerSavedDate({
        valueType: "absolute",
        relativeTimePeriod: "15m",
        startTime: "1000",
        endTime: "2000",
      }),
    ).toEqual({ type: "absolute", startTime: 1000, endTime: 2000 });
  });
});
