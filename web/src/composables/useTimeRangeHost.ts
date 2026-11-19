// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import useTimeRangeContext from "@/composables/useTimeRangeContext";
import { toast } from "@/lib/feedback/Toast/useToast";
import { gt } from "@/types/i18n";
import { rangeEndedAt, rangeRefreshFloorSeconds } from "@/utils/autoRefreshPause";
import { rangeExceedsGuard } from "@/utils/orgTimeRangeSettings";
import { formatTimeRange } from "@/utils/timeRangeFormat";
import {
  queryWindow,
  rangeFromQuery,
  rangeToLegacy,
  rangeToQuery,
  resolveRange,
  sameRange,
  type LegacyDateTime,
  type TimeRange,
  type TimeRangeApplyMeta,
  type TimeRangeCapabilities,
  type TimeRangeContext,
  type TimeRangeHostPreset,
} from "@/utils/timeRangeModel";

// Ended and in-progress states change with the clock, so derived state re-reads it this often.
const CLOCK_TICK_MS = 5_000;

export interface TimeRangeHostOptions {
  preset: TimeRangeHostPreset;
  source: string;
  initial: () => TimeRange;
  run?: (range: TimeRange, window: { startUs: number; endUs: number }) => void;
  cancel?: () => void;
  hasResults?: () => boolean;
  autoRefreshSeconds?: Ref<number>;
  panelCount?: () => number;
  url?: boolean;
  capabilities?: TimeRangeCapabilities;
}

export interface TimeRangeGuard {
  from: TimeRange;
  to: TimeRange;
  days: number;
  panels: number;
}

export interface TimeRangeHost {
  range: Ref<TimeRange>;
  queried: Ref<TimeRange | null>;
  stale: ComputedRef<boolean>;
  onApply: (range: TimeRange, meta: TimeRangeApplyMeta) => void;
  runQuery: () => void;
  markQueried: (range?: TimeRange) => void;
  guard: ComputedRef<TimeRangeGuard | null>;
  confirmGuard: () => void;
  dismissGuard: () => void;
  refreshFloorSeconds: ComputedRef<number>;
  refreshFloorRaised: Ref<{ from: number; to: number } | null>;
  rangeEnded: ComputedRef<boolean>;
  window: () => { startUs: number; endUs: number };
  legacy: ComputedRef<LegacyDateTime>;
  invalidLink: Ref<boolean>;
}

/** One page's range: URL, run or wait, org guard and refresh floor, by the page's preset (§4). */
export default function useTimeRangeHost(o: TimeRangeHostOptions): TimeRangeHost {
  const route = useRoute();
  const router = useRouter();
  const { base, now, rangeGuardDays } = useTimeRangeContext();
  const urlOn = o.url ?? o.preset !== "form";
  const clockUs = ref(Date.now() * 1000);
  const timer = setInterval(() => (clockUs.value = Date.now() * 1000), CLOCK_TICK_MS);
  onScopeDispose(() => clearInterval(timer));
  const ctxAtClock = (): TimeRangeContext => ({ ...base.value, nowUs: clockUs.value });

  const linked = urlOn ? rangeFromQuery(route.query, now().nowUs, o.capabilities) : null;
  const invalidLink = ref(linked === "invalid");
  const range = ref<TimeRange>(linked && linked !== "invalid" ? linked : o.initial());
  if (invalidLink.value) {
    const shown = formatTimeRange(range.value, now(), "toast");
    toast({ variant: "warning", message: gt("dateTime.linkUnreadable", { range: shown }) });
  }
  const queried = ref<TimeRange | null>(null);
  const held = ref<{ from: TimeRange; to: TimeRange } | null>(null);
  const refreshFloorRaised = ref<{ from: number; to: number } | null>(null);

  const stale = computed(
    () =>
      o.preset === "explorer-manual" &&
      queried.value !== null &&
      !sameRange(range.value, queried.value),
  );
  const refreshFloorSeconds = computed(() => rangeRefreshFloorSeconds(range.value, ctxAtClock()));
  const rangeEnded = computed(() => rangeEndedAt(range.value, ctxAtClock()));
  const legacy = computed(() => rangeToLegacy(range.value, ctxAtClock()));
  const guard = computed<TimeRangeGuard | null>(() =>
    held.value && rangeGuardDays.value !== null
      ? { ...held.value, days: rangeGuardDays.value, panels: o.panelCount?.() ?? 0 }
      : null,
  );

  const currentWindow = () => queryWindow(range.value, now());

  const writeUrl = (next: TimeRange) => {
    if (!urlOn) return;
    const query: Record<string, unknown> = { ...route.query };
    for (const [key, value] of Object.entries(rangeToQuery(next))) {
      if (value === undefined) delete query[key];
      else query[key] = value;
    }
    router.replace({ query: query as Record<string, string> });
  };

  const markQueried = (next: TimeRange = range.value) => {
    queried.value = next;
  };

  const runQuery = () => {
    held.value = null;
    markQueried();
    o.run?.(range.value, currentWindow());
  };

  const raiseRefreshToFloor = () => {
    const interval = o.autoRefreshSeconds;
    if (!interval || !(interval.value > 0)) return;
    const floor = refreshFloorSeconds.value;
    if (interval.value >= floor) return;
    refreshFloorRaised.value = { from: interval.value, to: floor };
    interval.value = floor;
  };

  const overGuard = (next: TimeRange, meta: TimeRangeApplyMeta): boolean => {
    if (o.preset !== "explorer-auto" && o.preset !== "dashboard") return false;
    if (meta.source === "undo") return false;
    const { startUs, endUs } = resolveRange(next, now());
    return rangeExceedsGuard(startUs, endUs, rangeGuardDays.value);
  };

  const runsOnApply = (meta: TimeRangeApplyMeta): boolean => {
    if (o.preset === "form") return false;
    if (o.preset !== "explorer-manual") return true;
    if (meta.run || meta.source === "drag-zoom") return true;
    if (meta.source === "undo") return meta.undoRuns === true;
    if ((o.autoRefreshSeconds?.value ?? 0) > 0) return true;
    return !(o.hasResults?.() ?? false);
  };

  const onApply = (next: TimeRange, meta: TimeRangeApplyMeta) => {
    if (sameRange(next, range.value) && !meta.run) return;
    const previous = held.value?.from ?? range.value;
    range.value = next;
    writeUrl(next);
    raiseRefreshToFloor();
    if (meta.source === "undo" && o.preset === "dashboard") o.cancel?.();
    if (overGuard(next, meta)) {
      held.value = { from: previous, to: next };
      return;
    }
    held.value = null;
    if (runsOnApply(meta)) runQuery();
  };

  const confirmGuard = () => {
    if (held.value) runQuery();
  };

  const dismissGuard = () => {
    const from = held.value?.from;
    held.value = null;
    if (!from) return;
    range.value = from;
    writeUrl(from);
  };

  return {
    range,
    queried,
    stale,
    onApply,
    runQuery,
    markQueried,
    guard,
    confirmGuard,
    dismissGuard,
    refreshFloorSeconds,
    refreshFloorRaised,
    rangeEnded,
    window: currentWindow,
    legacy,
    invalidLink,
  };
}
