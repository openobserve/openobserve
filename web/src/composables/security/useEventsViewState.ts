// Copyright 2026 OpenObserve Inc.
//
// useEventsViewState.ts — what the Events page shows, read from the URL first
// and from the viewer's last visit second, plus per-viewer layout preferences.

import { ref, watch, type Ref } from "vue";
import type { FieldFilter, SeverityValue } from "@/utils/security/eventQuery";
import { huntFromQuery, type HuntQuery } from "@/utils/security/huntLink";
import { b64DecodeUnicodeSafe } from "@/utils/formatters";

export interface DateState {
  type: "relative" | "absolute";
  period: string;
  absolute: { startTime: number; endTime: number } | null;
}

export interface ViewState {
  stream: string | null;
  sqlMode: boolean;
  query: string;
  severity: SeverityValue[];
  filters: FieldFilter[];
  date: DateState;
  eventTs: string | null;
  hunt: HuntQuery;
}

export const URL_KEYS = [
  "stream",
  "period",
  "from",
  "to",
  "sql_mode",
  "query",
  "severity",
  "filters",
  "event_ts",
  "hunt",
];
export const EMPTY_DATE: DateState = { type: "relative", period: "15m", absolute: null };
const EMPTY_HUNT: HuntQuery = { kind: "any", value: "", aliases: [] };

export function parseFilters(raw: string): FieldFilter[] {
  try {
    const parsed = JSON.parse(raw.trim().startsWith("[") ? raw : b64DecodeUnicodeSafe(raw, "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((f: any) => f?.field && f?.value != null)
      .map((f: any) => ({
        field: String(f.field),
        op: String(f.op ?? "="),
        value: String(f.value),
      }));
  } catch {
    return [];
  }
}

export function stateFromUrl(q: Record<string, any>): ViewState | null {
  if (!URL_KEYS.some((k) => q[k] != null && q[k] !== "")) return null;
  return {
    stream: q.stream ? String(q.stream) : null,
    sqlMode: String(q.sql_mode) === "true",
    query: q.query ? b64DecodeUnicodeSafe(String(q.query), "") : "",
    severity: q.severity
      ? String(q.severity)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map(Number)
          .filter(Number.isInteger)
      : [],
    filters: q.filters ? parseFilters(String(q.filters)) : [],
    date:
      q.from && q.to
        ? {
            type: "absolute",
            period: "",
            absolute: { startTime: Number(q.from), endTime: Number(q.to) },
          }
        : { type: "relative", period: String(q.period ?? "15m"), absolute: null },
    eventTs: q.event_ts ? String(q.event_ts) : null,
    hunt: huntFromQuery(q),
  };
}

export function stateFromStorage(key: string): ViewState | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return {
      stream: s.stream ?? null,
      sqlMode: !!s.sqlMode,
      query: s.query ?? "",
      severity: Array.isArray(s.severity) ? s.severity.map(Number).filter(Number.isInteger) : [],
      filters: Array.isArray(s.filters) ? s.filters : [],
      date: s.date?.type ? s.date : { ...EMPTY_DATE },
      eventTs: null,
      hunt: s.hunt?.kind ? { ...EMPTY_HUNT, ...s.hunt } : { ...EMPTY_HUNT },
    };
  } catch {
    return null;
  }
}

export function initialViewState(query: Record<string, any>, storageKey: string): ViewState {
  return (
    stateFromUrl(query) ??
    stateFromStorage(storageKey) ?? {
      stream: null,
      sqlMode: false,
      query: "",
      severity: [],
      filters: [],
      date: { ...EMPTY_DATE },
      eventTs: null,
      hunt: { ...EMPTY_HUNT },
    }
  );
}

const PERIOD_MICROS: Record<string, number> = {
  s: 1_000_000,
  m: 60_000_000,
  h: 3_600_000_000,
  d: 86_400_000_000,
  w: 604_800_000_000,
  M: 2_592_000_000_000,
};

export function relativeToMicros(period: string): number {
  const m = period?.match(/^(\d+)\s*([smhdwM])$/);
  return m ? Number(m[1]) * (PERIOD_MICROS[m[2]] ?? PERIOD_MICROS.m) : 15 * 60 * 1_000_000;
}

export function rangeFor(d: DateState) {
  if (d.type === "absolute" && d.absolute?.startTime && d.absolute?.endTime) {
    return { start: Number(d.absolute.startTime), end: Number(d.absolute.endTime) };
  }
  const end = Date.now() * 1000;
  return { start: end - relativeToMicros(d.period), end };
}

export function sameRange(a: { start: number; end: number }, b: { start: number; end: number }) {
  return Math.abs(a.start - b.start) < 1_000_000 && Math.abs(a.end - b.end) < 1_000_000;
}

const DEFAULT_SIDEBAR = 260;

/** Timeline, raw view and sidebar width, remembered per viewer and org. */
export function useEventsPrefs(prefsKey: () => string): {
  showTimeline: Ref<boolean>;
  showRaw: Ref<boolean>;
  sidebarWidth: Ref<number>;
  toggleSidebar: () => void;
} {
  let prefs = { timeline: true, raw: false, sidebar: DEFAULT_SIDEBAR };
  try {
    prefs = { ...prefs, ...JSON.parse(localStorage.getItem(prefsKey()) ?? "{}") };
  } catch {
    /* defaults */
  }
  const showTimeline = ref<boolean>(prefs.timeline);
  const showRaw = ref<boolean>(prefs.raw);
  const sidebarWidth = ref<number>(prefs.sidebar || DEFAULT_SIDEBAR);
  const lastSidebarWidth = ref<number>(sidebarWidth.value || DEFAULT_SIDEBAR);
  watch([showTimeline, showRaw, sidebarWidth], () => {
    try {
      localStorage.setItem(
        prefsKey(),
        JSON.stringify({
          timeline: showTimeline.value,
          raw: showRaw.value,
          sidebar: sidebarWidth.value,
        }),
      );
    } catch {
      /* best-effort */
    }
  });
  function toggleSidebar() {
    if (sidebarWidth.value > 0) {
      lastSidebarWidth.value = sidebarWidth.value;
      sidebarWidth.value = 0;
    } else {
      sidebarWidth.value = lastSidebarWidth.value || DEFAULT_SIDEBAR;
    }
  }
  return { showTimeline, showRaw, sidebarWidth, toggleSidebar };
}

/** Raw-view columns remembered per stream. */
export function loadSavedCols(key: string, stream: string): string[] | null {
  try {
    const cols = JSON.parse(localStorage.getItem(key) ?? "{}")?.[stream];
    return Array.isArray(cols) && cols.length ? cols : null;
  } catch {
    return null;
  }
}

export function saveCols(key: string, stream: string, cols: string[]) {
  try {
    const all = JSON.parse(localStorage.getItem(key) ?? "{}");
    all[stream] = cols;
    localStorage.setItem(key, JSON.stringify(all));
  } catch {
    /* best-effort */
  }
}
