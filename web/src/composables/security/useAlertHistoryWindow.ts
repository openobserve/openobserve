// Copyright 2026 OpenObserve Inc.
//
// useAlertHistoryWindow.ts — paged alert history for a window (1000 rows/page, deduped);
// `effectiveStartMs` flags a start narrowed by the triggers stream's own max_query_range.

import { computed, ref, shallowRef } from "vue";

import alertsService from "@/services/alerts";
import streamService from "@/services/stream";
import type { HistoryRow } from "@/utils/security/history";

const PAGE = 1000;
const DEFAULT_MAX_PAGES = 5;
const TRIGGERS_STREAM = "triggers";

export interface HistoryLoadOptions {
  /** Only this alert's evaluations (the API's alert_id filter). */
  alertId?: string;
  maxPages?: number;
}

/** Identity of one evaluation row, for deduplicating across unstable pages. */
export const historyRowKey = (row: HistoryRow) =>
  `${row.timestamp}|${row.alert_name}|${row.start_time}|${row.end_time}|${row.status}`;

export function dedupeHistory(rows: HistoryRow[]): HistoryRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = historyRowKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Whether `pages` pages of PAGE rows can hold `total` rows. */
export const isComplete = (total: number, pages: number) => total <= pages * PAGE;

/** Fetches every page (up to `maxPages`) of history for one window. */
export async function fetchHistoryWindow(
  orgId: string,
  startMs: number,
  endMs: number,
  options: HistoryLoadOptions = {},
): Promise<{ rows: HistoryRow[]; total: number; complete: boolean }> {
  const page = (from: number) =>
    alertsService.getHistory(orgId, {
      start_time: String(startMs * 1000),
      end_time: String(endMs * 1000),
      from: String(from),
      size: String(PAGE),
      sort_by: "timestamp",
      sort_order: "desc",
      ...(options.alertId ? { alert_id: options.alertId } : {}),
    });
  const first = await page(0);
  const total = Number(first.data?.total ?? 0);
  const pages = Math.min(Math.ceil(total / PAGE), options.maxPages ?? DEFAULT_MAX_PAGES);
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) => page((i + 1) * PAGE)),
  );
  return {
    rows: dedupeHistory([first, ...rest].flatMap((res) => res.data?.hits ?? [])),
    total,
    // Judged by pages, not rows: the server counts rows it later drops and
    // dedupe can remove a repeat, so rows < total does not mean rows are missing.
    complete: isComplete(total, Math.max(1, pages)),
  };
}

/** The triggers stream's own max_query_range in hours; 0 when unset or unreadable. */
async function triggersMaxRangeHours(orgId: string): Promise<number> {
  try {
    const res = await streamService.schema(orgId, TRIGGERS_STREAM, "logs");
    const hours = Number(res.data?.settings?.max_query_range ?? 0);
    return Number.isFinite(hours) && hours > 0 ? hours : 0;
  } catch {
    return 0;
  }
}

export function useAlertHistoryWindow() {
  const rows = shallowRef<HistoryRow[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const error = ref("");
  /** Start the server actually used, when its stream setting narrowed the window. */
  const effectiveStartMs = ref<number | null>(null);
  let seq = 0;

  const complete = ref(true);
  const capped = computed(() => !complete.value);

  async function load(
    orgId: string,
    startMs: number,
    endMs: number,
    options: HistoryLoadOptions = {},
  ) {
    if (!orgId) return;
    const mine = ++seq;
    loading.value = true;
    error.value = "";
    try {
      const [result, rangeHours] = await Promise.all([
        fetchHistoryWindow(orgId, startMs, endMs, options),
        triggersMaxRangeHours(orgId),
      ]);
      if (mine !== seq) return;
      rows.value = result.rows;
      total.value = result.total;
      complete.value = result.complete;
      const floor = rangeHours ? endMs - rangeHours * 3_600_000 : null;
      effectiveStartMs.value = floor !== null && floor > startMs ? floor : null;
    } catch (e: any) {
      if (mine !== seq) return;
      rows.value = [];
      total.value = 0;
      complete.value = true;
      effectiveStartMs.value = null;
      error.value = e?.response?.data?.message ?? e?.message ?? "";
    } finally {
      if (mine === seq) loading.value = false;
    }
  }

  return { rows, total, capped, loading, error, effectiveStartMs, load };
}
