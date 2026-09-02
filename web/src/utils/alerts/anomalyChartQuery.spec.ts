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

import {
  buildAnomalyDeviationQuery,
  buildAnomalyMetricQuery,
  buildAnomalyScoreQuery,
} from "@/utils/alerts/anomalyChartQuery";

describe("buildAnomalyMetricQuery", () => {
  it("draws the metric and the flagged buckets as two separate series", () => {
    const sql = buildAnomalyMetricQuery("cfg1", "5m") as string;
    expect(sql).toContain("max(actual_value) AS zo_sql_num");
    expect(sql).toContain(
      "CASE WHEN max(CASE WHEN is_anomaly THEN 1 ELSE 0 END) = 1 " +
        "THEN max(actual_value) END AS anomaly_value",
    );
  });

  it("plots the overlay at the metric's own value, not the flagged rows' max", () => {
    // Maxing actual_value over the flagged rows alone reads a DIFFERENT row
    // whenever a bucket holds several, and draws the overlay below the line it
    // is marking — which is what it looked like on screen.
    const sql = buildAnomalyMetricQuery("cfg1", "5m") as string;
    expect(sql).not.toContain("max(CASE WHEN is_anomaly THEN actual_value END)");
    // Both series read the same aggregate, so red can only ever land on blue.
    expect(sql.match(/max\(actual_value\)/g)).toHaveLength(2);
  });

  it("scopes to the one config and reads the anomalies stream", () => {
    const sql = buildAnomalyMetricQuery("cfg1", "5m") as string;
    expect(sql).toContain('FROM "_anomalies"');
    expect(sql).toContain("WHERE anomaly_id = 'cfg1'");
  });

  it("buckets at the config's own detection resolution", () => {
    expect(buildAnomalyMetricQuery("cfg1", "5m")).toContain("histogram(_timestamp, '5m')");
    expect(buildAnomalyMetricQuery("cfg1", "1h")).toContain("histogram(_timestamp, '1h')");
  });

  it("falls back to the auto width rather than interpolating an unknown interval", () => {
    // The interval reaches here from an API response, so a value that is not
    // histogram()'s grammar must never be pasted into the query.
    const sql = buildAnomalyMetricQuery("cfg1", "5 minutes; DROP") as string;
    expect(sql).toContain("histogram(_timestamp) AS zo_sql_key");
    expect(sql).not.toContain("DROP");
  });

  it("escapes a quote in the config id", () => {
    expect(buildAnomalyMetricQuery("a'b", "5m")).toContain("anomaly_id = 'a''b'");
  });

  it("returns null with no config id, rather than charting every config in the org", () => {
    expect(buildAnomalyMetricQuery("", "5m")).toBeNull();
    expect(buildAnomalyMetricQuery(undefined, "5m")).toBeNull();
    expect(buildAnomalyMetricQuery("   ", "5m")).toBeNull();
  });
});

describe("buildAnomalyScoreQuery", () => {
  it("projects the score against the threshold that judged it", () => {
    const sql = buildAnomalyScoreQuery("cfg1", "5m") as string;
    expect(sql).toContain("max(score) AS score_value");
    expect(sql).toContain("max(threshold_value) AS threshold_value");
  });

  it("returns null with no config id", () => {
    expect(buildAnomalyScoreQuery(undefined, "5m")).toBeNull();
  });
});

describe("buildAnomalyDeviationQuery", () => {
  it("projects the per-bucket overshoot", () => {
    expect(buildAnomalyDeviationQuery("cfg1", "5m")).toContain(
      "max(deviation_percent) AS deviation_value",
    );
  });

  it("returns null with no config id", () => {
    expect(buildAnomalyDeviationQuery(undefined, "5m")).toBeNull();
  });
});

describe("bucket aggregation", () => {
  it("groups and orders by the time bucket, so a re-scored bucket draws once", () => {
    // Detection windows overlap: a bucket near a run boundary is scored again
    // by the next run, and reading the rows raw would draw it twice.
    for (const sql of [
      buildAnomalyMetricQuery("cfg1", "5m"),
      buildAnomalyScoreQuery("cfg1", "5m"),
      buildAnomalyDeviationQuery("cfg1", "5m"),
    ]) {
      expect(sql).toContain("GROUP BY zo_sql_key ORDER BY zo_sql_key");
    }
  });
});
