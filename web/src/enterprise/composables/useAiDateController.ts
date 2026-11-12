// Copyright 2026 OpenObserve Inc.
// Resolve at creation, before the picker mounts, or its seed replay writes the previous visit's range.

import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import { getConsumableRelativeTime } from "@/utils/date";
import { resolveCalendarPeriod } from "@/utils/dashboard/calendarPeriods";
import { replaceRouteQuery } from "@/utils/url/replaceRouteQuery";
import { useAiDateRange, resolveAiDateWindow } from "@/enterprise/composables/useAiDateRange";

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

  // URL wins on mount so deep-links reproduce the saved view; shared state covers the no-URL case.
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

  // An org switch remounts before navigation commits, so the route still names the previous org.
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

  // Returns whether the range changed, so pages skip the picker's mount replay.
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

  // The picker rounds to whole seconds; treat its mount-replay echo as the same selection.
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
