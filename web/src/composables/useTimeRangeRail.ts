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

import { computed, nextTick, ref, type ComputedRef, type Ref } from "vue";
import { parseCalendarToken, resolveCalendarPeriod } from "@/utils/dashboard/calendarPeriods";
import { CALENDAR_RAIL_ITEMS, formatCivilDay } from "@/utils/timeRangeRail";
import {
  TIME_RANGE_CHIP_SETS,
  composeTimeRangeList,
  isOfferedElsewhere,
  orderCalendarItems,
  visibleRecentEntries,
  type OfferedElsewhere,
  type TimeRangeListRow,
  type TimeRangePreset,
} from "@/utils/timeRangeList";
import {
  formatRangeDates,
  formatRangeDuration,
  formatRangeLabel,
  formatRangeStamps,
  formatZoneOffset,
} from "@/utils/timeRangeLabel";
import useTimeRangeHistory, {
  isRelativeHistoryEntry,
  type TimeRangeHistoryEntry,
} from "@/composables/useTimeRangeHistory";
import useTimeRangePins from "@/composables/useTimeRangePins";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { TimeRangeZone } from "@/composables/useTimeRangeZone";
import type { TimeRangeLimits } from "@/composables/useTimeRangeLimits";

export interface TimeRangeRailProps {
  disableRelative: boolean;
  hideRelativeTime: boolean;
  calendarPresets: boolean;
  preset: TimeRangePreset;
  queryRangeRestrictionInHour: number;
  narrowedByQuery: { startUs: number; endUs: number } | null;
}

export interface TimeRangeRailDeps {
  clock: TimeRangeZone;
  limits: TimeRangeLimits;
  // The applied range is already the summary, so Recent never repeats it.
  currentEntry: ComputedRef<TimeRangeHistoryEntry | null>;
  // The rolling period in force, so the one chip equal to it is the only control lit for it.
  appliedPeriod: Ref<string | null>;
  // A period from outside the picker as the picker would apply it; null when it cannot.
  boundedPeriod: (period: string) => string | null;
  listCursor: Ref<number>;
  inputBar: Ref<{ focus: () => void } | null>;
}

/** The ready-made ranges the panel offers: pinned, recent and calendar rows, the chips, and the notes beside the chips. */
export default function useTimeRangeRail(props: TimeRangeRailProps, deps: TimeRangeRailDeps) {
  const { t } = useI18nTyped();
  const { clock, limits, currentEntry, appliedPeriod, listCursor, inputBar } = deps;
  const {
    zone,
    tooltipNow,
    intlLocale,
    labelOptions,
    convertUnixTime,
    dayLabel,
    relativeLabel,
    resolveRelativePeriod,
    calendarTooltip,
    formatShownInstant,
  } = clock;
  const { boundedRange, limitReason, maxLimitText, restrictionMessage } = limits;

  const timeRangeHistory = useTimeRangeHistory();
  const timeRangePins = useTimeRangePins();
  const editingPinRowId = ref<string | null>(null);

  // Date-only pickers cannot show the times a recent range carries.
  const showRail = computed(() => !props.disableRelative);

  // Rows the picker could not apply as stored are left out: out-of-bounds ranges, over-cap periods, and calendar tokens where calendar presets are off.
  const isUsableRecentEntry = (entry: TimeRangeHistoryEntry) => {
    if (!isRelativeHistoryEntry(entry)) return boundedRange(entry.startUs, entry.endUs) !== null;
    if (deps.boundedPeriod(entry.relative) !== entry.relative) return false;
    return props.calendarPresets || parseCalendarToken(entry.relative) === null;
  };

  const entryRange = (entry: TimeRangeHistoryEntry) =>
    isRelativeHistoryEntry(entry)
      ? resolveRelativePeriod(entry.relative, tooltipNow.value)
      : { startTime: entry.startUs, endTime: entry.endUs };

  const entryLabel = (entry: TimeRangeHistoryEntry): string =>
    isRelativeHistoryEntry(entry)
      ? String(relativeLabel(entry.relative))
      : formatRangeLabel(
          { startUs: entry.startUs, endUs: entry.endUs },
          { ...labelOptions(), surface: "row" },
        );

  const entryRow = (
    entry: TimeRangeHistoryEntry,
    base: Pick<TimeRangeListRow, "id" | "kind" | "testId" | "label" | "meta">,
  ): TimeRangeListRow => {
    const range = entryRange(entry);
    const reason = range ? limitReason(range.startTime, range.endTime) : null;
    const tooltip = isRelativeHistoryEntry(entry)
      ? calendarTooltip(parseCalendarToken(entry.relative) ? entry.relative : null)
      : `${formatRangeStamps(entry, labelOptions())} ${formatZoneOffset(zone.value, entry.startUs / 1000)}`;
    return {
      ...base,
      meta: reason ?? base.meta,
      reason: reason !== null,
      tooltip: reason ?? (tooltip ? String(tooltip) : undefined),
      disabled: reason !== null,
      period: isRelativeHistoryEntry(entry) ? entry.relative : undefined,
    };
  };

  // "Nov 11, 00:00 – now" for today, "Nov 8 – now" for a period so far, "Nov 1 – 7" for a finished one.
  const calendarMeta = (token: string, range: { startTime: number; endTime: number }) => {
    const period = parseCalendarToken(token);
    if (period?.offset !== 0) {
      return formatRangeDates(
        { startUs: range.startTime, endUs: range.endTime, calendar: true },
        labelOptions(),
      );
    }
    const day = convertUnixTime(range.startTime).date;
    const start =
      period.unit === "day"
        ? `${dayLabel(day)} 00:00`
        : formatCivilDay(day, zone.value, tooltipNow.value, intlLocale.value);
    return String(t("common.timeRangeUntilNow", { start }));
  };

  // A live entry shows where it resolves now; a fixed one its length.
  const entryDuration = (entry: TimeRangeHistoryEntry) => {
    if (!isRelativeHistoryEntry(entry)) return formatRangeDuration(entry.startUs, entry.endUs);
    const range = resolveRelativePeriod(entry.relative, tooltipNow.value);
    if (!range) return "";
    return parseCalendarToken(entry.relative)
      ? calendarMeta(entry.relative, range)
      : String(t("common.timeRangeUntilNow", { start: formatShownInstant(range.startTime) }));
  };

  const pinnedRows = computed<TimeRangeListRow[]>(() => {
    if (!showRail.value) return [];
    return timeRangePins.pins.value.flatMap((pin) => {
      if (!isUsableRecentEntry(pin.range)) return [];
      const label = entryLabel(pin.range);
      return [
        entryRow(pin.range, {
          id: `pinned-${pin.id}`,
          kind: "pinned",
          testId: `date-time-list-pinned-${pin.id}`,
          label: pin.name || label,
          meta: pin.name ? label : entryDuration(pin.range),
        }),
      ];
    });
  });

  const calendarRows = computed<TimeRangeListRow[]>(() => {
    if (!props.calendarPresets || props.disableRelative) return [];
    return orderCalendarItems(CALENDAR_RAIL_ITEMS, props.preset).flatMap((preset) => {
      const range = resolveCalendarPeriod(preset.token, zone.value, tooltipNow.value);
      if (!range) return [];
      const reason = limitReason(range.startTime, range.endTime);
      const tooltip = calendarTooltip(preset.token);
      return [
        {
          id: `calendar-${preset.id}`,
          kind: "calendar" as const,
          label: String(t(preset.labelKey)),
          meta: reason ?? calendarMeta(preset.token, range),
          reason: reason !== null,
          tooltip: reason ?? (tooltip ? String(tooltip) : undefined),
          disabled: reason !== null,
          testId: `date-time-list-calendar-${preset.id}`,
          period: preset.token,
        },
      ];
    });
  });

  // Chips and rolling suggestions are periods, which a day-only or dates-only picker cannot apply.
  const showChips = computed(() => !props.disableRelative && !props.hideRelativeTime);

  const chipSet = computed(() => TIME_RANGE_CHIP_SETS[props.preset] ?? TIME_RANGE_CHIP_SETS.ops);

  const offeredElsewhere = computed<OfferedElsewhere>(() => ({
    pinned: timeRangePins.pins.value.map((pin) => pin.range),
    chips: showChips.value ? chipSet.value.map((chip) => chip.value) : [],
    calendarTokens: calendarRows.value.flatMap((row) => (row.period ? [row.period] : [])),
  }));

  const recentRows = computed<TimeRangeListRow[]>(() => {
    if (!showRail.value) return [];
    const entries = timeRangeHistory.entries.value;
    const shown = visibleRecentEntries(entries, {
      ...offeredElsewhere.value,
      applied: currentEntry.value,
    });
    return entries.flatMap((entry, index) => {
      if (!shown.includes(entry) || !isUsableRecentEntry(entry)) return [];
      return [
        entryRow(entry, {
          id: `recent-${index}`,
          kind: "recent",
          testId: `date-time-list-recent-${index}`,
          label: entryLabel(entry),
          meta: entryDuration(entry),
        }),
      ];
    });
  });

  const defaultRows = computed(() =>
    composeTimeRangeList([pinnedRows.value, recentRows.value, calendarRows.value]),
  );

  const chipItems = computed(() =>
    chipSet.value.map(({ value, label }) => {
      const range = resolveRelativePeriod(value, tooltipNow.value);
      const reason = range ? limitReason(range.startTime, range.endTime) : null;
      return { value, label, title: relativeLabel(value), disabled: reason !== null, reason };
    }),
  );

  const litChip = computed(() =>
    chipSet.value.some((chip) => chip.value === appliedPeriod.value) ? appliedPeriod.value : null,
  );

  // Notes at the strip's end: the page limit when it greys chips, and the query's narrowing, short when both show.
  const chipsNotes = computed(() => {
    const notes: { icon: string; text: string; tooltip: I18nText; testId: string }[] = [];
    if (chipItems.value.some((chip) => chip.disabled) && props.queryRangeRestrictionInHour > 0) {
      notes.push({
        icon: "lock",
        text: String(maxLimitText()),
        tooltip: restrictionMessage(),
        testId: "date-time-chips-note-limit",
      });
    }
    const narrowed = props.narrowedByQuery;
    if (!narrowed || !(narrowed.endUs > narrowed.startUs)) return notes;
    const range = formatRangeLabel(
      { startUs: narrowed.startUs, endUs: narrowed.endUs },
      { ...labelOptions(), surface: "row" },
    );
    notes.push({
      icon: "filter-alt",
      text: String(t(notes.length > 0 ? "dateTime.narrowed" : "dateTime.narrowedByQuery")),
      tooltip: t("dateTime.queryKeeps", { range }),
      testId: "date-time-chips-note-narrowed",
    });
    return notes;
  });

  // Recent never shows what a pin, chip or calendar row offers, so storing it would only push out ranges it does show.
  const recordEntry = (entry: TimeRangeHistoryEntry) => {
    if (isOfferedElsewhere(entry, offeredElsewhere.value)) return;
    if (isRelativeHistoryEntry(entry)) timeRangeHistory.addRelative(entry.relative);
    else timeRangeHistory.add(entry.startUs, entry.endUs);
  };

  const recentEntry = (id: string): TimeRangeHistoryEntry | undefined =>
    timeRangeHistory.entries.value[Number(id)];

  const removeRecentRange = (id: string) => {
    const entry = recentEntry(id);
    if (entry) timeRangeHistory.remove(entry);
  };

  const pinOf = (rowId: string) =>
    timeRangePins.pins.value.find((pin) => `pinned-${pin.id}` === rowId);

  const pinRecentRow = (rowId: string) => {
    const entry = recentEntry(rowId.slice("recent-".length));
    const id = entry ? timeRangePins.pin(entry) : null;
    if (id) editingPinRowId.value = `pinned-${id}`;
    listCursor.value = -1;
  };

  const unpinRow = (rowId: string) => {
    const pin = pinOf(rowId);
    if (pin) timeRangePins.unpin(pin.id);
    listCursor.value = -1;
  };

  const removeRecentRow = (rowId: string) => {
    removeRecentRange(rowId.slice("recent-".length));
    listCursor.value = -1;
  };

  // Saving or leaving the name returns focus to the bar, where the list keys work.
  const renamePin = (rowId: string, name: string) => {
    const pin = pinOf(rowId);
    if (pin) timeRangePins.rename(pin.id, name);
    editingPinRowId.value = null;
    nextTick(() => inputBar.value?.focus());
  };

  const cancelPinName = () => {
    editingPinRowId.value = null;
    nextTick(() => inputBar.value?.focus());
  };

  return {
    showRail,
    editingPinRowId,
    defaultRows,
    showChips,
    chipItems,
    litChip,
    chipsNotes,
    recordEntry,
    recentEntry,
    removeRecentRange,
    pinOf,
    pinRecentRow,
    unpinRow,
    removeRecentRow,
    renamePin,
    cancelPinName,
  };
}
