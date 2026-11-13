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

import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from "vue";
import {
  parseCalendarToken,
  resolveCalendarPeriod,
  shiftCalendarToken,
} from "@/utils/dashboard/calendarPeriods";
import { convertToUtcTimestamp } from "@/utils/zincutils";
import { exceedsRangeRestriction } from "@/utils/timeRangeRail";
import { formatRangeDuration, formatRangeLabel } from "@/utils/timeRangeLabel";
import { popUndoStep, pushUndoStep, type TimeRangeUndoStep } from "@/utils/timeRangeUndo";
import { useShortcuts } from "@/lib/vue-shortcut-manager/composables";
import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  MICROS_PER_MINUTE,
  MICROS_PER_SECOND,
  addCivilDays,
  civilDayMs,
  type TimeRangeZone,
} from "@/composables/useTimeRangeZone";
import { MAX_CUSTOM_RELATIVE_VALUE, type TimeRangeLimits } from "@/composables/useTimeRangeLimits";
import type { TimeRangeFields } from "@/composables/useTimeRangeFields";

// Toolbar pickers on screen, oldest first; the oldest holds the key bindings and the newest acts on them.
const shortcutPickers = ref<{ token: symbol; act: Record<string, () => void> }[]>([]);

export interface TimeRangeSteppingProps {
  autoApply: boolean;
  disable: boolean;
  disableRelative: boolean;
  disablePrevShift: boolean;
  hideRangeShift: boolean;
  hideRelativeTime: boolean;
  maxDate: string;
  queryRangeRestrictionInHour: number;
  queryRangeRestrictionMsg: string;
  shortcuts: boolean;
  undoable: boolean;
}

interface AppliedSelection {
  selectedType: string;
  calendarToken: string | null;
  relativePeriod: string;
  relativeValue: number;
}

interface PickerRange {
  startTime: number;
  endTime: number;
}

export interface TimeRangeSteppingDeps {
  clock: TimeRangeZone;
  limits: TimeRangeLimits;
  fields: TimeRangeFields;
  selectedType: Ref<string>;
  calendarToken: Ref<string | null>;
  relativePeriod: Ref<string>;
  relativeValue: Ref<number>;
  pendingDay: Ref<string | null>;
  pendingRange: ComputedRef<PickerRange | null>;
  triggerLabel: ComputedRef<unknown>;
  // The selection last applied, which an undo step returns to.
  appliedSelection: () => AppliedSelection;
  // True while this picker's own change is emitted, so a page answering it keeps the undo steps.
  emittingOwnChange: () => boolean;
  lastPayload: () => Partial<
    PickerRange & { valueType: string; relativeTimePeriod: string | null }
  >;
  normalizedCount: () => number;
  largestExactUnit: (unit: string, value: number) => [string, number];
  setRelativeDate: (period: string, value: number, commit?: boolean) => void;
  saveDate: (dateType?: string | null) => void;
  getConsumableDateTime: () => PickerRange;
  openMenu: () => void;
  // Closes the open panel as a user dismissal does, so listeners waiting on hide still run.
  closeMenu: () => void;
  onUndo: (step: TimeRangeUndoStep) => void;
}

/** Moves the applied range by key or button: ‹ › shifts, zoom out, back to live, and undo of those steps. */
export default function useTimeRangeStepping(
  props: TimeRangeSteppingProps,
  deps: TimeRangeSteppingDeps,
) {
  const { t } = useI18nTyped();
  const {
    clock,
    limits,
    fields,
    selectedType,
    calendarToken,
    relativePeriod,
    relativeValue,
    pendingDay,
    pendingRange,
    saveDate,
    getConsumableDateTime,
    closeMenu,
  } = deps;
  const {
    zone,
    convertUnixTime,
    civilDayStart,
    refreshTooltipNow,
    resolveRelativePeriod,
    labelOptions,
  } = clock;
  const {
    calendarMinDate,
    forwardCeilingMicros,
    restrictionLimitMicros,
    showRestrictionToast,
    calendarExceedsRestriction,
  } = limits;
  const { selectedDate, selectedTime } = fields;

  const undoStack = ref<TimeRangeUndoStep[]>([]);

  const clearUndo = () => {
    undoStack.value = [];
  };

  // A range the page sets replaces the one undo leads back from, unless it echoes or answers this picker's own emit.
  const clearUndoForPageRange = (range: {
    relativeTimePeriod?: string | null;
    startTime?: unknown;
    endTime?: unknown;
  }) => {
    if (deps.emittingOwnChange()) return;
    const last = deps.lastPayload();
    const echoed = range.relativeTimePeriod
      ? last.valueType === "relative" && last.relativeTimePeriod === range.relativeTimePeriod
      : last.valueType === "absolute" &&
        Number(last.startTime) === Number(range.startTime) &&
        Number(last.endTime) === Number(range.endTime);
    if (!echoed) clearUndo();
  };

  // The step names what the trigger showed, so the undo tooltip reads the range it returns to.
  const captureUndo = () => {
    if (!props.undoable || props.hideRangeShift) return;
    const { startTime, endTime } = getConsumableDateTime();
    const applied = deps.appliedSelection();
    undoStack.value = pushUndoStep(undoStack.value, {
      label: String(deps.triggerLabel.value),
      selectedType: applied.selectedType,
      calendarToken: applied.calendarToken,
      relativePeriod: applied.relativePeriod,
      relativeValue: applied.relativeValue,
      startUs: startTime,
      endUs: endTime,
    });
  };

  const undoRange = () => {
    const popped = popUndoStep(undoStack.value);
    if (!popped) return;
    const { step } = popped;
    undoStack.value = popped.rest;
    selectedType.value = step.selectedType;
    calendarToken.value = step.calendarToken;
    relativePeriod.value = step.relativePeriod;
    relativeValue.value = step.relativeValue;
    pendingDay.value = null;
    if (step.selectedType === "absolute") {
      fields.writeAbsoluteFields(step.startUs, step.endUs);
      fields.holdUnshownInstants(step.startUs, step.endUs);
    }
    saveDate(step.selectedType);
    closeMenu();
    deps.onUndo(step);
  };

  // Whole days, or days from midnight up to some moment today, which are those days so far.
  const wholeDaySpan = (): { from: string; days: number } | null => {
    const { startTime, endTime } = selectedTime.value;
    if (selectedType.value !== "absolute" || startTime !== "00:00:00") return null;
    const { from, to } = selectedDate.value;
    const days = Math.round((civilDayMs(to) - civilDayMs(from)) / 86_400_000) + 1;
    if (!(days >= 1)) return null;
    if (endTime === "23:59:59") return { from, days };
    // Today counts as a whole day only while it runs to now; a short window from midnight shifts by its length.
    const endsNow =
      Math.abs(fields.getUTCTimeStamp().endUTC - Date.now() * 1000) <= MICROS_PER_MINUTE;
    return to === convertUnixTime(Date.now() * 1000).date && endsNow ? { from, days } : null;
  };

  // Whole days step by whole civil days, so the inclusive 23:59:59 end and a DST day stay exact; days not over yet end now; false leaves the shift to the timed path.
  const shiftWholeDays = (direction: "prev" | "next"): boolean => {
    const span = wholeDaySpan();
    if (!span) return false;
    const from = addCivilDays(span.from, direction === "prev" ? -span.days : span.days);
    const to = addCivilDays(from, span.days - 1);
    const ceiling = forwardCeilingMicros();
    if (civilDayStart(from) >= ceiling) return true;
    const end =
      convertToUtcTimestamp(`${to} 23:59:59`, zone.value) > ceiling
        ? convertUnixTime(ceiling)
        : { date: to, time: "23:59:59" };
    const endUs = convertToUtcTimestamp(`${end.date} ${end.time}`, zone.value);
    if (exceedsRangeRestriction(civilDayStart(from), endUs, props.queryRangeRestrictionInHour)) {
      showRestrictionToast();
      return true;
    }
    captureUndo();
    selectedDate.value.from = from;
    selectedDate.value.to = end.date;
    selectedTime.value.endTime = end.time;
    fields.forgetSeededEnd();
    saveDate("absolute");
    closeMenu();
    return true;
  };

  // A chain of steps that began on a rolling range goes back to it once `]` reaches where it began, or now.
  const returnToLiveOrigin = (endUs: number): boolean => {
    const origin = undoStack.value[0];
    if (props.maxDate || !origin || origin.selectedType !== "relative") return false;
    const reach = Math.min(origin.endUs, Date.now() * 1000) - MICROS_PER_SECOND;
    if (origin.calendarToken !== null || endUs < reach) return false;
    captureUndo();
    selectedType.value = "relative";
    calendarToken.value = null;
    relativePeriod.value = origin.relativePeriod;
    relativeValue.value = origin.relativeValue;
    saveDate("relative");
    closeMenu();
    return true;
  };

  // A calendar period steps to the one before or after it.
  const shiftCalendarPeriod = (token: string, direction: "prev" | "next") => {
    const shifted = shiftCalendarToken(token, direction === "prev" ? -1 : 1);
    if (shifted === null || !resolveCalendarPeriod(shifted, zone.value)) return;
    refreshTooltipNow();
    // A partial period can step into a full one longer than the page allows, which the rail would have refused.
    if (calendarExceedsRestriction(shifted)) {
      if (props.queryRangeRestrictionMsg) {
        toast({ variant: "warning", message: raw(props.queryRangeRestrictionMsg) });
      }
      return;
    }
    captureUndo();
    calendarToken.value = shifted;
    saveDate("relative");
    closeMenu();
  };

  // Moves the range by its own length as an absolute range; a user step, so it is not marked programmatic.
  const shiftTimeRange = (direction: "prev" | "next") => {
    if (selectedType.value === "relative" && calendarToken.value !== null) {
      shiftCalendarPeriod(calendarToken.value, direction);
      return;
    }
    if (shiftWholeDays(direction)) return;
    const { startTime, endTime } = getConsumableDateTime();
    const duration = endTime - startTime;
    if (!(duration > 0)) return;

    let delta = (direction === "prev" ? -1 : 1) * duration;
    if (direction === "next") {
      // A forward shift stops where the calendar does: now, or the end of `maxDate`.
      delta = Math.min(delta, forwardCeilingMicros() - endTime);
      if (delta < MICROS_PER_SECOND) return;
      if (returnToLiveOrigin(endTime + delta)) return;
    }
    captureUndo();
    // Written as instants, so the sub-second bounds the fields cannot show move with the range.
    fields.writeInstants(startTime + delta, endTime + delta);
    selectedType.value = "absolute";
    saveDate("absolute");
    closeMenu();
  };

  const isNextShiftDisabled = () => {
    if (selectedType.value === "relative") {
      return (parseCalendarToken(calendarToken.value)?.offset ?? 0) === 0;
    }
    const span = wholeDaySpan();
    if (span) return civilDayStart(addCivilDays(span.from, span.days)) >= forwardCeilingMicros();
    const { endUTC } = fields.getUTCTimeStamp();
    return !(endUTC + MICROS_PER_SECOND <= forwardCeilingMicros());
  };

  // The largest unit that divides the span exactly, else whole minutes.
  const toRelativeUnit = (spanMicros: number): [string, number] => {
    const minutes = Math.max(1, Math.round(spanMicros / MICROS_PER_MINUTE));
    if (minutes % 1440 === 0) return ["d", minutes / 1440];
    if (minutes % 60 === 0) return ["h", minutes / 60];
    return ["m", minutes];
  };

  const goLive = () => {
    if (selectedType.value === "relative") return;
    const range = pendingRange.value;
    if (!range || !(range.endTime > range.startTime)) return;
    let span = range.endTime - range.startTime;
    if (span > restrictionLimitMicros()) {
      showRestrictionToast();
      span = restrictionLimitMicros();
    }
    const [unit, value] = toRelativeUnit(span);
    clearUndo();
    pendingDay.value = null;
    // Live has no Apply step on any picker, and an uncommitted pick would be undone when the panel closes.
    deps.setRelativeDate(unit, Math.min(value, MAX_CUSTOM_RELATIVE_VALUE[unit]), true);
  };

  const zoomOutRelative = () => {
    const unit = relativePeriod.value;
    const current = deps.normalizedCount();
    let next = deps.largestExactUnit(
      unit,
      Math.min(current * 2, MAX_CUSTOM_RELATIVE_VALUE[unit] ?? current * 2),
    );
    const span = resolveRelativePeriod(`${next[1]}${next[0]}`, Date.now());
    if (span && span.endTime - span.startTime > restrictionLimitMicros()) {
      showRestrictionToast();
      next = toRelativeUnit(restrictionLimitMicros());
    }
    if (next[0] === unit && next[1] === current) return;
    captureUndo();
    selectedType.value = "relative";
    calendarToken.value = null;
    relativePeriod.value = next[0];
    relativeValue.value = next[1];
    saveDate("relative");
    closeMenu();
  };

  const zoomOutAbsolute = () => {
    const { startTime, endTime } = getConsumableDateTime();
    const duration = endTime - startTime;
    if (!(duration > 0)) return;
    let width = duration * 2;
    if (width > restrictionLimitMicros()) {
      showRestrictionToast();
      width = restrictionLimitMicros();
      if (width <= duration) return;
    }
    const floor = Math.min(civilDayStart(calendarMinDate.value), startTime);
    // An end already past now stays; otherwise widening stops at now, as Next does.
    const ceiling = Math.max(forwardCeilingMicros(), endTime);
    // With ‹ off there is nothing earlier to show, so the range only grows forward.
    const centred = Math.round(startTime + duration / 2 - width / 2);
    const start = Math.max(props.disablePrevShift ? startTime : centred, floor);
    const end = Math.min(start + width, ceiling);
    if (start === startTime && end === endTime) return;
    captureUndo();
    fields.writeInstants(start, end);
    selectedType.value = "absolute";
    calendarToken.value = null;
    saveDate("absolute");
    closeMenu();
  };

  // At the page's limit zoom cannot widen, so it is off instead of answering with a toast.
  const zoomOutBlocked = computed(() => {
    const range = pendingRange.value;
    if (!range || !(range.endTime > range.startTime)) return false;
    return range.endTime - range.startTime >= restrictionLimitMicros();
  });

  // A rolling period doubles its count; any other range doubles around its centre.
  const zoomOut = () => {
    if (zoomOutBlocked.value) return;
    // An absolute-only picker shows only its dates, so they are what zoom widens.
    if (props.disableRelative) selectedType.value = "absolute";
    if (selectedType.value === "relative" && calendarToken.value === null) zoomOutRelative();
    else zoomOutAbsolute();
  };

  const showUndo = computed(
    () => props.undoable && !props.hideRangeShift && undoStack.value.length > 0,
  );

  const undoTooltip = computed(() => {
    const top = undoStack.value[undoStack.value.length - 1];
    return top ? t("dateTime.backTo", { range: top.label }) : t("dateTime.undo");
  });

  const liveDurationLabel = computed(() => {
    const range = pendingRange.value;
    if (!range || !(range.endTime > range.startTime)) return "";
    const span = Math.min(range.endTime - range.startTime, restrictionLimitMicros());
    return formatRangeDuration(0, span);
  });

  // The window a step would move to, for the ‹ › tooltips.
  const stepTooltip = computed(() => {
    const range = pendingRange.value;
    const valid = !!range && range.endTime > range.startTime;
    const span = valid ? range.endTime - range.startTime : 0;
    const duration = valid ? formatRangeDuration(0, span) : "";
    const windowText = (startUs: number, endUs: number) =>
      formatRangeLabel({ startUs, endUs }, { ...labelOptions(), surface: "row" });
    const nextBlocked = isNextShiftDisabled();
    const ceiling = forwardCeilingMicros();
    return {
      prev: {
        title: String(t("dateTime.previousDuration", { duration })),
        window: valid ? windowText(range.startTime - span, range.startTime) : "",
      },
      next: {
        title: String(
          nextBlocked ? t("dateTime.alreadyAtNow") : t("dateTime.nextDuration", { duration }),
        ),
        window:
          valid && !nextBlocked
            ? windowText(range.endTime, Math.min(range.endTime + span, ceiling))
            : "",
      },
      zoom: zoomOutBlocked.value
        ? limits.maxLimitText()
        : valid
          ? t("dateTime.zoomOutTo", { duration: formatRangeDuration(0, span * 2) })
          : t("common.timeRangeZoomOut"),
    };
  });

  // One binding per key app-wide: two pickers registering the same ids would unregister each other.
  const shortcutToken = Symbol("date-time");
  const takesShortcuts = computed(
    () => props.shortcuts && !props.hideRangeShift && !props.disableRelative,
  );
  const shortcutActions: Record<string, () => void> = {
    open: () => deps.openMenu(),
    prev: () => {
      if (!props.disable && !props.disablePrevShift) shiftTimeRange("prev");
    },
    next: () => {
      if (!props.disable && !isNextShiftDisabled()) shiftTimeRange("next");
    },
    zoomOut: () => {
      if (!props.disable && !props.hideRelativeTime) zoomOut();
    },
    undo: () => {
      if (!props.disable) undoRange();
    },
  };
  const joinShortcuts = () => {
    if (!takesShortcuts.value) return;
    if (shortcutPickers.value.some((item) => item.token === shortcutToken)) return;
    shortcutPickers.value = [
      ...shortcutPickers.value,
      { token: shortcutToken, act: shortcutActions },
    ];
  };
  const leaveShortcuts = () => {
    shortcutPickers.value = shortcutPickers.value.filter((item) => item.token !== shortcutToken);
  };
  const holdsShortcuts = computed(() => shortcutPickers.value[0]?.token === shortcutToken);
  const onNewestPicker = (action: string) => () =>
    shortcutPickers.value[shortcutPickers.value.length - 1]?.act[action]?.();
  onMounted(joinShortcuts);
  onActivated(joinShortcuts);
  // Print and kiosk modes turn the page's keys off while the picker stays mounted.
  watch(takesShortcuts, (takes) => (takes ? joinShortcuts() : leaveShortcuts()));
  onDeactivated(leaveShortcuts);
  onBeforeUnmount(leaveShortcuts);

  useShortcuts(
    [
      { id: "timeRangeOpen", handler: onNewestPicker("open") },
      { id: "timeRangePrevious", handler: onNewestPicker("prev") },
      { id: "timeRangeNext", handler: onNewestPicker("next") },
      { id: "timeRangeZoomOut", handler: onNewestPicker("zoomOut") },
      { id: "timeRangeUndo", handler: onNewestPicker("undo") },
    ],
    undefined,
    { active: holdsShortcuts },
  );

  return {
    clearUndo,
    clearUndoForPageRange,
    captureUndo,
    undoRange,
    shiftTimeRange,
    isNextShiftDisabled,
    goLive,
    zoomOut,
    zoomOutBlocked,
    showUndo,
    undoTooltip,
    liveDurationLabel,
    stepTooltip,
  };
}
