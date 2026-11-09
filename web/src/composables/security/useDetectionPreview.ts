// Copyright 2026 OpenObserve Inc.

// Runs a draft detection's SQL before it is saved: a preview of matches (24h, or a correlation's timespan), and a short check that it plans.
import { ref, shallowRef } from "vue";

import searchService from "@/services/search";

export const PREVIEW_WINDOW_MS = 24 * 60 * 60 * 1000;
export const PREVIEW_ROWS = 20;
/** Planning errors surface whatever the range, so the save check reads as little data as it can. */
export const VALIDATE_WINDOW_MS = 15 * 60 * 1000;

/** The engine's own words for why a search failed, which name the column or function at fault. */
export function searchFailureReason(error: unknown): string {
  const data = (error as { response?: { data?: Record<string, unknown> } })?.response?.data;
  const detail = data?.error_detail ?? data?.error ?? data?.message;
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  return error instanceof Error ? error.message : String(error ?? "");
}

async function runSql(orgId: string, sql: string, windowMs: number, size: number, nowMs: number) {
  const res = await searchService.search(
    {
      org_identifier: orgId,
      query: {
        query: {
          sql,
          start_time: (nowMs - windowMs) * 1000,
          end_time: nowMs * 1000,
          from: 0,
          size,
        },
      },
      page_type: "logs",
    },
    "ui",
  );
  return {
    hits: (res.data?.hits ?? []) as Record<string, unknown>[],
    total: Number(res.data?.total ?? res.data?.hits?.length ?? 0),
  };
}

export function useDetectionPreview() {
  const rows = shallowRef<Record<string, unknown>[]>([]);
  const total = ref(0);
  const running = ref(false);
  const error = ref("");
  /** The SQL the current rows and error belong to; empty until a preview has run. */
  const previewedSql = ref("");

  function reset() {
    rows.value = [];
    total.value = 0;
    error.value = "";
    previewedSql.value = "";
  }

  async function preview(
    orgId: string,
    sql: string,
    nowMs = Date.now(),
    windowMs = PREVIEW_WINDOW_MS,
  ) {
    running.value = true;
    error.value = "";
    try {
      const result = await runSql(orgId, sql, windowMs, PREVIEW_ROWS, nowMs);
      rows.value = result.hits;
      total.value = result.total;
    } catch (e) {
      rows.value = [];
      total.value = 0;
      error.value = searchFailureReason(e) || "unknown error";
    } finally {
      previewedSql.value = sql;
      running.value = false;
    }
  }

  /** Null when the SQL runs, else the engine's reason; a clean preview of the same SQL counts. */
  async function validate(orgId: string, sql: string, nowMs = Date.now()): Promise<string | null> {
    if (previewedSql.value === sql && !error.value) return null;
    try {
      await runSql(orgId, sql, VALIDATE_WINDOW_MS, 1, nowMs);
      return null;
    } catch (e) {
      return searchFailureReason(e) || "unknown error";
    }
  }

  return { rows, total, running, error, previewedSql, preview, validate, reset };
}
