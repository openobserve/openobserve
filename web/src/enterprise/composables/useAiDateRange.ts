// Copyright 2026 OpenObserve Inc.
//
// Shared date range for LLM Insights and LLM Sessions, mirrored to one localStorage key; Quality keeps its own range in the URL.

import { ref, watch } from "vue";

import { getConsumableRelativeTime } from "@/utils/date";

export type AiDateValueType = "relative" | "absolute";

export interface AiDateState {
  valueType: AiDateValueType;
  /** Microseconds — only meaningful when valueType === "absolute". */
  startTime: number | null;
  /** Microseconds — only meaningful when valueType === "absolute". */
  endTime: number | null;
  /** Period token (e.g. "15m", "1h", "7d") — only for "relative". */
  relativeTimePeriod: string | null;
}

const LS_KEY = "aiObservability:dateRange";
const DEFAULT_RELATIVE = "15m";

const DEFAULT_STATE: AiDateState = {
  valueType: "relative",
  startTime: null,
  endTime: null,
  relativeTimePeriod: DEFAULT_RELATIVE,
};

function load(): AiDateState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_STATE };
    return {
      valueType: parsed.valueType === "absolute" ? "absolute" : "relative",
      startTime: typeof parsed.startTime === "number" ? parsed.startTime : null,
      endTime: typeof parsed.endTime === "number" ? parsed.endTime : null,
      // null is a valid value (it's what the absolute branch writes), so it
      // must round-trip through localStorage unchanged. Strings pass through
      // too; everything else (number, boolean, undefined, …) collapses to
      // the default so we never hand the picker garbage.
      relativeTimePeriod:
        typeof parsed.relativeTimePeriod === "string"
          ? parsed.relativeTimePeriod
          : parsed.relativeTimePeriod === null
            ? null
            : DEFAULT_RELATIVE,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

// Module-level singleton — every `useAiDateRange()` call hands back the
// same ref, so writes from one page are immediately visible on the others.
const state = ref<AiDateState>(load());

watch(state, (next) => {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    // ignore storage failures (private mode, quota, etc.)
  }
});

/**
 * Resolve the state to an absolute `{startTime, endTime}` window in
 * microseconds. Re-anchors relative ranges to "now" at the call site so
 * repeated reads of a relative window advance over time.
 *
 * Returns `null` if the state is incomplete (relative with no period; or
 * absolute with null bounds). Callers should fall back to a sensible
 * default in that case.
 */
export function resolveAiDateWindow(s: AiDateState): { startTime: number; endTime: number } | null {
  if (s.valueType === "relative") {
    const period = s.relativeTimePeriod || DEFAULT_RELATIVE;
    const range = getConsumableRelativeTime(period);
    if (!range) return null;
    return { startTime: range.startTime, endTime: range.endTime };
  }
  if (s.startTime == null || s.endTime == null) return null;
  return { startTime: s.startTime, endTime: s.endTime };
}

export function useAiDateRange() {
  return { state };
}
