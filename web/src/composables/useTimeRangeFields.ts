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
import { parseTimeInput } from "@/utils/dateTimeRangeParse";
import { readingAnchorMicros } from "@/utils/timeRangeAnchor";
import { formatCivilDayPrefix } from "@/utils/timeRangeRail";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { MICROS_PER_SECOND, type TimeRangeZone } from "@/composables/useTimeRangeZone";
import type { TimeRangeLimits } from "@/composables/useTimeRangeLimits";

type TimeField = "start" | "end";

// A clock time alone, with an optional fraction: it keeps the day the field already shows.
const CLOCK_ONLY_RE = /^([\d:]+?)(?:\.(\d{1,6}))?$/;
// The fields are read back by the parser, which knows English month names only.
const FIELD_LOCALE = "en-US";

interface ShownEnd {
  date: string;
  time: string;
}

export interface FieldsSnapshot {
  date: { from: string; to: string };
  time: { startTime: string; endTime: string };
  seededEnd: ShownEnd | null;
  // The exact instants the fields stood for, where they hold bounds the fields cannot show.
  instants?: { start: number; end: number } | null;
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

const fractionMicros = (digits: string | undefined): number =>
  digits ? Math.round(Number(`0.${digits}`) * MICROS_PER_SECOND) : 0;

const msOf = (micros: number) =>
  Math.floor((((micros % MICROS_PER_SECOND) + MICROS_PER_SECOND) % MICROS_PER_SECOND) / 1000);

/** The Start/End fields: the civil dates and times they hold, the instants they stand for, and their edit rules. */
export default function useTimeRangeFields(deps: TimeRangeFieldsDeps) {
  const { t } = useI18nTyped();
  const { clock, limits, selectedType, calendarToken, pendingDay, calendarPreviewDay, menuOpen } =
    deps;
  const { zone, tooltipNow, convertUnixTime, absoluteToMicros, endFieldToMicros, isZoneMidnight } =
    clock;
  const { selectionCeilingMicros, startBoundError, endBoundError, trustedRange } = limits;

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
  // Set only by each field's own commit, so an edit to the other field cannot unblock Apply.
  const unreadableFields = ref({ start: false, end: false });
  // A readable instant still being typed in Start or End, previewed in the summary before the field commits it.
  const typedFieldTime = ref<{ field: TimeField; micros: number } | null>(null);
  // Text typed into a field and not yet taken; a refused edit drops it so the field shows the kept value.
  const fieldDrafts = ref<Record<TimeField, string | null>>({ start: null, end: null });

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
    instants:
      heldInstants?.key === absoluteFieldsKey()
        ? { start: heldInstants.startUTC, end: heldInstants.endUTC }
        : null,
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

  // Puts back a snapshot, with its exact instants, so an edit since then leaves no held bound behind.
  const restoreFields = (snapshot: FieldsSnapshot) => {
    writeSeededFields({ ...snapshot.date, ...snapshot.time }, snapshot.seededEnd);
    heldInstants = null;
    if (snapshot.instants) holdUnshownInstants(snapshot.instants.start, snapshot.instants.end);
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
    fieldDrafts.value = { start: null, end: null };
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
    markAbsoluteEdit();
    selectedDate.value.from = value;
  };

  // The second pick ends its day at 23:59:59; Start keeps what the first pick or a typed time set.
  const onCalendarEndDate = (value: string) => {
    markAbsoluteEdit();
    selectedDate.value.to = value;
    selectedTime.value.endTime = "23:59:59";
    seededEnd = null;
    endBeforeCut = null;
    fitPickedDays(selectedDate.value.from, value);
    endBeforeCut = null;
  };

  // A first pick starts a new range at 00:00, whatever times the old one had, and is staged as that whole day.
  const onCalendarPendingDay = (value: string | null) => {
    pendingDay.value = value;
    if (value === null) return;
    markAbsoluteEdit();
    deps.clearInput();
    setWholeDayTimes();
    endBeforeCut = null;
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

  const pendingShown = () => (menuOpen.value ? pendingDay.value : null);

  // The day each field stands on; mid-pick, End is the day under the pointer: the end a second pick would make.
  const fieldDate = (field: TimeField): string => {
    const pending = pendingShown();
    if (field === "start") return pending ?? selectedDate.value.from;
    return pending ? (calendarPreviewDay.value ?? pending) : selectedDate.value.to;
  };

  // The instants the fields hold, on the pending day when one is clicked; an edit there writes exact instants.
  const fieldInstants = (): { start: number; end: number } => {
    const pending = pendingShown();
    const { from, to } = selectedDate.value;
    if (pending === null || (from === pending && to === pending)) {
      const { startUTC, endUTC } = getUTCTimeStamp();
      return { start: startUTC, end: endUTC };
    }
    return {
      start: absoluteToMicros(pending, selectedTime.value.startTime),
      end: endFieldToMicros(pending, selectedTime.value.endTime),
    };
  };

  // Text that reads back to the same instant: seconds and milliseconds only when present.
  const formatFieldStamp = (date: string, time: string, ms: number): string => {
    const clockText = ms
      ? `${time}.${String(ms).padStart(3, "0")}`
      : time.endsWith(":00")
        ? time.slice(0, 5)
        : time;
    return `${formatCivilDayPrefix(date, zone.value, tooltipNow.value, FIELD_LOCALE)} ${clockText}`;
  };

  const fieldText = (field: TimeField): string => {
    const time = field === "start" ? selectedTime.value.startTime : selectedTime.value.endTime;
    const { start, end } = fieldInstants();
    const at = field === "start" ? start : shownEndMicros(start, end);
    const civil = convertUnixTime(at);
    if (pendingShown() === null) return formatFieldStamp(civil.date, civil.time, msOf(at));
    const day = fieldDate(field);
    return formatFieldStamp(day, time, civil.date === day && civil.time === time ? msOf(at) : 0);
  };

  const startFieldText = computed(() => fieldDrafts.value.start ?? fieldText("start"));
  const endFieldText = computed(() => fieldDrafts.value.end ?? fieldText("end"));

  // A shown 23:59:59 in End is the whole last second, as the fields write an exclusive midnight.
  const throughLastSecond = (field: TimeField, micros: number): number =>
    field === "end" &&
    micros % MICROS_PER_SECOND === 0 &&
    convertUnixTime(micros).time === "23:59:59"
      ? micros + MICROS_PER_SECOND
      : micros;

  const pointOf = (text: string, ceilingMs?: number): number | null => {
    const reading = parseTimeInput(text, { now: new Date(), timeZone: zone.value, ceilingMs });
    return reading ? readingAnchorMicros(reading, zone.value) : null;
  };

  // The fields omit the current year, so yearless text keeps the field's year: an End later this year is not last year's.
  const readFieldPoint = (field: TimeField, text: string): number | null => {
    const past = pointOf(text);
    const ahead = pointOf(text, Number.POSITIVE_INFINITY);
    if (ahead === null || ahead === past) return past;
    const year = fieldDate(field).slice(0, 4);
    const inYear = (us: number | null) => us !== null && convertUnixTime(us).date.startsWith(year);
    return inYear(past) || !inYear(ahead) ? past : ahead;
  };

  // A clock time alone keeps the field's day; other text goes through the bar's point parser in the picker zone.
  const readFieldText = (field: TimeField, text: string): number | null => {
    const typed = text.trim();
    if (!typed) return null;
    const clockOnly = CLOCK_ONLY_RE.exec(typed);
    const clockTime = clockOnly ? parseTypedTime(clockOnly[1]) : null;
    if (clockOnly && clockTime) {
      const at = absoluteToMicros(fieldDate(field), formatTypedTime(clockTime));
      return throughLastSecond(field, at + fractionMicros(clockOnly[2]));
    }
    const anchor = readFieldPoint(field, typed);
    if (anchor !== null) return throughLastSecond(field, Math.round(anchor));
    const stamp = deps.readPastedStamp(typed);
    if (!stamp) return null;
    return field === "start" ? stamp.start : stamp.end;
  };

  const onFieldInput = (field: TimeField, value: string | number) => {
    const text = String(value);
    fieldDrafts.value[field] = text;
    const at = text.trim() === fieldText(field) ? null : readFieldText(field, text);
    if (at !== null) unreadableFields.value[field] = false;
    typedFieldTime.value = at === null ? null : { field, micros: at };
  };

  const refuseField = (field: TimeField, message: I18nText) => {
    timeFieldError.value = { field, message };
    fieldDrafts.value[field] = null;
  };

  // A Start typed at or past End moves the range: End follows at the same duration, stopped at the ceiling.
  const rangeAfterEdit = (field: TimeField, at: number): { start: number; end: number } | null => {
    const current = fieldInstants();
    if (field === "end") return at > current.start ? { start: current.start, end: at } : null;
    if (at < current.end) return { start: at, end: current.end };
    const moved = Math.min(at + Math.max(0, current.end - current.start), selectionCeilingMicros());
    return moved > at ? { start: at, end: moved } : null;
  };

  // A refused edit leaves the model alone; unreadable text stays in the field, marked, and blocks Apply.
  const commitFieldText = (field: TimeField, text: string) => {
    typedFieldTime.value = null;
    if (text.trim() === fieldText(field)) {
      fieldDrafts.value[field] = null;
      unreadableFields.value[field] = false;
      return;
    }
    const at = readFieldText(field, text);
    if (at === null) {
      fieldDrafts.value[field] = text;
      unreadableFields.value[field] = true;
      return;
    }
    unreadableFields.value[field] = false;
    const bound = field === "start" ? startBoundError(at) : endBoundError(at);
    if (bound !== null) return refuseField(field, bound);
    const range = rangeAfterEdit(field, at);
    if (!range) return refuseField(field, t("common.timeRangeEndBeforeStart"));
    timeFieldError.value = null;
    fieldDrafts.value[field] = null;
    endBeforeCut = null;
    // A clicked day stays a whole-day pick while the edit keeps the range on it.
    const pending = pendingShown();
    const shownEnd = shownEndMicros(range.start, range.end);
    const onPending = [range.start, shownEnd].every((us) => convertUnixTime(us).date === pending);
    if (!onPending) pendingDay.value = null;
    markAbsoluteEdit();
    writeInstants(range.start, range.end);
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
    // A lone instant is one field's value, so it pastes as text; a range fills both fields.
    const reading = text ? parseTimeInput(text, { now: new Date(), timeZone: zone.value }) : null;
    if (reading && readingAnchorMicros(reading, zone.value) !== null) return false;
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
    restoreFields,
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
    fieldInstants,
    startFieldText,
    endFieldText,
    readFieldText,
    onFieldInput,
    commitFieldText,
    onTimeFieldBlur,
    pasteIntoTimeFields,
  };
}

export type TimeRangeFields = ReturnType<typeof useTimeRangeFields>;
