// Copyright 2026 OpenObserve Inc.

// Runs a draft detection over history on the server, window by window as the scheduler would, plus a short check that its SQL plans.
import { ref, shallowRef } from "vue";

import searchService from "@/services/search";
import securitySigma, {
  type DetectionPreview,
  type DetectionPreviewRequest,
  type PreviewRangeMinutes,
} from "@/services/securitySigma";

/** Ranges the preview offers; 24 hours is the default. */
export const PREVIEW_RANGES: readonly PreviewRangeMinutes[] = [60, 1440, 10080];
export const DEFAULT_PREVIEW_RANGE: PreviewRangeMinutes = 1440;
/** Planning errors surface whatever the range, so the save check reads as little data as it can. */
export const VALIDATE_WINDOW_MS = 15 * 60 * 1000;

/** The engine's own words for why a search failed, which name the column or function at fault. */
export function searchFailureReason(error: unknown): string {
  const data = (error as { response?: { data?: Record<string, unknown> } })?.response?.data;
  const detail = data?.error_detail ?? data?.error ?? data?.message;
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  return error instanceof Error ? error.message : String(error ?? "");
}

/** A stable identity of a preview request, so a result is shown only for the draft it ran. */
export function previewKey(request: DetectionPreviewRequest | null): string {
  return request ? JSON.stringify(request) : "";
}

async function planCheck(orgId: string, sql: string, nowMs: number) {
  await searchService.search(
    {
      org_identifier: orgId,
      query: {
        query: {
          sql,
          start_time: (nowMs - VALIDATE_WINDOW_MS) * 1000,
          end_time: nowMs * 1000,
          from: 0,
          size: 1,
        },
      },
      page_type: "logs",
    },
    "ui",
  );
}

export function useDetectionPreview() {
  const result = shallowRef<DetectionPreview | null>(null);
  const running = ref(false);
  const error = ref("");
  /** The request the current result and error belong to; empty until a preview has run. */
  const previewedKey = ref("");
  /** The SQL a clean preview ran, so the save check need not run it again. */
  let cleanSql = "";
  let seq = 0;

  function reset() {
    seq++;
    result.value = null;
    error.value = "";
    previewedKey.value = "";
    running.value = false;
  }

  async function preview(orgId: string, request: DetectionPreviewRequest) {
    const mine = ++seq;
    running.value = true;
    error.value = "";
    try {
      const res = await securitySigma.previewDetection(orgId, request);
      if (mine !== seq) return;
      result.value = res.data;
      error.value = res.data?.error ?? "";
      if (!error.value && !res.data?.windows_failed) cleanSql = res.data?.sql ?? "";
    } catch (e) {
      if (mine !== seq) return;
      result.value = null;
      error.value = searchFailureReason(e) || "unknown error";
    } finally {
      if (mine === seq) {
        previewedKey.value = previewKey(request);
        running.value = false;
      }
    }
  }

  /** Null when the SQL runs, else the engine's reason; a clean preview of the same SQL counts. */
  async function validate(orgId: string, sql: string, nowMs = Date.now()): Promise<string | null> {
    if (cleanSql && cleanSql === sql) return null;
    try {
      await planCheck(orgId, sql, nowMs);
      return null;
    } catch (e) {
      return searchFailureReason(e) || "unknown error";
    }
  }

  return { result, running, error, previewedKey, preview, validate, reset };
}
