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

import { computed, ref, type ComputedRef, type Ref } from "vue";
import { convertToUtcTimestamp } from "@/utils/zincutils";
import { parseCalendarToken, resolveCalendarPeriod } from "@/utils/dashboard/calendarPeriods";
import { formatDurationMicros } from "@/utils/timeRangeRail";
import { formatRangeDates, formatRangeDuration } from "@/utils/timeRangeLabel";
import { anchorWindowLabel, dropZeroMilliseconds } from "@/utils/timeRangeAnchor";
import { formatReadingNote, readingNote } from "@/utils/timeRangeNotes";
import type { ParsedTimeInput } from "@/utils/dateTimeRangeParse";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import {
  MICROS_PER_SECOND,
  addCivilDays,
  type TimeRangeZone,
} from "@/composables/useTimeRangeZone";
import type { InputPlan, SuggestionTag } from "@/composables/useTimeRangeTyping";
import type { TimeRangeFields } from "@/composables/useTimeRangeFields";

export interface SummaryLine {
  name: string;
  range: string;
  duration: string;
  live?: boolean;
  fixed?: boolean;
  note?: string;
  warning?: boolean;
  ready?: boolean;
}

export interface TimeRangeSummaryProps {
  disableRelative: boolean;
  hideRelativeTime: boolean;
  queryRangeRestrictionInHour: number;
}

export interface TimeRangeSummaryDeps {
  clock: TimeRangeZone;
  fields: TimeRangeFields;
  typing: {
    inputText: Ref<string>;
    inputError: Ref<boolean>;
    inputReversed: Ref<boolean>;
    inputFuture: Ref<boolean>;
    inputAsUtc: Ref<boolean>;
    inputReading: Ref<ParsedTimeInput | null>;
    shownReading: ComputedRef<ParsedTimeInput | null>;
    inputPlan: ComputedRef<InputPlan | null>;
    shownTag: ComputedRef<SuggestionTag>;
  };
  selectedType: Ref<string>;
  pendingDay: Ref<string | null>;
  calendarPreviewDay: Ref<string | null>;
  calendarMode: Ref<boolean>;
  menuOpen: Ref<boolean>;
  pendingRange: ComputedRef<{ startTime: number; endTime: number } | null>;
  currentRelativePeriod: () => string;
}

/** The panel's summary row: the selection as it resolves, or what Enter or a half-finished pick would apply. */
export default function useTimeRangeSummary(
  props: TimeRangeSummaryProps,
  deps: TimeRangeSummaryDeps,
) {
  const { t } = useI18nTyped();
  const { clock, fields, typing, selectedType, pendingDay, menuOpen, pendingRange } = deps;
  const { zone, intlLocale, tooltipNow, labelOptions, relativeLabel, convertUnixTime } = clock;
  const { inputText, inputAsUtc, inputReading, shownReading, shownTag } = typing;

  // A fixed range drawn in another zone after a zone change; it names the same instants.
  const zoneRedrawn = ref(false);

  const kindText = (live: boolean | undefined) =>
    String(live ? t("dateTime.tagLive") : t("dateTime.fixed"));

  // Whole civil days from the first to the last day the range touches, as a day-only trigger shows it.
  const resolvedDays = (range: { startTime: number; endTime: number }): SummaryLine => {
    const from = convertUnixTime(range.startTime).date;
    // An exclusive midnight end belongs to the day before.
    const to = convertUnixTime(
      clock.isZoneMidnight(range.endTime) && range.endTime > range.startTime
        ? range.endTime - 1
        : range.endTime,
    ).date;
    const days =
      Math.round(
        (Date.parse(to.replace(/\//g, "-")) - Date.parse(from.replace(/\//g, "-"))) / 86_400_000,
      ) + 1;
    return {
      name: formatRangeDates(
        {
          startUs: convertToUtcTimestamp(`${from} 00:00:00`, zone.value),
          endUs: convertToUtcTimestamp(`${to} 23:59:59`, zone.value),
        },
        labelOptions(),
      ),
      range: "",
      duration: formatDurationMicros(Math.max(1, days) * 86_400 * MICROS_PER_SECOND),
    };
  };

  // A fixed range is its dates alone, never a period name.
  const fixedLine = (start: number, end: number): SummaryLine => {
    return {
      name: formatRangeDates({ startUs: start, endUs: end }, labelOptions()),
      range: "",
      duration: formatRangeDuration(start, end),
      fixed: !props.disableRelative,
    };
  };

  // A calendar period with no name of its own (`2w ago`) is named by its dates, which then show once.
  const liveLine = (
    period: string,
    start: number,
    end: number,
    typedName?: string,
  ): SummaryLine => {
    const name = typedName ?? String(relativeLabel(period));
    const range = formatRangeDates(
      { startUs: start, endUs: end, live: true, calendar: parseCalendarToken(period) !== null },
      labelOptions(),
    );
    const same = range.replace(/\s/g, "") === name.replace(/\s/g, "");
    return { name, range: same ? "" : range, duration: "", live: true };
  };

  const resolvedLine = computed<SummaryLine>(() => {
    const range = pendingRange.value;
    if (!range || !Number.isFinite(range.startTime) || !Number.isFinite(range.endTime)) {
      return { name: "", range: "", duration: "" };
    }
    if (props.hideRelativeTime) return resolvedDays(range);
    if (selectedType.value === "relative" && !props.disableRelative) {
      return liveLine(deps.currentRelativePeriod(), range.startTime, range.endTime);
    }
    const line = fixedLine(range.startTime, range.endTime);
    return zoneRedrawn.value ? { ...line, note: String(t("dateTime.sameWindow")) } : line;
  });

  const noteFor = (reading: ParsedTimeInput | null, asUtc: boolean): string => {
    if (asUtc) return String(formatReadingNote({ kind: "utc" }, t, intlLocale.value, zone.value));
    const note = reading ? readingNote(reading, zone.value) : null;
    return note ? String(formatReadingNote(note, t, intlLocale.value, zone.value)) : "";
  };

  const rollingLine = (
    period: string,
    startTime: number,
    cut = false,
    fromCalendar = false,
  ): SummaryLine => {
    const line = liveLine(period, startTime, tooltipNow.value * 1000);
    const note = cut ? t("dateTime.cutToTenYears") : fromCalendar ? t("dateTime.rollingHere") : "";
    return { ...line, note: String(note), ready: true };
  };

  const absoluteLine = (start: number, end: number, cutToNow = false): SummaryLine => {
    if (props.hideRelativeTime)
      return { ...resolvedDays({ startTime: start, endTime: end }), ready: true };
    const reading = shownReading.value;
    const line = fixedLine(start, end);
    const tag = shownTag.value;
    if (tag && "anchor" in tag && tag.anchor !== "to-now" && reading?.type === "timestamp") {
      const centre = reading.centreMicros ?? (start + end) / 2;
      line.name = String(
        t("dateTime.aroundInstant", {
          window: String(anchorWindowLabel(tag.anchor, t)),
          instant: dropZeroMilliseconds(clock.formatExactInstant(centre)),
        }),
      );
      line.range = "";
      line.duration = "";
    }
    const first = inputReading.value;
    if (tag && "longestAllowed" in tag) {
      return {
        ...line,
        note: String(overLimitNote(inputText.value.trim())),
        warning: true,
        ready: true,
      };
    }
    const notes = [noteFor(tag ? first : reading, inputAsUtc.value)];
    if (cutToNow) notes.push(String(t("dateTime.cutToNow")));
    return { ...line, note: notes.filter(Boolean).join(" · "), ready: true };
  };

  const calendarLine = (token: string, typedName?: string): SummaryLine | null => {
    const range = resolveCalendarPeriod(token, zone.value, tooltipNow.value);
    if (!range) return null;
    if (props.hideRelativeTime) {
      return {
        ...absoluteLine(range.startTime, range.endTime),
        name: typedName ?? String(relativeLabel(token)),
      };
    }
    const line = liveLine(token, range.startTime, range.endTime, typedName);
    // A typed fiscal year keeps its note when it applies as this year.
    const note = typedName ? noteFor(shownReading.value, false) : "";
    return { ...line, note, ready: true };
  };

  const overLimitNote = (typed: string): I18nText => {
    const hours = props.queryRangeRestrictionInHour;
    const limit =
      hours % 24 === 0
        ? t("dateTime.limitDays", { n: hours / 24 })
        : t("dateTime.limitHours", { n: hours });
    return t("dateTime.overLimit", { typed, limit });
  };

  // Mid-pick in the calendar: the start day through the day under the pointer or focus.
  const calendarPickLine = computed<SummaryLine | null>(() => {
    const day = menuOpen.value && deps.calendarMode.value ? pendingDay.value : null;
    if (day === null) return null;
    const other = deps.calendarPreviewDay.value ?? day;
    const [first, last] = other < day ? [other, day] : [day, other];
    const start = clock.civilDayStart(first);
    const end = clock.civilDayStart(addCivilDays(last, 1));
    return { ...fixedLine(start, end), note: String(t("dateTime.pickEndDate")) };
  });

  // The range the fields would make with the time being typed, before the field commits it.
  const typedFieldLine = computed<SummaryLine | null>(() => {
    const typed = menuOpen.value && deps.calendarMode.value ? fields.typedFieldTime.value : null;
    const range = pendingRange.value;
    if (!typed || !range) return null;
    const day =
      pendingDay.value ?? fields.selectedDate.value[typed.field === "start" ? "from" : "to"];
    const start =
      typed.field === "start" ? clock.absoluteToMicros(day, typed.time) : range.startTime;
    const end = typed.field === "end" ? clock.endFieldToMicros(day, typed.time) : range.endTime;
    if (!(end > start)) return null;
    const line = fixedLine(start, end);
    // The duration tag gives way to this long note, as it is the first part of the row to go.
    return typed.ms ? { ...line, duration: "", note: String(t("dateTime.secondsOnlyHere")) } : line;
  });

  const reversedLine = (): SummaryLine | null =>
    typing.inputReversed.value && inputText.value.trim() && !typing.inputError.value
      ? {
          name: "",
          range: "",
          duration: "",
          note: String(t("common.timeRangeEndBeforeStart")),
          warning: true,
        }
      : null;

  const futureLine = (): SummaryLine | null =>
    typing.inputFuture.value && inputText.value.trim() && !typing.inputError.value
      ? {
          name: "",
          range: "",
          duration: "",
          note: String(t("common.timeRangeStartInFuture")),
          warning: true,
        }
      : null;

  // What Enter would apply, in the summary row; the panel's buttons and calendar keep showing the applied range.
  const previewLine = computed<SummaryLine | null>(() => {
    if (typedFieldLine.value) return typedFieldLine.value;
    if (calendarPickLine.value) return calendarPickLine.value;
    const plan = typing.inputPlan.value;
    if (!plan) return reversedLine() ?? futureLine();
    if (plan.kind === "refused" || plan.kind === "restricted") {
      const overLimit = plan.kind === "restricted" && !plan.retention;
      const message = overLimit ? overLimitNote(inputText.value.trim()) : plan.message;
      return { name: "", range: "", duration: "", note: String(message), warning: true };
    }
    if (plan.kind === "rolling") {
      const line = rollingLine(
        `${plan.value}${plan.unit}`,
        plan.startTime,
        plan.cut,
        plan.fromCalendar,
      );
      const tag = shownTag.value;
      if (!tag || !("longestAllowed" in tag)) return line;
      return { ...line, note: String(overLimitNote(inputText.value.trim())), warning: true };
    }
    if (plan.kind === "calendar") return calendarLine(plan.token, plan.name);
    return absoluteLine(plan.start, plan.end, plan.cutToNow);
  });

  const shownLine = computed<SummaryLine>(() => previewLine.value ?? resolvedLine.value);

  return {
    zoneRedrawn,
    kindText,
    resolvedLine,
    previewLine,
    shownLine,
  };
}
