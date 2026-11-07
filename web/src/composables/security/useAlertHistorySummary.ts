// Copyright 2026 OpenObserve Inc.

import { ref, shallowRef } from "vue";

import alertsService from "@/services/alerts";
import { isErrorOutcome, isFiringOutcome } from "@/utils/alerts/runOutcome";

/** Above this many ids the filter moves client-side; a longer URL risks proxy limits. */
export const MAX_URL_ALERT_IDS = 200;

export interface SummaryRow {
  /** Bucket start, epoch milliseconds. */
  bucketMs: number;
  alertId: string;
  outcome: string;
  n: number;
  /** Evaluations that ran while the alert was silenced. */
  silenced: number;
}

export interface SummaryLoadOptions {
  /** Only these alerts; an empty list loads nothing. */
  alertIds?: string[];
  /** Requested bucket width; the server widens it for long windows. */
  bucketMs?: number;
}

export interface AlertCounts {
  firings: number;
  errors: number;
  evaluations: number;
  lastFiringMs: number | null;
}

/** Per-alert firing, error and evaluation totals. */
export function countsByAlert(rows: SummaryRow[]): Map<string, AlertCounts> {
  const out = new Map<string, AlertCounts>();
  for (const row of rows) {
    const c = out.get(row.alertId) ?? { firings: 0, errors: 0, evaluations: 0, lastFiringMs: null };
    c.evaluations += row.n;
    if (isFiringOutcome(row.outcome)) {
      c.firings += row.n;
      c.lastFiringMs = Math.max(c.lastFiringMs ?? 0, row.bucketMs);
    } else if (isErrorOutcome(row.outcome)) {
      c.errors += row.n;
    }
    out.set(row.alertId, c);
  }
  return out;
}

/** Normalises the API payload; rows with an unusable bucket are dropped. */
export function parseSummaryRows(raw: unknown): SummaryRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row: any) => {
    const bucket = Number(row?.bucket);
    if (!Number.isFinite(bucket)) return [];
    return [
      {
        bucketMs: Math.floor(bucket / 1000),
        alertId: String(row?.alert_id ?? ""),
        outcome: String(row?.outcome ?? "unknown"),
        n: Number(row?.n) || 0,
        silenced: Number(row?.silenced) || 0,
      },
    ];
  });
}

export function useAlertHistorySummary() {
  const rows = shallowRef<SummaryRow[]>([]);
  const total = ref(0);
  /** Bucket width the server actually used, ms. */
  const bucketMs = ref(0);
  /** The server hit its row cap; counts are a lower bound. */
  const partial = ref(false);
  /** Start the server actually used, when the triggers stream's max_query_range narrowed it. */
  const effectiveStartMs = ref<number | null>(null);
  const loading = ref(false);
  const error = ref("");
  let seq = 0;

  async function load(
    orgId: string,
    startMs: number,
    endMs: number,
    options: SummaryLoadOptions = {},
  ) {
    if (!orgId) return;
    const mine = ++seq;
    if (options.alertIds && !options.alertIds.length) {
      rows.value = [];
      total.value = 0;
      bucketMs.value = 0;
      partial.value = false;
      effectiveStartMs.value = null;
      error.value = "";
      loading.value = false;
      return;
    }
    loading.value = true;
    error.value = "";
    const serverIds =
      options.alertIds && options.alertIds.length <= MAX_URL_ALERT_IDS ? options.alertIds : null;
    try {
      const res = await alertsService.getHistorySummary(orgId, {
        start_time: startMs * 1000,
        end_time: endMs * 1000,
        ...(options.bucketMs ? { interval: Math.max(1, Math.round(options.bucketMs / 1000)) } : {}),
        ...(serverIds ? { alert_ids: serverIds.join(",") } : {}),
        // Too many ids for a URL: the server narrows to SIEM detections, the client to the exact set.
        ...(options.alertIds && !serverIds ? { siem: true } : {}),
      });
      if (mine !== seq) return;
      const parsed = parseSummaryRows(res.data?.rows);
      const wanted = options.alertIds && !serverIds ? new Set(options.alertIds) : null;
      rows.value = wanted ? parsed.filter((row) => wanted.has(row.alertId)) : parsed;
      total.value = wanted
        ? rows.value.reduce((sum, row) => sum + row.n, 0)
        : Number(res.data?.total ?? 0);
      bucketMs.value = Number(res.data?.interval ?? 0) * 1000;
      partial.value = !!res.data?.is_partial;
      const usedStartMs = Math.floor(Number(res.data?.start_time ?? 0) / 1000);
      effectiveStartMs.value = usedStartMs > startMs ? usedStartMs : null;
    } catch (e: any) {
      if (mine !== seq) return;
      rows.value = [];
      total.value = 0;
      partial.value = false;
      effectiveStartMs.value = null;
      error.value = e?.response?.data?.message ?? e?.message ?? "";
    } finally {
      if (mine === seq) loading.value = false;
    }
  }

  return { rows, total, bucketMs, partial, effectiveStartMs, loading, error, load };
}
