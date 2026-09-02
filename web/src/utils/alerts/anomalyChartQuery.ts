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

// Chart queries over `_anomalies`, where every detection run writes one row per
// scored bucket — the only record an anomaly config has, since it carries no
// `query_condition` for the generic evaluation chart to build SQL from.
//
// All three re-bucket and aggregate because detection windows OVERLAP: a bucket
// near a run boundary is re-scored by the next run, and read raw it draws twice.

/** The reserved stream detection results are written to. */
export const ANOMALY_STREAM = "_anomalies";

/** The x-axis alias the panel renderer binds a time axis to. */
export const ANOMALY_X_ALIAS = "zo_sql_key";

/** Series aliases, one per line the three charts draw. */
export const ANOMALY_VALUE_ALIAS = "zo_sql_num";
export const ANOMALY_FLAGGED_ALIAS = "anomaly_value";
export const ANOMALY_SCORE_ALIAS = "score_value";
export const ANOMALY_THRESHOLD_ALIAS = "threshold_value";
export const ANOMALY_DEVIATION_ALIAS = "deviation_value";

/** `histogram()`'s interval grammar, as the config stores it ("5m", "1h"). */
const INTERVAL_PATTERN = /^\d+[smhd]$/;

/** The id arrives from an API response, not a validated route — never raw. */
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** One chart point per scored point; an unrecognised interval is never
 *  interpolated into the query, it falls back to the auto width. */
function bucketExpr(interval?: string): string {
  const trimmed = interval?.trim();
  return trimmed && INTERVAL_PATTERN.test(trimmed)
    ? `histogram(_timestamp, '${trimmed}')`
    : "histogram(_timestamp)";
}

/** `null` with no config id — better no chart than every config in the org. */
function buildQuery(
  anomalyId: string | undefined,
  interval: string | undefined,
  projection: string,
) {
  const id = anomalyId?.trim();
  if (!id) return null;
  return (
    `SELECT ${bucketExpr(interval)} AS ${ANOMALY_X_ALIAS}, ${projection} ` +
    `FROM "${ANOMALY_STREAM}" WHERE anomaly_id = ${quoteLiteral(id)} ` +
    `GROUP BY ${ANOMALY_X_ALIAS} ORDER BY ${ANOMALY_X_ALIAS}`
  );
}

/** The metric, plus a second series carrying only the flagged buckets — the
 *  renderer colours a line per SERIES and cannot colour a segment, so the
 *  flagged stretches have to be their own null-gapped line.
 *
 *  The flag gates the BUCKET and the value stays `max(actual_value)`, so red
 *  lands exactly on blue. Maxing `actual_value` over the flagged rows alone
 *  reads a different row whenever a bucket holds several — one flagged, one
 *  not — and plots the overlay BELOW the metric it is supposed to mark. */
export function buildAnomalyMetricQuery(anomalyId?: string, interval?: string): string | null {
  return buildQuery(
    anomalyId,
    interval,
    `max(actual_value) AS ${ANOMALY_VALUE_ALIAS}, ` +
      `CASE WHEN max(CASE WHEN is_anomaly THEN 1 ELSE 0 END) = 1 ` +
      `THEN max(actual_value) END AS ${ANOMALY_FLAGGED_ALIAS}`,
  );
}

/** The threshold is a SERIES, not a mark line: it steps when the config
 *  retrains, and a mark line would draw today's value over scores it never judged. */
export function buildAnomalyScoreQuery(anomalyId?: string, interval?: string): string | null {
  return buildQuery(
    anomalyId,
    interval,
    `max(score) AS ${ANOMALY_SCORE_ALIAS}, ` + `max(threshold_value) AS ${ANOMALY_THRESHOLD_ALIAS}`,
  );
}

/** Bars, not a line: the writer stores zero for every non-anomalous bucket, so
 *  a line through the flat baseline would imply a trend that is not there. */
export function buildAnomalyDeviationQuery(anomalyId?: string, interval?: string): string | null {
  return buildQuery(anomalyId, interval, `max(deviation_percent) AS ${ANOMALY_DEVIATION_ALIAS}`);
}
