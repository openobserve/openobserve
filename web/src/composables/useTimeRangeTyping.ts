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
import { useStore } from "vuex";
import {
  parseCalendarToken,
  resolveCalendarPeriod,
  type CalendarUnit,
} from "@/utils/dashboard/calendarPeriods";
import { exceedsRangeRestriction, formatZoneAbbreviation } from "@/utils/timeRangeRail";
import {
  TIME_INPUT_EXAMPLES,
  filterTimeRangeList,
  formatLimitShorthand,
  stepListCursor,
  type TimeRangeListRow,
} from "@/utils/timeRangeList";
import {
  formatRangeDates,
  formatRangeDuration,
  formatRangeLabel,
  formatZoneOffset,
} from "@/utils/timeRangeLabel";
import {
  DEFAULT_ANCHOR_WINDOW,
  anchorRows,
  anchorSearchAroundChoice,
  anchorWindowLabel,
  dropZeroMilliseconds,
  readingAnchorMicros,
  type AnchorRow,
} from "@/utils/timeRangeAnchor";
import { reportParseFailure } from "@/utils/timeInputFailure";
import {
  currentSearchAroundUser,
  readSearchAroundChoice,
  searchAroundAnchorId,
  writeSearchAroundChoice,
} from "@/utils/searchAroundWindow";
import {
  SINGLE_WINDOW_MICROS,
  explainTimeInputFailure,
  parseRollingPeriod,
  parseTimeInput,
  resolveZonedCivil,
  suggestTimeInput,
  type AbsoluteRangeResult,
  type ParsedTimeInput,
} from "@/utils/dateTimeRangeParse";
import { formatTimeInputText } from "@/utils/timeInputText";
import { isInputFocused, isMacOS } from "@/utils/keyboardShortcuts";
import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { TimeRangeZone } from "@/composables/useTimeRangeZone";
import { MAX_CUSTOM_RELATIVE_VALUE, type TimeRangeLimits } from "@/composables/useTimeRangeLimits";
import { MICROS_PER_HOUR } from "@/composables/useTimeRangeZone";

// Typed text is read this long after the last keystroke, so the preview does not flicker per key.
const INPUT_READ_DELAY_MS = 100;
const MAX_SUGGESTIONS = 5;
// A clock time alone (`11:38`), which reads as an instant whichever half of the day it means.
const LONE_CLOCK_RE = /^\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
// An end cut by less than this is clock drift between reading and planning, not a cut worth a note.
const CUT_NOTE_MIN_MICROS = 1_000_000;
// A recurring picker offers a typed calendar word's length as a rolling range, so it never freezes into dates.
const ROLLING_EQUIVALENT: Record<CalendarUnit, string> = {
  day: "1d",
  week: "7d",
  month: "30d",
  quarter: "90d",
  year: "365d",
};

// What Enter would do with a reading, worked out once so the preview and Enter never disagree.
// `cut`: a rolling count lowered to its cap, or an absolute end cut to now; `name`: a typed period name (`Q4 2026`).
// `fromCalendar`: a calendar word offered as its rolling length on a picker that opts into it.
export type InputPlan =
  | {
      kind: "rolling";
      unit: string;
      value: number;
      startTime: number;
      endTime: number;
      cut?: boolean;
      fromCalendar?: boolean;
    }
  | { kind: "calendar"; token: string; name?: string }
  | {
      kind: "absolute";
      start: number;
      end: number;
      calendarPeriod: string | null;
      cutToNow?: boolean;
      name?: string;
    }
  | { kind: "refused"; message: I18nText }
  | {
      kind: "restricted";
      message: I18nText;
      // The row's greyed meta: `Max 1d`, or `Outside 3-day retention` when `retention`.
      reason: string;
      retention?: boolean;
      range?: { start: number; end: number };
    };

interface TimeInputSuggestionRow {
  key: string;
  label: string;
  hint: string;
  relative: boolean;
  named?: boolean;
  cut?: boolean;
}

// What a typed-text row stands for beyond its reading: a window around a pasted instant, or the longest range a limit allows.
export type SuggestionTag = { anchor: AnchorRow["id"] } | { longestAllowed: true } | null;

export interface TimeRangeTypingProps {
  disableRelative: boolean;
  calendarPresets: boolean;
  queryRangeRestrictionInHour: number;
  maxDate?: string;
  // Recurring pickers only: `yesterday` and `last week` become their rolling length, not that exact period.
  rollingCalendarWords?: boolean;
  // A yearless date may read as upcoming only where the calendar itself offers days after today.
  futureAllowed?: boolean;
}

export interface TimeRangeTypingDeps {
  clock: TimeRangeZone;
  limits: TimeRangeLimits;
  relativePeriods: { value: string }[];
  relativePeriodsMaxValue: Ref<Record<string, number>>;
  showsZone: ComputedRef<boolean>;
  menuOpen: Ref<boolean>;
  listCursor: Ref<number>;
  inputBar: Ref<{ focus: () => void } | null>;
  defaultRows: ComputedRef<TimeRangeListRow[]>;
  applyPlan: (plan: InputPlan) => void;
  // Closes the panel once a reading applied.
  finish: () => void;
  pickListRow: (index: number) => void;
  removeRecentRow: (rowId: string) => void;
  pinRecentRow: (rowId: string) => void;
  unpinRow: (rowId: string) => void;
}

/** Reads the text typed or pasted into the bar, offers its readings as list rows, and moves the list cursor by key. */
export default function useTimeRangeTyping(props: TimeRangeTypingProps, deps: TimeRangeTypingDeps) {
  const store = useStore();
  const { t } = useI18nTyped();
  const { clock, limits, menuOpen, listCursor, inputBar, defaultRows } = deps;
  const {
    zone,
    intlLocale,
    tooltipNow,
    refreshTooltipNow,
    labelOptions,
    relativeLabel,
    rollingRange,
    absoluteToMicros,
    convertUnixTime,
    formatClockSpan,
  } = clock;
  const {
    startBoundError,
    selectionCeilingMicros,
    calendarExceedsRestriction,
    restrictionMessage,
    maxLimitText,
    limitReason,
  } = limits;

  const inputText = ref("");
  const inputError = ref(false);
  // Why readable text was refused, shown instead of the generic unreadable message.
  const inputRefusal = ref<I18nText | null>(null);
  // A stamped range with its end not after its start reads as nothing, so the summary row says why.
  const inputReversed = ref(false);
  // Text that reads only as a future time, which Enter would refuse; the preview says so first.
  const inputFuture = ref(false);
  const inputErrorText = computed(() => inputRefusal.value ?? t("common.timeRangeInputError"));
  const inputAsUtc = ref(false);
  // The bar's current reading and its alternatives; nothing applies until Enter or a pick.
  const inputReading = ref<ParsedTimeInput | null>(null);
  const inputSuggestions = ref<ParsedTimeInput[]>([]);
  const suggestionTags = ref<SuggestionTag[]>([]);
  // The one row shown is the bar's own reading, not a list of alternatives.
  const readingOnly = ref(false);
  const activeSuggestion = ref(0);
  const suggestionsDismissed = ref(false);
  let readTimer: ReturnType<typeof setTimeout> | null = null;
  // Reactive twin of readTimer, so the examples wait until the typed text has been read.
  const readPending = ref(false);
  // A paste replaces the bar's text only when Enter or a paste last read exactly that text.
  let lastReadText = "";

  const cancelPendingRead = () => {
    if (readTimer !== null) clearTimeout(readTimer);
    readTimer = null;
    readPending.value = false;
  };

  const clearInput = () => {
    cancelPendingRead();
    inputText.value = "";
    inputError.value = false;
    inputRefusal.value = null;
    inputAsUtc.value = false;
    inputReading.value = null;
    inputSuggestions.value = [];
    activeSuggestion.value = 0;
    suggestionsDismissed.value = false;
    lastReadText = "";
  };

  // How far a start in a DST gap was moved forward: `02:30` used as `03:30` is one hour.
  const gapShiftMicros = (range: AbsoluteRangeResult, zoneName: string): number => {
    const resolved = resolveZonedCivil(range.startDate, range.startTime, zoneName);
    if (resolved.kind !== "gap") return 0;
    const seconds = (time: string) =>
      time.split(":").reduce((total, part) => total * 60 + Number(part), 0);
    const shift = (seconds(resolved.usedTime) - seconds(range.startTime) + 86_400) % 86_400;
    return shift * 1_000_000;
  };

  const zonelessToMicros = (range: AbsoluteRangeResult, asUtc: boolean) => {
    if (range.exact && !asUtc)
      return { start: range.exact.startMicros, end: range.exact.endMicros };
    const zoneName = asUtc ? "UTC" : zone.value;
    if (range.centre) {
      const centre = absoluteToMicros(range.centre.date, range.centre.time, zoneName);
      return { start: centre - SINGLE_WINDOW_MICROS, end: centre + SINGLE_WINDOW_MICROS };
    }
    const start = absoluteToMicros(range.startDate, range.startTime, zoneName);
    const end = absoluteToMicros(range.endDate, range.endTime, zoneName);
    // A start moved forward out of a DST gap can pass its end; the end moves by the same gap.
    return { start, end: end > start ? end : end + gapShiftMicros(range, zoneName) };
  };

  const refusedPlan = (message: I18nText): InputPlan => ({ kind: "refused", message });

  const overLimitPlan = (start: number, end: number): InputPlan => ({
    kind: "restricted",
    message: restrictionMessage(),
    reason: String(maxLimitText()),
    range: { start, end },
  });

  // A 1 µs span at the end tests retention alone: only a range wholly before it is greyed.
  const outsideRetentionPlan = (start: number, end: number): InputPlan | null => {
    const reason = limitReason(end - 1, end);
    if (reason === null) return null;
    return {
      kind: "restricted",
      message: raw(reason),
      reason,
      retention: true,
      range: { start, end },
    };
  };

  // An unbounded ceiling is kept only where the calendar offers future days; elsewhere now caps typed text.
  const ceilingMicros = (): number => {
    const ceiling = selectionCeilingMicros();
    return Number.isFinite(ceiling) || props.futureAllowed ? ceiling : Date.now() * 1000;
  };

  // Only the start is bounded: an end past the ceiling is cut to it.
  const planAbsolute = (
    start: number,
    rawEnd: number,
    calendarPeriod: string | null = null,
    name?: string,
  ): InputPlan => {
    if (!Number.isFinite(start) || !Number.isFinite(rawEnd)) {
      return refusedPlan(t("common.timeRangeInputError"));
    }
    const ceiling = ceilingMicros();
    // A start out of bounds is named first, so `since` a future date says so rather than blaming the end.
    const refusal =
      startBoundError(start) ??
      (start >= ceiling ? t("common.timeRangeStartInFuture") : null) ??
      (rawEnd <= start ? t("common.timeRangeEndBeforeStart") : null);
    if (refusal !== null) return refusedPlan(refusal);
    const end = Math.min(rawEnd, ceiling);
    const outside = outsideRetentionPlan(start, end);
    if (outside) return outside;
    if (exceedsRangeRestriction(start, end, props.queryRangeRestrictionInHour)) {
      return overLimitPlan(start, end);
    }
    const cutToNow = !props.maxDate && rawEnd - end > CUT_NOTE_MIN_MICROS;
    return {
      kind: "absolute",
      start,
      end,
      calendarPeriod,
      ...(cutToNow ? { cutToNow } : {}),
      ...(name ? { name } : {}),
    };
  };

  // A running period typed by name stays its dates where the picker has no calendar presets.
  const planCalendar = (token: string, name?: string): InputPlan => {
    const range = resolveCalendarPeriod(token, zone.value);
    if (!range) return refusedPlan(t("common.timeRangeInputError"));
    if (!props.calendarPresets || props.disableRelative) {
      return planAbsolute(range.startTime, range.endTime, token);
    }
    const outside = outsideRetentionPlan(range.startTime, range.endTime);
    if (outside) return outside;
    if (calendarExceedsRestriction(token)) return overLimitPlan(range.startTime, range.endTime);
    return name ? { kind: "calendar", token, name } : { kind: "calendar", token };
  };

  const planRelative = (period: string): InputPlan => {
    const calendar = parseCalendarToken(period);
    if (calendar && props.rollingCalendarWords && !props.disableRelative) {
      const plan = planRelative(ROLLING_EQUIVALENT[calendar.unit]);
      return plan.kind === "rolling" ? { ...plan, fromCalendar: true } : plan;
    }
    if (calendar) return planCalendar(period);
    const rolling = parseRollingPeriod(period);
    if (!rolling) return refusedPlan(t("common.timeRangeInputError"));
    if (props.disableRelative) return refusedPlan(t("common.timeRangeDatesOnly"));
    const unit = rolling.unit;
    if (!deps.relativePeriods.some((option) => option.value === unit)) {
      return refusedPlan(t("common.timeRangeNoSeconds"));
    }
    const value = Math.min(rolling.value, MAX_CUSTOM_RELATIVE_VALUE[unit] ?? rolling.value);
    const cut = value < rolling.value;
    const max = deps.relativePeriodsMaxValue.value[unit];
    // The panel's minute clock, so an open preview keeps re-reading against now.
    const span = rollingRange(value, unit, tooltipNow.value);
    // Presets and the Custom row check nominal unit spans only; typed text also checks the real span, so only it refuses a 25h DST day.
    if (
      props.queryRangeRestrictionInHour > 0 &&
      (max < 1 ||
        value > max ||
        exceedsRangeRestriction(span.startTime, span.endTime, props.queryRangeRestrictionInHour))
    ) {
      return overLimitPlan(span.startTime, span.endTime);
    }
    const { startTime, endTime } = span;
    return { kind: "rolling", unit, value, startTime, endTime, ...(cut ? { cut } : {}) };
  };

  const planInput = (reading: ParsedTimeInput, asUtc: boolean): InputPlan => {
    if (reading.type === "relative") return planRelative(reading.period);
    if (reading.type === "timestamp") return planAbsolute(reading.startMicros, reading.endMicros);
    const { start, end } = zonelessToMicros(reading, asUtc);
    return planAbsolute(start, end, null, reading.name);
  };

  // No locale: typed day/month order follows the browser's languages, as the week start does.
  const parseOptions = () => ({
    now: new Date(),
    timeZone: zone.value,
    ceilingMs: ceilingMicros() / 1000,
  });

  // The absolute range a full stamp reads as, for a paste into Start or End; null for anything else.
  const readPastedStamp = (text: string): { start: number; end: number } | null => {
    const reading = parseTimeInput(text, parseOptions());
    if (!reading || reading.type === "relative") return null;
    const plan = planInput(reading, false);
    return plan.kind === "absolute" ? { start: plan.start, end: plan.end } : null;
  };

  // Where a lone instant puts the cursor first: the user's Search around window, else ± 5 min.
  const preferredAnchor = (): AnchorRow["id"] => {
    const choice = readSearchAroundChoice(currentSearchAroundUser(store.state));
    return searchAroundAnchorId(choice) ?? DEFAULT_ANCHOR_WINDOW;
  };

  // A lone reading gets a row of its own when no list row already applies it, so the body is never blank.
  const needsReadingRow = (reading: ParsedTimeInput | null): boolean => {
    if (!reading) return false;
    const plan = planInput(reading, false);
    if (plan.kind === "refused") return false;
    const period =
      plan.kind === "calendar"
        ? plan.token
        : plan.kind === "rolling"
          ? `${plan.value}${plan.unit}`
          : null;
    if (period !== null && defaultRows.value.some((row) => row.period === period)) return false;
    return (
      plan.kind === "restricted" || !filterTimeRangeList(defaultRows.value, inputText.value).length
    );
  };

  // A zone abbreviation's preferred reading is never dropped; a future one is listed greyed.
  const isFutureReading = (reading: ParsedTimeInput) =>
    reading.type === "timestamp" && reading.future === true;

  const suggestionBlocked = (reading: ParsedTimeInput) =>
    isFutureReading(reading) || planInput(reading, false).kind === "restricted";

  const isOverLimit = (reading: ParsedTimeInput) => {
    const plan = planInput(reading, false);
    return plan.kind === "restricted" && !plan.retention;
  };

  // A rolling reading allows the last `limit`; a fixed one the limit's window ending where it ends.
  const longestAllowed = (reading: ParsedTimeInput, hours: number): ParsedTimeInput | null => {
    if (reading.type === "relative") {
      const allowed: ParsedTimeInput = { type: "relative", period: formatLimitShorthand(hours) };
      return planInput(allowed, false).kind === "rolling" ? allowed : null;
    }
    const plan = planInput(reading, false);
    if (plan.kind !== "restricted" || !plan.range) return null;
    const end = plan.range.end;
    const allowed: ParsedTimeInput = {
      type: "timestamp",
      startMicros: end - hours * MICROS_PER_HOUR,
      endMicros: end,
    };
    return planInput(allowed, false).kind === "absolute" ? allowed : null;
  };

  // A reading over the page limit stays listed, greyed, followed by the longest it allows.
  const withLongestAllowed = (readings: ParsedTimeInput[]): ParsedTimeInput[] => {
    const hours = props.queryRangeRestrictionInHour;
    if (!(hours > 0)) return readings;
    const over = readings.findIndex(isOverLimit);
    if (over < 0) return readings;
    const allowed = longestAllowed(readings[over], hours);
    if (!allowed) return readings;
    return [...readings.slice(0, over + 1), allowed, ...readings.slice(over + 1)];
  };

  // A stamp with its year anchors like ISO, on the first day/month order that can apply at its clock.
  const anchorableReading = (
    reading: ParsedTimeInput,
    readings: ParsedTimeInput[],
  ): ParsedTimeInput | null => {
    if (reading.type !== "absolute" || !reading.hasYear || !reading.centre) return null;
    // Zone and DST-fold alternatives are other instants, listed rather than anchored.
    if (readings.some((other) => other.type !== "absolute")) return null;
    const time = reading.centre.time;
    const sameClock = readings.filter(
      (other) => other.type === "absolute" && other.centre?.time === time,
    );
    return sameClock.find((other) => planInput(other, false).kind !== "refused") ?? reading;
  };

  // The instant a lone pasted time stands for; a text with several readings (zone abbreviations, DST folds) lists those instead.
  const loneInstant = (text: string, options: ReturnType<typeof parseOptions>): number | null => {
    let reading = inputReading.value;
    if (!reading) return null;
    if (!LONE_CLOCK_RE.test(text)) {
      const readings = suggestTimeInput(text, options);
      const anchorable = readings.length > 1 ? anchorableReading(reading, readings) : reading;
      if (!anchorable) return null;
      // The bar reads as the order it anchors on, so the summary notes a flipped day/month.
      reading = anchorable;
      inputReading.value = anchorable;
    }
    const centre = readingAnchorMicros(reading, zone.value);
    if (centre === null || !inputAsUtc.value || reading.type !== "absolute") return centre;
    const { start, end } = zonelessToMicros(reading, true);
    return Math.round((start + end) / 2);
  };

  // Every keystroke schedules this; Enter and a paste read at once, against a fresh now.
  const readInputText = (keepActive = false) => {
    cancelPendingRead();
    refreshTooltipNow();
    const text = inputText.value.trim();
    suggestionTags.value = [];
    readingOnly.value = false;
    inputReversed.value = false;
    inputFuture.value = false;
    if (!text) {
      inputReading.value = null;
      inputSuggestions.value = [];
      return;
    }
    const options = parseOptions();
    inputReading.value = parseTimeInput(text, options);
    const anchorUs = loneInstant(text, options);
    if (anchorUs !== null) {
      const rows = anchorRows(anchorUs, Date.now() * 1000);
      inputSuggestions.value = rows.map((row) => ({
        type: "timestamp" as const,
        startMicros: row.startUs,
        endMicros: row.endUs,
        centreMicros: anchorUs,
      }));
      suggestionTags.value = rows.map((row) => ({ anchor: row.id }));
      const preferred = rows.findIndex((row) => row.id === preferredAnchor());
      activeSuggestion.value = keepActive
        ? Math.min(activeSuggestion.value, rows.length - 1)
        : Math.max(preferred, 0);
      return;
    }
    // A reading the picker would refuse is not offered, as picking it could do nothing.
    const suggested = suggestTimeInput(text, options)
      .filter((reading) => isFutureReading(reading) || planInput(reading, false).kind !== "refused")
      .slice(0, MAX_SUGGESTIONS);
    readingOnly.value = suggested.length === 0 && needsReadingRow(inputReading.value);
    const failure =
      !inputReading.value && suggested.length === 0 ? explainTimeInputFailure(text, options) : null;
    inputReversed.value = failure === "reversed";
    inputFuture.value = failure === "future";
    const offered = readingOnly.value && inputReading.value ? [inputReading.value] : suggested;
    const readings = withLongestAllowed(offered);
    inputSuggestions.value = readings;
    suggestionTags.value = readings.map((reading) =>
      offered.includes(reading) ? null : { longestAllowed: true as const },
    );
    const first = readings.findIndex((reading) => !suggestionBlocked(reading));
    const last = Math.max(readings.length - 1, 0);
    activeSuggestion.value = keepActive
      ? Math.min(activeSuggestion.value, last)
      : Math.max(first, 0);
  };

  // The old list goes at once, so a key pressed before the pause can never pick a row of stale text.
  const onInputEdit = () => {
    listCursor.value = -1;
    inputError.value = false;
    inputRefusal.value = null;
    inputReversed.value = false;
    inputFuture.value = false;
    inputAsUtc.value = false;
    suggestionsDismissed.value = false;
    inputSuggestions.value = [];
    cancelPendingRead();
    readTimer = setTimeout(readInputText, INPUT_READ_DELAY_MS);
    readPending.value = true;
  };

  const suggestionsOpen = computed(
    () =>
      menuOpen.value &&
      !suggestionsDismissed.value &&
      inputSuggestions.value.length > 0 &&
      inputText.value.trim() !== "" &&
      (!readingOnly.value || inputSuggestions.value.length > 1),
  );

  // Typed text turns the list into suggestions and matching rows; a refused Enter returns it to the default.
  const typing = computed(() => inputText.value.trim() !== "" && !inputError.value);

  // Enter applies this same reading, so the preview and what applies never differ.
  const shownReading = computed<ParsedTimeInput | null>(() =>
    suggestionsOpen.value
      ? (inputSuggestions.value[activeSuggestion.value] ?? null)
      : inputReading.value,
  );

  const inputPlan = computed<InputPlan | null>(() => {
    const reading = shownReading.value;
    if (!reading || !inputText.value.trim()) return null;
    return planInput(reading, inputAsUtc.value);
  });

  const shownTag = computed<SuggestionTag>(() =>
    suggestionsOpen.value ? (suggestionTags.value[activeSuggestion.value] ?? null) : null,
  );

  // A DST repeated hour reads twice with the same clock, so its rows name their zone and offset.
  const rowRangeLabel = (startUs: number, endUs: number, reading: ParsedTimeInput): string => {
    const label = formatRangeLabel({ startUs, endUs }, { ...labelOptions(), surface: "row" });
    if (reading.type !== "timestamp" || !reading.fold) return label;
    const atMs = startUs / 1000;
    const abbreviation = formatZoneAbbreviation(zone.value, atMs, intlLocale.value);
    return `${label} ${abbreviation} (${formatZoneOffset(zone.value, atMs)})`;
  };

  const suggestionRow = (reading: ParsedTimeInput, index: number): TimeInputSuggestionRow => {
    const plan = planInput(reading, inputAsUtc.value);
    const text = formatTimeInputText(reading);
    const key = `${index}-${text}`;
    const tag = suggestionTags.value[index] ?? null;
    if (reading.type === "timestamp" && reading.future) {
      const label = rowRangeLabel(reading.startMicros, reading.endMicros, reading);
      return { key, label, hint: "", relative: false };
    }
    if (tag && "anchor" in tag && plan.kind === "absolute") {
      const span =
        tag.anchor === "to-now"
          ? formatRangeLabel(
              { startUs: plan.start, endUs: plan.end },
              { ...labelOptions(), surface: "row" },
            )
          : dropZeroMilliseconds(formatClockSpan(plan.start, plan.end));
      return {
        key,
        label: String(anchorWindowLabel(tag.anchor, t)),
        hint: span,
        relative: false,
      };
    }
    if (plan.kind === "rolling" || (plan.kind === "restricted" && reading.type === "relative")) {
      // A count past its cap is named by the capped count it applies.
      const period =
        plan.kind === "rolling"
          ? `${plan.value}${plan.unit}`
          : reading.type === "relative"
            ? reading.period
            : text.replace(/mo$/, "M");
      const cut = plan.kind === "rolling" && plan.cut === true;
      return { key, label: String(relativeLabel(period)), hint: text, relative: true, cut };
    }
    if (plan.kind === "calendar") {
      const label = plan.name ?? String(relativeLabel(plan.token));
      return { key, label, hint: text, relative: true };
    }
    const range = plan.kind === "absolute" ? plan : plan.kind === "restricted" ? plan.range : null;
    if (!range) return { key, label: text, hint: "", relative: false };
    const name = plan.kind === "absolute" ? plan.name : undefined;
    if (name) {
      const dates = formatRangeDates(
        { startUs: range.start, endUs: range.end, name, period: true },
        { ...labelOptions(), surface: "row" },
      );
      return { key, label: name, hint: dates, relative: false, named: true };
    }
    // Zone alternatives tell their rows apart by zone; a lone reading shows its length.
    const source = reading.type === "timestamp" ? reading.sourceZone : undefined;
    const zones = new Set(
      inputSuggestions.value.map((other) => (other.type === "timestamp" ? other.sourceZone : "")),
    );
    const alternatives = zones.size > 1;
    return {
      key,
      label: rowRangeLabel(range.start, range.end, reading),
      hint: (alternatives ? source : undefined) ?? formatRangeDuration(range.start, range.end),
      relative: false,
    };
  };

  const suggestionRows = computed(() => inputSuggestions.value.map(suggestionRow));

  // The bar's own reading as a row with no cursor: nothing lights while typing, and Enter applies it.
  const readingRows = computed<TimeRangeListRow[]>(() => {
    const reading = inputReading.value;
    if (!readingOnly.value || suggestionsOpen.value || !reading || !typing.value) return [];
    const row = suggestionRow(reading, 0);
    const plan = planInput(reading, inputAsUtc.value);
    const reason = plan.kind === "restricted" ? plan.reason : null;
    return [
      {
        id: `reading-${row.key}`,
        kind: row.named ? ("calendar" as const) : ("reading" as const),
        label: row.label,
        hint: row.relative && reason === null ? row.hint : undefined,
        meta: reason ?? (row.relative ? "" : row.hint),
        reason: reason !== null,
        disabled: reason !== null,
        testId: "date-time-list-reading",
        group: -1,
      },
    ];
  });

  const suggestionKind = (index: number, named?: boolean): TimeRangeListRow["kind"] => {
    const tag = suggestionTags.value[index];
    if (tag && "anchor" in tag) return tag.anchor === "to-now" ? "to-now" : "anchor";
    return named ? "calendar" : "suggestion";
  };

  const suggestionTestId = (index: number) => {
    const tag = suggestionTags.value[index];
    if (tag && "anchor" in tag) return `date-time-list-anchor-${tag.anchor}`;
    return readingOnly.value && index === 0
      ? "date-time-list-reading"
      : `date-time-suggest-${index}`;
  };

  const suggestionListRows = computed<TimeRangeListRow[]>(() =>
    suggestionsOpen.value
      ? suggestionRows.value.map((row, index) => {
          const reading = inputSuggestions.value[index];
          const future = isFutureReading(reading);
          const plan = planInput(reading, inputAsUtc.value);
          const restricted = future || plan.kind === "restricted";
          const tag = suggestionTags.value[index];
          const anchored = !!tag && "anchor" in tag;
          const meta = future
            ? String(t("dateTime.inTheFuture"))
            : plan.kind === "restricted"
              ? plan.reason
              : tag && "longestAllowed" in tag
                ? String(t("dateTime.longestAllowed"))
                : row.cut
                  ? String(t("dateTime.cutToTenYears"))
                  : row.relative
                    ? ""
                    : row.hint;
          return {
            id: `suggest-${row.key}`,
            kind: suggestionKind(index, row.named),
            label: row.label,
            hint: row.relative && !restricted ? row.hint : undefined,
            meta,
            reason: restricted,
            disabled: restricted,
            testId: suggestionTestId(index),
            group: anchored && tag && "anchor" in tag && tag.anchor === "to-now" ? -2 : -1,
          };
        })
      : [],
  );

  // A snap or calendar word keeps the row it resolves to, though its words match no label.
  const readPeriod = computed(() => {
    const plan = inputPlan.value;
    if (plan?.kind === "calendar") return plan.token;
    if (plan?.kind === "rolling") return `${plan.value}${plan.unit}`;
    return null;
  });

  const listRows = computed(() =>
    typing.value
      ? filterTimeRangeList(defaultRows.value, inputText.value, readPeriod.value)
      : defaultRows.value,
  );

  // Typed text that reads as nothing and matches no row teaches the grammar instead of a blank body.
  const exampleRows = computed<TimeRangeListRow[]>(() => {
    if (!typing.value || readPending.value || inputReading.value || inputFuture.value) return [];
    if (suggestionListRows.value.length > 0 || listRows.value.length > 0) return [];
    if (readingRows.value.length > 0) return [];
    return TIME_INPUT_EXAMPLES.map((example, index) => ({
      id: `example-${index}`,
      kind: "example" as const,
      label: example.text,
      meta: String(t(example.description)),
      disabled: false,
      testId: `date-time-list-example-${index}`,
      group: 0,
    }));
  });

  const listHeading = computed(() =>
    exampleRows.value.length > 0 ? String(t("dateTime.noMatchYet")) : undefined,
  );

  const shownRows = computed(() =>
    exampleRows.value.length > 0
      ? exampleRows.value
      : [...readingRows.value, ...suggestionListRows.value, ...listRows.value],
  );

  // Rows above the default list: the reading row or the suggestions.
  const listOffset = computed(() => readingRows.value.length + suggestionListRows.value.length);

  const activeRow = computed(() => {
    if (exampleRows.value.length > 0) return -1;
    if (listCursor.value >= 0) return listOffset.value + listCursor.value;
    return suggestionsOpen.value ? activeSuggestion.value : -1;
  });

  // The pointer sets the same cursor the arrow keys move.
  const setCursorRow = (index: number) => {
    const suggestions = suggestionListRows.value.length;
    if (exampleRows.value.length > 0 || index < readingRows.value.length) return;
    if (index < suggestions) {
      listCursor.value = -1;
      activeSuggestion.value = index;
      return;
    }
    listCursor.value = index - listOffset.value;
  };

  // The nearest enabled list row from `from` in a direction, without wrapping; -1 when none.
  const enabledListRow = (from: number, step: 1 | -1) => {
    const rows = listRows.value;
    for (let i = from + step; i >= 0 && i < rows.length; i += step) {
      if (!rows[i].disabled) return i;
    }
    return -1;
  };

  // Down from the bar or the last suggestion enters the list; Up from its first row returns.
  const moveCursor = (step: 1 | -1): boolean => {
    const suggestions = suggestionListRows.value.length;
    if (listCursor.value >= 0) {
      const next = enabledListRow(listCursor.value, step);
      if (next >= 0) listCursor.value = next;
      else if (step === -1) {
        listCursor.value = -1;
        if (suggestions > 0) activeSuggestion.value = suggestions - 1;
      }
      return true;
    }
    if (suggestionsOpen.value) {
      const last = activeSuggestion.value === suggestions - 1;
      const intoList = step === 1 && last ? enabledListRow(-1, 1) : -1;
      if (intoList >= 0) listCursor.value = intoList;
      else
        activeSuggestion.value = stepListCursor(
          suggestionListRows.value,
          activeSuggestion.value,
          step,
        );
      return true;
    }
    if (step === -1) return false;
    const first = enabledListRow(-1, 1);
    listCursor.value = first;
    return first >= 0;
  };

  // Times alone when both ends share a day, as the zone toggle sits beside the full range.
  const formatTimesOnly = (startUs: number, endUs: number): string => {
    const start = convertUnixTime(startUs);
    const end = convertUnixTime(endUs);
    if (start.date !== end.date) {
      return formatRangeDates({ startUs, endUs }, { ...labelOptions(), nowMs: Date.now() });
    }
    return `${start.time.slice(0, 5)} – ${end.time.slice(0, 5)}`;
  };

  // Only a date with its year may be a stamp pasted from another zone; "since 9am" means this one.
  // Anchor rows are built from the typed reading, so its zone toggle still applies to them.
  const zonelessPreview = computed<AbsoluteRangeResult | null>(() => {
    const anchored = suggestionTags.value.some((tag) => !!tag && "anchor" in tag);
    if (anchored) {
      const typed = inputReading.value;
      return typed?.type === "absolute" && typed.hasYear ? typed : null;
    }
    const reading = shownReading.value;
    if (reading?.type !== "absolute" || !reading.hasYear) return null;
    return inputPlan.value?.kind === "absolute" ? reading : null;
  });

  // The chip names the reading a click switches to, so once pressed it offers the picker-zone reading back.
  // Short on the chip, the converted range in its tooltip, so the summary keeps room for the dates.
  const asUtcLabel = computed<{ short: I18nText; full: I18nText } | null>(() => {
    const parsed = zonelessPreview.value;
    if (!parsed || zone.value === "UTC" || !deps.showsZone.value) return null;
    const { start, end } = zonelessToMicros(parsed, !inputAsUtc.value);
    // A reading the picker would refuse is not offered, as clicking it could do nothing.
    if (startBoundError(start) !== null) return null;
    const range = formatTimesOnly(start, end);
    if (!inputAsUtc.value) {
      return { short: t("dateTime.asUtcShort"), full: t("common.timeRangeAsUtc", { range }) };
    }
    const zoneName = formatZoneAbbreviation(zone.value, start / 1000, intlLocale.value);
    return {
      short: t("dateTime.asZoneShort", { zone: zoneName }),
      full: t("common.timeRangeAsZone", { zone: zoneName, range }),
    };
  });

  const toggleAsUtc = () => {
    inputAsUtc.value = !inputAsUtc.value;
    if (suggestionTags.value.some((tag) => !!tag && "anchor" in tag)) readInputText(true);
  };

  // A refused reading says why on Enter; one over the query-range limit already says so in the preview.
  const applyReading = (reading: ParsedTimeInput, asUtc: boolean, tag: SuggestionTag = null) => {
    const plan = planInput(reading, asUtc);
    if (plan.kind === "restricted") return;
    if (plan.kind === "refused") {
      inputRefusal.value = plan.message;
      inputError.value = true;
      return;
    }
    // The window picked becomes the Search around choice, so the next paste starts on it.
    const choice = tag && "anchor" in tag ? anchorSearchAroundChoice(tag.anchor) : null;
    if (choice) writeSearchAroundChoice(currentSearchAroundUser(store.state), choice);
    deps.applyPlan(plan);
    deps.finish();
  };

  const applySuggestion = (index: number) => {
    const reading = inputSuggestions.value[index];
    if (reading) applyReading(reading, inputAsUtc.value, suggestionTags.value[index] ?? null);
  };

  // Tab takes the highlighted reading into the bar as unambiguous text, without applying it.
  const acceptSuggestion = (index: number) => {
    const reading = inputSuggestions.value[index];
    if (!reading) return;
    const asUtc = inputAsUtc.value;
    inputText.value = formatTimeInputText(reading);
    onInputEdit();
    readInputText();
    inputAsUtc.value = asUtc;
    suggestionsDismissed.value = true;
  };

  // Enter reads again against a fresh now; only alternatives of text with no reading are shown before applying.
  const commitInput = () => {
    if (!inputText.value.trim()) return;
    const pending = readTimer !== null;
    const listWasOpen = suggestionsOpen.value;
    readInputText(listWasOpen && !pending);
    lastReadText = inputText.value.trim();
    // Text with a reading of its own applies it at once, so a fast Enter never waits on the read delay.
    const unseenList = !listWasOpen && !inputReading.value;
    if (inputSuggestions.value.length > 0 && unseenList && !readingOnly.value) {
      suggestionsDismissed.value = false;
      return;
    }
    const reading = shownReading.value;
    if (reading) {
      applyReading(reading, inputAsUtc.value, shownTag.value);
      return;
    }
    // Text that reads as nothing only filtered the list, so Enter takes its first match.
    const firstMatch = enabledListRow(-1, 1);
    if (firstMatch >= 0) {
      deps.pickListRow(firstMatch);
      return;
    }
    const text = inputText.value.trim();
    const reason = explainTimeInputFailure(text, parseOptions());
    reportParseFailure(text, reason);
    inputRefusal.value =
      reason === "future"
        ? t("common.timeRangeStartInFuture")
        : reason === "reversed"
          ? t("common.timeRangeEndBeforeStart")
          : null;
    inputError.value = true;
  };

  // An example is copied into the bar to be read, never applied.
  const takeExample = (text: string) => {
    inputText.value = text;
    onInputEdit();
    readInputText();
    inputBar.value?.focus();
  };

  const pickShownRow = (index: number) => {
    const example = exampleRows.value[index];
    if (example) {
      takeExample(example.label);
      return;
    }
    if (index < readingRows.value.length) {
      commitInput();
      return;
    }
    const suggestions = suggestionListRows.value.length;
    if (index < suggestions) applySuggestion(index);
    else deps.pickListRow(index - listOffset.value);
  };

  // Delete removes the Recent row under the cursor; Alt+P pins or unpins it.
  const onCursorRowKey = (event: KeyboardEvent): boolean => {
    const row = listRows.value[listCursor.value];
    if (!row) return false;
    if (event.key === "Delete" && row.kind === "recent") deps.removeRecentRow(row.id);
    else if (event.altKey && event.code === "KeyP" && row.kind === "recent")
      deps.pinRecentRow(row.id);
    else if (event.altKey && event.code === "KeyP" && row.kind === "pinned") deps.unpinRow(row.id);
    else return false;
    event.preventDefault();
    return true;
  };

  // Examples have no cursor, so Tab takes the first one into the bar.
  const tabToExample = (event: KeyboardEvent): boolean => {
    const first = exampleRows.value[0];
    if (!first) return false;
    event.preventDefault();
    takeExample(first.label);
    return true;
  };

  // Enter and Apply both land here, so they apply the same reading or row.
  const applyTypedReading = () => {
    if (listCursor.value >= 0) deps.pickListRow(listCursor.value);
    else commitInput();
  };

  const onInputKeydown = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    if (listCursor.value >= 0 && onCursorRowKey(event)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      applyTypedReading();
      return;
    }
    if (event.key === "Tab" && readTimer !== null) {
      readInputText();
      if (suggestionsOpen.value) event.preventDefault();
      else if (!event.shiftKey) tabToExample(event);
      return;
    }
    if (event.key === "Tab" && !event.shiftKey && tabToExample(event)) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (moveCursor(event.key === "ArrowDown" ? 1 : -1)) event.preventDefault();
      return;
    }
    if (!suggestionsOpen.value || listCursor.value >= 0) return;
    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      acceptSuggestion(activeSuggestion.value);
    }
  };

  // A press on a row keeps focus in the bar, so only a move elsewhere closes the list.
  const onBarFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget;
    const bar = event.currentTarget;
    if (next instanceof Node && bar instanceof HTMLElement && bar.contains(next)) return;
    suggestionsDismissed.value = true;
  };

  // Escape backs out one step at a time: the list, then the typed text, then the panel.
  const escapeInput = (event: KeyboardEvent): boolean => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.closest("[data-test='date-time-input']")) {
      return false;
    }
    if (listCursor.value >= 0) listCursor.value = -1;
    else if (suggestionsOpen.value) suggestionsDismissed.value = true;
    else if (inputText.value) clearInput();
    else return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  // A paste fills the bar and shows what it reads as; like typed text it applies only on Enter.
  const readPastedText = (text: string) => {
    inputText.value = text.trim();
    onInputEdit();
    readInputText();
    lastReadText = inputText.value;
    inputBar.value?.focus();
  };

  const pasteRange = async () => {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      toast({
        variant: "error",
        message: t("common.dateRangePasteBlocked", {
          shortcut: isMacOS() ? raw("⌘V") : raw("Ctrl+V"),
        }),
      });
      return;
    }
    if (!text.trim()) {
      toast({ variant: "info", message: t("common.dateRangePasteEmpty") });
      return;
    }
    readPastedText(text);
  };

  // Any other paste into the box goes in at the caret, so `yesterday` and a pasted `15:00` read together.
  const isWholePasteBoxEntry = (target: EventTarget | null) => {
    if (!(target instanceof HTMLInputElement)) return false;
    if (!target.closest("[data-test='date-time-input']")) return false;
    const text = target.value.trim();
    return (
      text === "" ||
      text === lastReadText ||
      (target.selectionStart === 0 && target.selectionEnd === target.value.length)
    );
  };

  // A native paste event carries the clipboard text without the read permission pasteRange needs.
  const onBarPaste = (event: ClipboardEvent) => {
    if (isInputFocused(event.target) && !isWholePasteBoxEntry(event.target)) return;
    const text = event.clipboardData?.getData("text") ?? "";
    if (!text.trim()) return;
    event.preventDefault();
    readPastedText(text);
  };

  return {
    inputText,
    inputError,
    inputRefusal,
    inputReversed,
    inputFuture,
    inputErrorText,
    inputAsUtc,
    inputReading,
    suggestionsOpen,
    suggestionRows,
    activeSuggestion,
    typing,
    shownReading,
    inputPlan,
    shownTag,
    listRows,
    shownRows,
    activeRow,
    listHeading,
    asUtcLabel,
    cancelPendingRead,
    clearInput,
    readPastedStamp,
    onInputEdit,
    applyTypedReading,
    onInputKeydown,
    onBarFocusOut,
    escapeInput,
    setCursorRow,
    toggleAsUtc,
    applySuggestion,
    pickShownRow,
    pasteRange,
    onBarPaste,
  };
}
