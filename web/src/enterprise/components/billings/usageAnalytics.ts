// Pure SQL/aggregation helpers for the Usage Analytics view.
// The time window is applied by the search request's start_time/end_time,
// not inside these SQL strings.

const USAGE_STREAM = "usage";
const INGESTION_FILTER = "event = 'Ingestion'";

export function buildLast24hSql(): string {
  return `SELECT SUM(size) AS total_mb FROM "${USAGE_STREAM}" WHERE ${INGESTION_FILTER}`;
}

// usage stream 'size' field is in MB; mbToDisplay divides by 1024 for GB.
export function buildPerStreamSql(): string {
  return (
    `SELECT stream_name, SUM(size) AS total_mb, SUM(num_records) AS records, ` +
    `COUNT(DISTINCT concat(year, month, day)) AS days ` +
    `FROM "${USAGE_STREAM}" WHERE ${INGESTION_FILTER} ` +
    `GROUP BY stream_name ORDER BY total_mb DESC`
  );
}

export function buildDailyTrendSql(): string {
  return (
    `SELECT concat(year, '-', month, '-', day) AS day, SUM(size) AS total_mb ` +
    `FROM "${USAGE_STREAM}" WHERE ${INGESTION_FILTER} ` +
    `GROUP BY day ORDER BY day`
  );
}

export function buildPerStreamDailySql(): string {
  return (
    `SELECT stream_name, concat(year, '-', month, '-', day) AS day, SUM(size) AS total_mb ` +
    `FROM "${USAGE_STREAM}" WHERE ${INGESTION_FILTER} ` +
    `GROUP BY stream_name, day ORDER BY stream_name, day`
  );
}

export function mbToDisplay(mb: number, unit: "gb" | "mb"): number {
  const value = unit === "gb" ? (mb || 0) / 1024 : mb || 0;
  return Math.round(value * 100) / 100;
}

export function distinctDays(rows: { day: string }[]): number {
  return new Set(rows.map((r) => r.day)).size;
}
