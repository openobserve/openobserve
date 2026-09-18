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
  type AnomalyKindColumns,
} from "@/utils/alerts/anomalyChartQuery";

const ALL_KINDS: AnomalyKindColumns = {
  isAbsence: true,
  isPartialDrop: true,
  expectedValue: true,
};

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
  it("keeps the legacy single series when the stream has no kind columns", () => {
    // A stream without the flag columns has never written a drop or absence
    // row, so every record is score-space and the plain max is exact — and
    // referencing a column the stream lacks would fail the whole query.
    const sql = buildAnomalyDeviationQuery("cfg1", "5m") as string;
    expect(sql).toContain("max(deviation_percent) AS deviation_value");
    expect(sql).not.toContain("is_absence");
    expect(sql).not.toContain("is_partial_drop");
    expect(sql).not.toContain("drop_value");
  });

  it("never folds score-space and value-space records into one max", () => {
    // deviation_percent is score-% for scored points but value-% for drops;
    // one max() over both picks whichever space happens to be larger.
    const sql = buildAnomalyDeviationQuery("cfg1", "5m", ALL_KINDS) as string;
    expect(sql).toContain(
      "max(CASE WHEN is_absence IS NOT TRUE AND is_partial_drop IS NOT TRUE " +
        "THEN deviation_percent END) AS deviation_value",
    );
    expect(sql).toContain(
      "max(CASE WHEN is_partial_drop IS TRUE THEN deviation_percent END) AS drop_value",
    );
    expect(sql).not.toContain("max(deviation_percent)");
  });

  it("excludes absence rows from every series — their 100.0 is a sentinel, not a measurement", () => {
    const sql = buildAnomalyDeviationQuery("cfg1", "5m", ALL_KINDS) as string;
    expect(sql).toContain("is_absence IS NOT TRUE");
    expect(sql).not.toContain("is_absence IS TRUE");
  });

  it("tolerates legacy rows where the flags are NULL — they stay in the scored series", () => {
    // Records written before the flags existed deserialize with no flag at
    // all; `IS NOT TRUE` is the null-tolerant form (`= false` drops them).
    const sql = buildAnomalyDeviationQuery("cfg1", "5m", ALL_KINDS) as string;
    expect(sql).not.toContain("= false");
    expect(sql).not.toContain("= FALSE");
  });

  it("splits per column independently when only one kind column exists", () => {
    const sql = buildAnomalyDeviationQuery("cfg1", "5m", {
      isAbsence: true,
      isPartialDrop: false,
      expectedValue: false,
    }) as string;
    expect(sql).toContain(
      "max(CASE WHEN is_absence IS NOT TRUE THEN deviation_percent END) AS deviation_value",
    );
    expect(sql).not.toContain("is_partial_drop");
    expect(sql).not.toContain("drop_value");
  });

  it("returns null with no config id", () => {
    expect(buildAnomalyDeviationQuery(undefined, "5m")).toBeNull();
  });
});

describe("expected-value series on the metric chart", () => {
  it("adds the expected series only when the stream carries the column", () => {
    const withExpected = buildAnomalyMetricQuery("cfg1", "5m", ALL_KINDS) as string;
    expect(withExpected).toContain("max(expected_value) AS expected_value");

    const without = buildAnomalyMetricQuery("cfg1", "5m") as string;
    expect(without).not.toContain("expected_value");
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
