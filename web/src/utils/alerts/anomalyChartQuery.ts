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
export const ANOMALY_DROP_ALIAS = "drop_value";
export const ANOMALY_EXPECTED_ALIAS = "expected_value";

/** Opt-in per-kind columns: referencing one the stream never saw fails the whole query, and its absence proves no such record exists. */
export interface AnomalyKindColumns {
  isAbsence: boolean;
  isPartialDrop: boolean;
  expectedValue: boolean;
}

export const NO_KIND_COLUMNS: AnomalyKindColumns = {
  isAbsence: false,
  isPartialDrop: false,
  expectedValue: false,
};

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
export function buildAnomalyMetricQuery(
  anomalyId?: string,
  interval?: string,
  kinds: AnomalyKindColumns = NO_KIND_COLUMNS,
): string | null {
  // Older records carry no expected_value; max() over NULLs gaps the line there.
  const expected = kinds.expectedValue ? `, max(expected_value) AS ${ANOMALY_EXPECTED_ALIAS}` : "";
  return buildQuery(
    anomalyId,
    interval,
    `max(actual_value) AS ${ANOMALY_VALUE_ALIAS}, ` +
      `CASE WHEN max(CASE WHEN is_anomaly THEN 1 ELSE 0 END) = 1 ` +
      `THEN max(actual_value) END AS ${ANOMALY_FLAGGED_ALIAS}` +
      expected,
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

/** Bars, not a line: the writer zero-fills non-anomalous buckets, and a line through that baseline would imply a trend. */
export function buildAnomalyDeviationQuery(
  anomalyId?: string,
  interval?: string,
  kinds: AnomalyKindColumns = NO_KIND_COLUMNS,
): string | null {
  // deviation_percent lives in a different space per kind, so kinds never share one max(); absence is a sentinel, excluded.
  const scoredOnly = [
    ...(kinds.isAbsence ? ["is_absence IS NOT TRUE"] : []),
    ...(kinds.isPartialDrop ? ["is_partial_drop IS NOT TRUE"] : []),
  ];
  // IS NOT TRUE keeps flag-less legacy rows (all score-space) in the scored series.
  const scored = scoredOnly.length
    ? `max(CASE WHEN ${scoredOnly.join(" AND ")} THEN deviation_percent END) ` +
      `AS ${ANOMALY_DEVIATION_ALIAS}`
    : `max(deviation_percent) AS ${ANOMALY_DEVIATION_ALIAS}`;
  const drop = kinds.isPartialDrop
    ? `, max(CASE WHEN is_partial_drop IS TRUE THEN deviation_percent END) AS ${ANOMALY_DROP_ALIAS}`
    : "";
  return buildQuery(anomalyId, interval, scored + drop);
}
