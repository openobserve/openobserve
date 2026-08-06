// Copyright 2026 OpenObserve Inc.
//
// AI-page date controller. Extracts the date state + URL-sync logic that was
// near-identical across SessionsPage / LLMInsightsPage (and similar in
// AgentGraph / AgentBehaviorPage) into a single composable wrapping the shared
// `useAiDateRange` singleton.
//
// Scope: this composable owns ONLY the date state + URL sync. It does NOT own
// the child-refresh (`sessionsRef.refresh(...)`) — that lives in
// `useChildRefresh`. `onDateChange` here updates date state + writes URL only;
// the page wires the child refresh off the resolved `timeRange`.
//
// URL sync boundary: SessionsPage / LLMInsightsPage sync their date to the URL
// (deep-links reproduce the exact view). AgentGraph / AgentBehaviorPage do NOT
// — they resolve from shared state on mount but keep no from/to/period URL. Pass
// `urlSync: false` for those so `readFromUrl` returns false and `writeToUrl`
// is a no-op, preserving their prior behavior.

import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { getConsumableRelativeTime } from "@/utils/date";
import { useAiDateRange, resolveAiDateWindow } from "@/enterprise/composables/useAiDateRange";

export function useAiDateController(opts: { defaultRelative?: string; urlSync?: boolean } = {}) {
  const DEFAULT_RELATIVE = opts.defaultRelative ?? "15m";
  const urlSync = opts.urlSync ?? true;

  const route = useRoute();
  const router = useRouter();

  const { state: dateState } = useAiDateRange();
  const timeRange = ref({ startTime: 0, endTime: 0 });

  function applyRelative(period: string) {
    const range = getConsumableRelativeTime(period);
    if (!range) return;
    timeRange.value = { startTime: range.startTime, endTime: range.endTime };
    dateState.value = {
      ...dateState.value,
      valueType: "relative",
      relativeTimePeriod: period,
      startTime: range.startTime,
      endTime: range.endTime,
    };
  }

  // URL ↔ shared date sync. URL wins over shared state on mount so deep-links
  // reproduce the exact saved view, but shared state is the cross-page memory
  // when no URL hint is present. When `urlSync` is off there is no URL to read.
  function readFromUrl(): boolean {
    if (!urlSync) return false;

    const fromRaw = route.query.from;
    const toRaw = route.query.to;
    const periodRaw = route.query.period;

    if (typeof fromRaw === "string" && typeof toRaw === "string") {
      const startTime = Number(fromRaw);
      const endTime = Number(toRaw);
      if (Number.isFinite(startTime) && Number.isFinite(endTime) && endTime > startTime) {
        dateState.value = {
          valueType: "absolute",
          startTime,
          endTime,
          relativeTimePeriod: null,
        };
        timeRange.value = { startTime, endTime };
        return true;
      }
    }

    if (typeof periodRaw === "string" && periodRaw) {
      applyRelative(periodRaw);
      return true;
    }

    return false;
  }

  function writeToUrl() {
    if (!urlSync) return;

    const next: Record<string, any> = { ...route.query };
    if (dateState.value.valueType === "relative") {
      next.period = dateState.value.relativeTimePeriod ?? DEFAULT_RELATIVE;
      delete next.from;
      delete next.to;
    } else {
      next.from = String(dateState.value.startTime ?? 0);
      next.to = String(dateState.value.endTime ?? 0);
      delete next.period;
    }
    router.replace({ query: next }).catch(() => {});
  }

  // Date-only part of the page's onDateChange: update state + write URL. The
  // page wires the child refresh off `timeRange` separately (see useChildRefresh).
  function onDateChange(value: any) {
    if (value?.valueType === "relative" && value.relativeTimePeriod) {
      applyRelative(value.relativeTimePeriod);
    } else {
      dateState.value = {
        valueType: "absolute",
        startTime: value.startTime,
        endTime: value.endTime,
        relativeTimePeriod: null,
      };
      timeRange.value = { startTime: value.startTime, endTime: value.endTime };
    }
    writeToUrl();
  }

  // Mount precedence: URL > cross-page shared state > default relative.
  function mountResolve() {
    if (readFromUrl()) return;

    const window = resolveAiDateWindow(dateState.value);
    if (window) {
      timeRange.value = window;
      if (dateState.value.valueType === "relative") {
        applyRelative(dateState.value.relativeTimePeriod ?? DEFAULT_RELATIVE);
      }
    } else {
      applyRelative(DEFAULT_RELATIVE);
    }
    writeToUrl();
  }

  return {
    dateState,
    timeRange,
    applyRelative,
    onDateChange,
    readFromUrl,
    writeToUrl,
    mountResolve,
    DEFAULT_RELATIVE,
  };
}
