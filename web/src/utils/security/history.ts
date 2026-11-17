// Copyright 2026 OpenObserve Inc.

import { isFiringOutcome } from "@/utils/alerts/runOutcome";

export interface HistoryRow {
  timestamp: number;
  alert_name: string;
  /** Present on servers that return it; preferred over the name, which is not unique. */
  alert_id?: string;
  /** Normalised server-side: firing | normal | succeeded | error | skipped | notify_failed. */
  status: string;
  level: string;
  actual_value: number | null;
  threshold_operator: string | null;
  start_time: number;
  end_time: number;
  error: string | null;
  is_silenced: boolean;
  evaluation_took_in_secs: number | null;
}

/** Reads the server-normalised status (`notify_failed` counts); `level`/`actual_value` are not a verdict. */
export const isFiring = (row: HistoryRow): boolean => isFiringOutcome(row.status);

/** Bucket width for a window, picked so a chart shows roughly 24–60 bars. */
export function bucketMsFor(windowMs: number): number {
  const HOUR = 3_600_000;
  if (windowMs <= HOUR) return 2 * 60_000;
  if (windowMs <= 6 * HOUR) return 10 * 60_000;
  if (windowMs <= 24 * HOUR) return HOUR;
  if (windowMs <= 7 * 24 * HOUR) return 6 * HOUR;
  return 24 * HOUR;
}

/** Empty buckets are kept as zeros so the time axis has no gaps. */
export function bucketize<K extends string>(
  items: { timeMs: number; key: K }[],
  startMs: number,
  endMs: number,
  bucketMs: number,
  keys: readonly K[],
): { ts: number; counts: Record<K, number> }[] {
  const first = Math.floor(startMs / bucketMs) * bucketMs;
  const buckets: { ts: number; counts: Record<K, number> }[] = [];
  for (let ts = first; ts < endMs; ts += bucketMs) {
    buckets.push({
      ts,
      counts: Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>,
    });
  }
  for (const item of items) {
    const index = Math.floor((item.timeMs - first) / bucketMs);
    const bucket = buckets[index];
    if (bucket && item.key in bucket.counts) bucket.counts[item.key] += 1;
  }
  return buckets;
}
