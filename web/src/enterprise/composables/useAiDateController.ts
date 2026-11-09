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
// The date resolves when the composable is created, in the page's setup and so
// before the shell's DateTime mounts. The picker seeds itself from `dateState`
// once, on mount, and replays that seed as a `date-change`; resolving later
// (e.g. in the page's `onMounted`) let the replay carry the previous visit's
// range into the URL and the picker label while the data used the link's.
//
// URL sync: every AI page keeps its range in the URL (`period`, or `from`/`to`),
// so deep-links reproduce the exact view.

import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import { getConsumableRelativeTime } from "@/utils/date";
import { resolveCalendarPeriod } from "@/utils/dashboard/calendarPeriods";
import { replaceRouteQuery } from "@/utils/url/replaceRouteQuery";
import { useAiDateRange, resolveAiDateWindow } from "@/enterprise/composables/useAiDateRange";

// The picker shows `<n><unit>` periods (n ≥ 1) and calendar tokens. A URL value
// such as "1.5h", "0h" or "abc" is no period; the leading-zero form "06h" is
// written back as the picker names it ("6h").
function normalizePeriod(raw: string): string | null {
  const match = raw.match(/^(\d+)([smhdwM])$/);
  if (match) {
    const value = Number(match[1]);
    return value > 0 ? `${value}${match[2]}` : null;
  }
  return resolveCalendarPeriod(raw) ? raw : null;
}

export function useAiDateController(opts: { defaultRelative?: string } = {}) {
  const DEFAULT_RELATIVE = opts.defaultRelative ?? "15m";

  const route = useRoute();
  const router = useRouter();
  const store = useStore();

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
  // when no URL hint is present.
  function readFromUrl(): boolean {
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

    if (typeof periodRaw === "string") {
      const period = normalizePeriod(periodRaw);
      if (period) {
        applyRelative(period);
        return true;
      }
    }

    return false;
  }

  // An org switch remounts the page before its navigation commits, so the route
  // still names the previous org while the store holds the one the page shows.
  // Writing on that route must not put the previous org back.
  function writeToUrl() {
    void replaceRouteQuery(router, route, (next) => {
      const org = store.state.selectedOrganization?.identifier;
      if (org && next.org_identifier != null) next.org_identifier = org;
      if (dateState.value.valueType === "relative") {
        next.period = dateState.value.relativeTimePeriod ?? DEFAULT_RELATIVE;
        delete next.from;
        delete next.to;
      } else {
        next.from = String(dateState.value.startTime ?? 0);
        next.to = String(dateState.value.endTime ?? 0);
        delete next.period;
      }
      return next;
    });
  }

  // Date-only part of the page's onDateChange: update state + write URL. The
  // page wires the child refresh off `timeRange` separately (see useChildRefresh).
  // Returns whether the selected range changed, so a page can re-fetch on a
  // programmatic emit that moves the window and skip the picker's mount replay.
  function onDateChange(value: any): boolean {
    const before = selectionKey();
    if (value?.valueType === "relative" && value.relativeTimePeriod) {
      applyRelative(value.relativeTimePeriod);
    } else if (!sameToTheSecond(value)) {
      dateState.value = {
        valueType: "absolute",
        startTime: value.startTime,
        endTime: value.endTime,
        relativeTimePeriod: null,
      };
      timeRange.value = { startTime: value.startTime, endTime: value.endTime };
    }
    writeToUrl();
    return selectionKey() !== before;
  }

  // The picker keeps whole seconds, so a deep link with sub-second from/to comes
  // back from its mount replay slightly moved. That echo is the same selection:
  // keep the link's exact range rather than re-fetching on the rounded one.
  function sameToTheSecond(value: { startTime?: unknown; endTime?: unknown }): boolean {
    const s = dateState.value;
    return (
      s.valueType === "absolute" &&
      Math.abs(Number(value?.startTime) - Number(s.startTime)) < 1_000_000 &&
      Math.abs(Number(value?.endTime) - Number(s.endTime)) < 1_000_000
    );
  }

  // A relative range is the same selection whatever "now" it was anchored to.
  function selectionKey() {
    const s = dateState.value;
    return s.valueType === "relative"
      ? `relative:${s.relativeTimePeriod}`
      : `absolute:${s.startTime}-${s.endTime}`;
  }

  // Precedence: URL > cross-page shared state > default relative.
  function resolve() {
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

  resolve();

  return {
    dateState,
    timeRange,
    applyRelative,
    onDateChange,
    readFromUrl,
    writeToUrl,
    DEFAULT_RELATIVE,
  };
}
