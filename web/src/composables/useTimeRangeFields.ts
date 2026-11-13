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

import { computed, nextTick, ref, type Ref } from "vue";
import { formatTypedTime, parseTypedTime } from "@/lib/forms/Time/parseTypedTime";
import { convertToUtcTimestamp } from "@/utils/zincutils";
import { parseCalendarToken } from "@/utils/dashboard/calendarPeriods";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { MICROS_PER_SECOND, type TimeRangeZone } from "@/composables/useTimeRangeZone";
import type { TimeRangeLimits } from "@/composables/useTimeRangeLimits";

type TimeField = "start" | "end";

interface ShownEnd {
  date: string;
  time: string;
}

export interface FieldsSnapshot {
  date: { from: string; to: string };
  time: { startTime: string; endTime: string };
  seededEnd: ShownEnd | null;
}

export interface TimeRangeFieldsDeps {
  clock: TimeRangeZone;
  limits: TimeRangeLimits;
  selectedType: Ref<string>;
  calendarToken: Ref<string | null>;
  pendingDay: Ref<string | null>;
  calendarPreviewDay: Ref<string | null>;
  menuOpen: Ref<boolean>;
  clearInput: () => void;
  // The absolute range a full stamp pasted into Start or End reads as, if any.
  readPastedStamp: (text: string) => { start: number; end: number } | null;
}

/** The Start/End fields: the civil dates and times they hold, the instants they stand for, and their edit rules. */
export default function useTimeRangeFields(deps: TimeRangeFieldsDeps) {
  const { t } = useI18nTyped();
  const { clock, limits, selectedType, calendarToken, pendingDay, calendarPreviewDay, menuOpen } =
    deps;
  const { zone, convertUnixTime, absoluteToMicros, endFieldToMicros, isZoneMidnight, dayLabel } =
    clock;
  const { selectionCeilingMicros, startBoundError, trustedRange } = limits;

  const selectedTime = ref({
    startTime: "00:00:00",
    endTime: "23:59:59",
  });
  const selectedDate = ref({
    from: "",
    to: "",
  });
  // Fields written by the picker itself (seeding Start/End, a Recent pick) are not user edits for auto-apply.
  let isSeedingAbsolute = false;
  let seededEnd: ShownEnd | null = null;
  // Civil fields hold a DST fall-back's repeated hour only once, so an applied instant they cannot show is kept while they stay as written.
  let heldInstants: { key: string; startUTC: number; endUTC: number } | null = null;
  // The End time a picked day not over yet replaced with now, restored if another day is picked instead.
  let endBeforeCut: string | null = null;
  // Text typed into Start or End commits on change, so the clock must not reseed a field still being typed in.
  const timeFieldFocused = ref(false);
  // The Start or End field whose last edit was refused, and why.
  const timeFieldError = ref<{ field: TimeField; message: I18nText } | null>(null);
  // Set only by each field's own @invalid, so an edit to the other field cannot unblock Apply.
  const unreadableFields = ref({ start: false, end: false });
  // A readable time still being typed in Start or End, previewed in the summary before the field commits it.
  const typedFieldTime = ref<{ field: TimeField; time: string; ms: boolean } | null>(null);

  const isSeeding = () => isSeedingAbsolute;

  const forgetSeededEnd = () => {
    seededEnd = null;
  };

  const forgetEndCut = () => {
    endBeforeCut = null;
  };

  const snapshotFields = (): FieldsSnapshot => ({
    date: { ...selectedDate.value },
    time: { ...selectedTime.value },
    seededEnd,
  });

  // The one way the picker writes its own Absolute fields; an omitted shown end keeps the current one.
  const writeSeededFields = (
    fields: { from: string; to: string; startTime?: string; endTime?: string },
    shownEnd?: ShownEnd | null,
  ) => {
    isSeedingAbsolute = true;
    selectedDate.value.from = fields.from;
    selectedDate.value.to = fields.to;
    if (fields.startTime !== undefined) selectedTime.value.startTime = fields.startTime;
    if (fields.endTime !== undefined) selectedTime.value.endTime = fields.endTime;
    if (shownEnd !== undefined) seededEnd = shownEnd;
    nextTick(() => {
      isSeedingAbsolute = false;
    });
  };

  const resetTime = (startTime: string, endTime: string) => {
    if (startTime && endTime) return;
    const dateString = new Date().toLocaleDateString("en-ZA");
    if (!selectedDate.value.from) selectedDate.value.from = dateString;
    if (!selectedDate.value.to) selectedDate.value.to = dateString;
    if (!startTime) selectedTime.value.startTime = "00:00:00";
    if (!endTime) {
      const endDateTime = convertUnixTime(new Date().getTime() * 1000);
      // A range ending today ends now.
      if (selectedDate.value.to === endDateTime.date) {
        selectedTime.value.endTime = endDateTime.time;
      } else selectedTime.value.endTime = "23:59:59";
    }
  };

  // A whole-second midnight end is the day before's 23:59:59 in the fields, which reads back as that midnight.
  const shownEndMicros = (startUs: number, endUs: number) =>
    endUs > startUs && endUs % MICROS_PER_SECOND === 0 && convertUnixTime(endUs).time === "00:00:00"
      ? endUs - MICROS_PER_SECOND
      : endUs;

  const writeAbsoluteFields = (startMicros: number, endMicros: number) => {
    const start = convertUnixTime(startMicros);
    const end = convertUnixTime(shownEndMicros(startMicros, endMicros));
    writeSeededFields(
      { from: start.date, to: end.date, startTime: start.time, endTime: end.time },
      null,
    );
  };

  const absoluteFieldsKey = () =>
    [
      zone.value,
      selectedDate.value.from,
      selectedTime.value.startTime,
      selectedDate.value.to,
      selectedTime.value.endTime,
    ].join(" ");

  const getUTCTimeStamp = () => {
    if (heldInstants?.key === absoluteFieldsKey()) {
      return { startUTC: heldInstants.startUTC, endUTC: heldInstants.endUTC };
    }
    const startUTC = absoluteToMicros(selectedDate.value.from, selectedTime.value.startTime);
    const untouchedSeededEnd =
      seededEnd !== null &&
      seededEnd.date === selectedDate.value.to &&
      seededEnd.time === selectedTime.value.endTime;
    const endUTC = endFieldToMicros(
      selectedDate.value.to,
      selectedTime.value.endTime,
      untouchedSeededEnd,
    );
    return { startUTC, endUTC };
  };

  // Exact, not floored: the fields show seconds, but the query keeps the sub-second bounds.
  const holdUnshownInstants = (startMicros: number, endMicros: number) => {
    heldInstants = null;
    const held = { startUTC: startMicros, endUTC: endMicros };
    const shown = getUTCTimeStamp();
    if (shown.startUTC === held.startUTC && shown.endUTC === held.endUTC) return;
    heldInstants = { key: absoluteFieldsKey(), ...held };
  };

  // A finished calendar period ends at the next one's start; second-precision fields show its last second, as its tooltip does.
  const lastInstant = (token: string | null, endUs: number) =>
    (parseCalendarToken(token)?.offset ?? 0) < 0 ? endUs - 1 : endUs;

  // The shown 23:59:59 of a copied calendar end stands for the next period's start until the user edits it.
  const rememberShownEnd = (exclusiveEndUs: number) => {
    const shown = convertUnixTime(exclusiveEndUs - 1);
    seededEnd = { date: shown.date, time: shown.time };
  };

  const rememberSeededEnd = (token: string | null, endUs: number) => {
    if ((parseCalendarToken(token)?.offset ?? 0) >= 0) seededEnd = null;
    else rememberShownEnd(endUs);
  };

  // "refused" when nothing was written, "corrected" when the end was cut to maxDate.
  const writeOutsideRange = (
    startTime: number,
    endTime: number,
  ): "kept" | "corrected" | "refused" => {
    seededEnd = null;
    if (!startTime || !endTime) {
      const dateString = new Date().toLocaleDateString("en-ZA");
      selectedDate.value.from = dateString;
      selectedDate.value.to = dateString;
      return "kept";
    }
    const range = trustedRange(Number(startTime), Number(endTime));
    if (!range) return "refused";

    const startDateTime = convertUnixTime(range.start);
    const endDateTime = convertUnixTime(shownEndMicros(range.start, range.end));

    selectedDate.value.from = startDateTime.date;
    selectedDate.value.to = endDateTime.date;

    selectedTime.value.startTime = startDateTime.time;
    selectedTime.value.endTime = endDateTime.time;
    holdUnshownInstants(range.start, range.end);
    return range.end === Number(endTime) ? "kept" : "corrected";
  };

  // Writes true instants as edits, not seeds, so an auto-apply picker saves them through its date watcher.
  const writeInstants = (startUs: number, endUs: number) => {
    const start = convertUnixTime(startUs);
    const end = convertUnixTime(shownEndMicros(startUs, endUs));
    seededEnd = null;
    selectedDate.value.from = start.date;
    selectedDate.value.to = end.date;
    selectedTime.value.startTime = start.time;
    selectedTime.value.endTime = end.time;
    holdUnshownInstants(startUs, endUs);
  };

  const clearTimeFieldErrors = () => {
    timeFieldError.value = null;
    unreadableFields.value = { start: false, end: false };
  };

  // An edit in Start/End makes the selection absolute; the shown values were the relative one's.
  const markAbsoluteEdit = () => {
    if (selectedType.value === "absolute") return;
    selectedType.value = "absolute";
    calendarToken.value = null;
  };

  const setWholeDayTimes = () => {
    selectedTime.value.startTime = "00:00:00";
    selectedTime.value.endTime = "23:59:59";
    seededEnd = null;
  };

  // A relative range's times were seeded, not chosen, so days picked from it cover whole days.
  const markCalendarEdit = () => {
    if (selectedType.value === "absolute") return;
    markAbsoluteEdit();
    setWholeDayTimes();
  };

  const timesReversedOn = (from: string, to: string, startTime: string, endTime: string) => {
    if (!startTime || !endTime) return false;
    const start = convertToUtcTimestamp(`${from} ${startTime}`, zone.value);
    const end = convertToUtcTimestamp(`${to} ${endTime}`, zone.value);
    return Number.isFinite(start) && Number.isFinite(end) && end <= start;
  };

  // A picked end past the calendar's last instant stops there, as the Today row stops at now; the cut-off time is kept for a later pick.
  const cutEndToCeiling = (to: string) => {
    const ceiling = selectionCeilingMicros();
    if (!Number.isFinite(ceiling)) return;
    const cut = convertUnixTime(ceiling);
    const end = convertToUtcTimestamp(`${to} ${selectedTime.value.endTime}`, zone.value);
    if (!(end > ceiling) || cut.date !== to) return;
    endBeforeCut ??= selectedTime.value.endTime;
    selectedTime.value.endTime = cut.time;
  };

  // Kept times on the picked days can run backwards or past now, so they fall back to whole days that stop at now.
  const fitPickedDays = (from: string, to: string) => {
    if (endBeforeCut !== null) selectedTime.value.endTime = endBeforeCut;
    endBeforeCut = null;
    cutEndToCeiling(to);
    const { startTime, endTime } = selectedTime.value;
    if (!timesReversedOn(from, to, startTime, endTime)) return;
    setWholeDayTimes();
    endBeforeCut = null;
    cutEndToCeiling(to);
  };

  const onCalendarStartDate = (value: string) => {
    markCalendarEdit();
    selectedDate.value.from = value;
  };

  const onCalendarEndDate = (value: string) => {
    markCalendarEdit();
    selectedDate.value.to = value;
    fitPickedDays(selectedDate.value.from, value);
    endBeforeCut = null;
  };

  // A clicked day replaces whatever the box read, and is staged as the whole day it will commit as.
  const onCalendarPendingDay = (value: string | null) => {
    pendingDay.value = value;
    if (value === null) return;
    markCalendarEdit();
    deps.clearInput();
    fitPickedDays(value, value);
  };

  // A single clicked day applies as that day.
  const commitPendingDay = (): boolean => {
    const day = pendingDay.value;
    pendingDay.value = null;
    if (!day || selectedType.value !== "absolute") return false;
    writeSeededFields({ from: day, to: day });
    fitPickedDays(day, day);
    endBeforeCut = null;
    return true;
  };

  // Whether the fields would read End at or before Start, on the pending day when one is clicked.
  const timesReversed = (startTime: string, endTime: string) => {
    const pending = menuOpen.value ? pendingDay.value : null;
    return timesReversedOn(
      pending ?? selectedDate.value.from,
      pending ?? selectedDate.value.to,
      startTime,
      endTime,
    );
  };

  // A Start typed at or past End moves the range: End follows at the same duration, stopped at now; null when that leaves End not after Start.
  const shiftedEnd = (startTime: string): ShownEnd | null => {
    const pending = menuOpen.value ? pendingDay.value : null;
    const from = pending ?? selectedDate.value.from;
    const to = pending ?? selectedDate.value.to;
    const oldStart = convertToUtcTimestamp(`${from} ${selectedTime.value.startTime}`, zone.value);
    const oldEnd = convertToUtcTimestamp(`${to} ${selectedTime.value.endTime}`, zone.value);
    const start = convertToUtcTimestamp(`${from} ${startTime}`, zone.value);
    const end = Math.min(start + Math.max(0, oldEnd - oldStart), selectionCeilingMicros());
    return end > start ? convertUnixTime(end) : null;
  };

  // A refused edit leaves the model alone, so the field shows the kept value again.
  const onStartTimeEdit = (value: string) => {
    typedFieldTime.value = null;
    const pending = menuOpen.value ? pendingDay.value : null;
    const from = pending ?? selectedDate.value.from;
    const bound = startBoundError(convertToUtcTimestamp(`${from} ${value}`, zone.value));
    if (bound !== null) {
      timeFieldError.value = { field: "start", message: bound };
      return;
    }
    if (timesReversed(value, selectedTime.value.endTime)) {
      const end = shiftedEnd(value);
      if (!end) {
        timeFieldError.value = { field: "start", message: t("common.timeRangeEndBeforeStart") };
        return;
      }
      // A moved End makes the clicked day a range of its own, committed like a settled one.
      pendingDay.value = null;
      selectedDate.value.from = from;
      selectedDate.value.to = end.date;
      selectedTime.value.endTime = end.time;
      seededEnd = null;
    }
    timeFieldError.value = null;
    endBeforeCut = null;
    markAbsoluteEdit();
    selectedTime.value.startTime = value;
  };

  const onEndTimeEdit = (value: string) => {
    typedFieldTime.value = null;
    if (timesReversed(selectedTime.value.startTime, value)) {
      timeFieldError.value = { field: "end", message: t("common.timeRangeEndBeforeStart") };
      return;
    }
    timeFieldError.value = null;
    endBeforeCut = null;
    markAbsoluteEdit();
    selectedTime.value.endTime = value;
  };

  // The field refuses milliseconds, so the preview says where they can be typed.
  const onTimeFieldTyping = (field: TimeField, event: Event) => {
    const text = (event.target as HTMLInputElement | null)?.value.trim() ?? "";
    const ms = /\.\d{1,3}$/.test(text);
    const parsed = parseTypedTime(ms ? text.replace(/\.\d{1,3}$/, "") : text);
    if (!parsed) {
      typedFieldTime.value = null;
      return;
    }
    const time = formatTypedTime(parsed);
    const current = field === "start" ? selectedTime.value.startTime : selectedTime.value.endTime;
    typedFieldTime.value = time === current && !ms ? null : { field, time, ms };
  };

  const onTimeFieldInvalid = (field: TimeField, invalid: boolean) => {
    if (invalid) typedFieldTime.value = null;
    unreadableFields.value[field] = invalid;
  };

  const onTimeFieldBlur = () => {
    typedFieldTime.value = null;
    timeFieldFocused.value = false;
    resetTime(selectedTime.value.startTime, selectedTime.value.endTime);
  };

  // A full stamp pasted into Start or End is read by the bar's parser and fills both fields.
  const pasteIntoTimeFields = (event: ClipboardEvent): boolean => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.closest("[data-test='date-time-start-end']")) {
      return false;
    }
    const text = event.clipboardData?.getData("text")?.trim() ?? "";
    const stamp = text ? deps.readPastedStamp(text) : null;
    if (!stamp) return false;
    event.preventDefault();
    markAbsoluteEdit();
    pendingDay.value = null;
    writeAbsoluteFields(
      stamp.start,
      isZoneMidnight(stamp.end) ? stamp.end - MICROS_PER_SECOND : stamp.end,
    );
    return true;
  };

  const startDayLabel = computed(() =>
    raw(dayLabel((menuOpen.value ? pendingDay.value : null) ?? selectedDate.value.from)),
  );

  // Mid-pick, End names the day under the pointer: the end a second pick would make.
  const endDayLabel = computed(() => {
    const pending = menuOpen.value ? pendingDay.value : null;
    const end = pending ? (calendarPreviewDay.value ?? pending) : selectedDate.value.to;
    return raw(dayLabel(end));
  });

  return {
    selectedTime,
    selectedDate,
    timeFieldFocused,
    timeFieldError,
    unreadableFields,
    typedFieldTime,
    isSeeding,
    forgetSeededEnd,
    forgetEndCut,
    snapshotFields,
    writeSeededFields,
    resetTime,
    shownEndMicros,
    writeAbsoluteFields,
    absoluteFieldsKey,
    getUTCTimeStamp,
    holdUnshownInstants,
    lastInstant,
    rememberShownEnd,
    rememberSeededEnd,
    writeOutsideRange,
    writeInstants,
    clearTimeFieldErrors,
    markAbsoluteEdit,
    onCalendarStartDate,
    onCalendarEndDate,
    onCalendarPendingDay,
    commitPendingDay,
    onStartTimeEdit,
    onEndTimeEdit,
    onTimeFieldTyping,
    onTimeFieldInvalid,
    onTimeFieldBlur,
    pasteIntoTimeFields,
    startDayLabel,
    endDayLabel,
  };
}

export type TimeRangeFields = ReturnType<typeof useTimeRangeFields>;
