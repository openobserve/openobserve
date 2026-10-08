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
  expectedBounds: true,
};

// The order every scored column must share, so one bucket's columns all come from one row.
const SCORED_RANK =
  "CASE WHEN is_absence IS NOT TRUE AND is_partial_drop IS NOT TRUE THEN 1 ELSE 0 END";
const latest = (column: string) => `last_value(${column} ORDER BY ${SCORED_RANK}, created_at)`;

describe("buildAnomalyMetricQuery", () => {
  it("draws the metric and the flagged buckets as two separate series", () => {
    const sql = buildAnomalyMetricQuery("cfg1", "5m") as string;
    expect(sql).toContain("last_value(actual_value ORDER BY created_at) AS zo_sql_num");
    expect(sql).toContain(
      "CASE WHEN last_value(is_anomaly ORDER BY created_at) " +
        "THEN last_value(actual_value ORDER BY created_at) END AS anomaly_value",
    );
  });

  it("never maxes a column on its own, which would mix rows from different runs", () => {
    for (const sql of [
      buildAnomalyMetricQuery("cfg1", "5m") as string,
      buildAnomalyMetricQuery("cfg1", "5m", ALL_KINDS) as string,
    ]) {
      expect(sql).not.toContain("max(actual_value)");
      expect(sql).not.toContain("max(expected_");
      expect(sql).not.toContain("max(CASE WHEN is_anomaly");
    }
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
    expect(sql).toContain("last_value(score ORDER BY created_at) AS score_value");
    expect(sql).toContain("last_value(threshold_value ORDER BY created_at) AS threshold_value");
  });

  it("reads score and threshold from the same latest scored row, never an event sentinel", () => {
    // A retrain changes both; max() of each could pair an old score with a new threshold.
    const sql = buildAnomalyScoreQuery("cfg1", "5m", ALL_KINDS) as string;
    const guard = `CASE WHEN max(${SCORED_RANK}) = 1 THEN`;
    expect(sql).toContain(`${guard} ${latest("score")} END AS score_value`);
    expect(sql).toContain(`${guard} ${latest("threshold_value")} END AS threshold_value`);
    expect(sql).not.toContain("max(score)");
    expect(sql).not.toContain("max(threshold_value)");
  });

  it("returns null with no config id", () => {
    expect(buildAnomalyScoreQuery(undefined, "5m")).toBeNull();
  });
});

describe("buildAnomalyDeviationQuery", () => {
  it("keeps the legacy single series when the stream has no kind columns", () => {
    // A stream without the flag columns has never written a drop or absence
    // row, and referencing a column the stream lacks would fail the whole query.
    const sql = buildAnomalyDeviationQuery("cfg1", "5m") as string;
    expect(sql).toContain("last_value(deviation_percent ORDER BY created_at) AS deviation_value");
    expect(sql).not.toContain("is_absence");
    expect(sql).not.toContain("is_partial_drop");
    expect(sql).not.toContain("drop_value");
  });

  it("never folds score-space and value-space records into one max", () => {
    // deviation_percent is score-% for scored points but value-% for drops;
    // one max() over both picks whichever space happens to be larger.
    const sql = buildAnomalyDeviationQuery("cfg1", "5m", ALL_KINDS) as string;
    expect(sql).toContain(
      `CASE WHEN max(${SCORED_RANK}) = 1 THEN ${latest("deviation_percent")} END AS deviation_value`,
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
      expectedBounds: false,
    }) as string;
    expect(sql).toContain(
      "last_value(deviation_percent ORDER BY CASE WHEN is_absence IS NOT TRUE THEN 1 ELSE 0 END, " +
        "created_at) END AS deviation_value",
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
    expect(withExpected).toContain(`THEN ${latest("expected_value")} END AS expected_value`);

    const without = buildAnomalyMetricQuery("cfg1", "5m") as string;
    expect(without).not.toContain("expected_value");
  });
});

describe("expected band on the metric chart", () => {
  it("projects the bounds only when the stream carries them", () => {
    const withBounds = buildAnomalyMetricQuery("cfg1", "5m", ALL_KINDS) as string;
    expect(withBounds).toContain(`THEN ${latest("expected_lower")} END AS expected_lower`);
    expect(withBounds).toContain(`THEN ${latest("expected_upper")} END AS expected_upper`);

    const legacy = buildAnomalyMetricQuery("cfg1", "5m", {
      ...ALL_KINDS,
      expectedBounds: false,
    }) as string;
    expect(legacy).not.toContain("expected_lower");
    expect(legacy).not.toContain("expected_upper");
  });

  it("reads value, band, expected value and verdict from the same latest scored row", () => {
    const sql = buildAnomalyMetricQuery("cfg1", "5m", ALL_KINDS) as string;
    const picks = sql.match(/last_value\(\w+ ORDER BY [^)]*\)/g) ?? [];
    expect(picks.length).toBeGreaterThanOrEqual(6);
    for (const pick of picks) expect(pick).toContain(`ORDER BY ${SCORED_RANK}, created_at)`);
    for (const column of ["actual_value", "is_anomaly", "expected_value"]) {
      expect(sql).toContain(latest(column));
    }
  });

  it("keeps drop and absence rows out of the value, band and flag", () => {
    // An absence row stores actual_value 0; read as a value it draws a false zero.
    const sql = buildAnomalyMetricQuery("cfg1", "5m", ALL_KINDS) as string;
    const guard = `CASE WHEN max(${SCORED_RANK}) = 1 THEN`;
    expect(sql).toContain(`${guard} ${latest("actual_value")} END AS zo_sql_num`);
    expect(sql).toContain(`${guard} ${latest("expected_lower")} END AS expected_lower`);
    expect(sql).toContain(
      `CASE WHEN max(${SCORED_RANK}) = 1 AND ${latest("is_anomaly")} ` +
        `THEN ${latest("actual_value")} END AS anomaly_value`,
    );
  });

  it("orders by created_at alone when the stream has no kind columns", () => {
    const sql = buildAnomalyMetricQuery("cfg1", "5m") as string;
    expect(sql).not.toContain("is_absence");
    expect(sql).not.toContain("event_value");
    expect(sql).not.toContain("max(CASE");
  });

  it("carries drop and absence rows as their own event column", () => {
    const sql = buildAnomalyMetricQuery("cfg1", "5m", ALL_KINDS) as string;
    expect(sql).toContain(
      "max(CASE WHEN is_absence IS TRUE OR is_partial_drop IS TRUE THEN actual_value END) " +
        "AS event_value",
    );
    const dropOnly = buildAnomalyMetricQuery("cfg1", "5m", {
      ...ALL_KINDS,
      isAbsence: false,
    }) as string;
    expect(dropOnly).toContain(
      "max(CASE WHEN is_partial_drop IS TRUE THEN actual_value END) AS event_value",
    );
    expect(dropOnly).toContain(
      "last_value(actual_value ORDER BY CASE WHEN is_partial_drop IS NOT TRUE THEN 1 ELSE 0 END, created_at)",
    );
    expect(dropOnly).not.toContain("is_absence");
  });
});

describe("band k on the metric chart", () => {
  it("reads k from the same latest scored row as the band, never from an event row", () => {
    const sql = buildAnomalyMetricQuery("cfg1", "5m", ALL_KINDS) as string;
    expect(sql).toContain(
      `CASE WHEN max(${SCORED_RANK}) = 1 THEN ${latest("threshold_value")} END AS threshold_value`,
    );
    expect(buildAnomalyMetricQuery("cfg1", "5m")).toContain(
      "last_value(threshold_value ORDER BY created_at) AS threshold_value",
    );
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
