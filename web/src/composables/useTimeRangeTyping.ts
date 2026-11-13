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
import { parseCalendarToken, resolveCalendarPeriod } from "@/utils/dashboard/calendarPeriods";
import { exceedsRangeRestriction, formatZoneAbbreviation } from "@/utils/timeRangeRail";
import {
  TIME_INPUT_EXAMPLES,
  filterTimeRangeList,
  formatLimitShorthand,
  stepListCursor,
  type TimeRangeListRow,
} from "@/utils/timeRangeList";
import { formatRangeDates, formatRangeDuration, formatRangeLabel } from "@/utils/timeRangeLabel";
import {
  DEFAULT_ANCHOR_WINDOW,
  anchorRows,
  anchorWindowLabel,
  readingAnchorMicros,
  type AnchorRow,
} from "@/utils/timeRangeAnchor";
import { reportParseFailure } from "@/utils/timeInputFailure";
import {
  currentSearchAroundUser,
  readSearchAroundChoice,
  searchAroundAnchorId,
} from "@/utils/searchAroundWindow";
import {
  SINGLE_WINDOW_MICROS,
  explainTimeInputFailure,
  parseRollingPeriod,
  parseTimeInput,
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

// Typed text is read this long after the last keystroke, so the preview does not flicker per key.
const INPUT_READ_DELAY_MS = 100;
const MAX_SUGGESTIONS = 5;

// What Enter would do with a reading, worked out once so the preview and Enter never disagree.
export type InputPlan =
  | { kind: "rolling"; unit: string; value: number; startTime: number; endTime: number }
  | { kind: "calendar"; token: string }
  | { kind: "absolute"; start: number; end: number; calendarPeriod: string | null }
  | { kind: "refused"; message: I18nText }
  | { kind: "restricted"; message: I18nText };

interface TimeInputSuggestionRow {
  key: string;
  label: string;
  hint: string;
  relative: boolean;
}

// What a typed-text row stands for beyond its reading: a window around a pasted instant, or the longest range a limit allows.
export type SuggestionTag = { anchor: AnchorRow["id"] } | { longestAllowed: true } | null;

export interface TimeRangeTypingProps {
  disableRelative: boolean;
  calendarPresets: boolean;
  queryRangeRestrictionInHour: number;
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
  } = limits;

  const inputText = ref("");
  const inputError = ref(false);
  // Why readable text was refused, shown instead of the generic unreadable message.
  const inputRefusal = ref<I18nText | null>(null);
  // A stamped range with its end not after its start reads as nothing, so the summary row says why.
  const inputReversed = ref(false);
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

  const zonelessToMicros = (range: AbsoluteRangeResult, asUtc: boolean) => {
    if (range.exact && !asUtc)
      return { start: range.exact.startMicros, end: range.exact.endMicros };
    const zoneName = asUtc ? "UTC" : zone.value;
    if (range.centre) {
      const centre = absoluteToMicros(range.centre.date, range.centre.time, zoneName);
      return { start: centre - SINGLE_WINDOW_MICROS, end: centre + SINGLE_WINDOW_MICROS };
    }
    return {
      start: absoluteToMicros(range.startDate, range.startTime, zoneName),
      end: absoluteToMicros(range.endDate, range.endTime, zoneName),
    };
  };

  const refusedPlan = (message: I18nText): InputPlan => ({ kind: "refused", message });

  // Only the start is bounded: an end past the ceiling is cut to it.
  const planAbsolute = (
    start: number,
    rawEnd: number,
    calendarPeriod: string | null = null,
  ): InputPlan => {
    if (!Number.isFinite(start) || !Number.isFinite(rawEnd)) {
      return refusedPlan(t("common.timeRangeInputError"));
    }
    // A start out of bounds is named first, so `since` a future date says so rather than blaming the end.
    const refusal =
      startBoundError(start) ?? (rawEnd <= start ? t("common.timeRangeEndBeforeStart") : null);
    if (refusal !== null) return refusedPlan(refusal);
    const end = Math.min(rawEnd, selectionCeilingMicros());
    if (exceedsRangeRestriction(start, end, props.queryRangeRestrictionInHour)) {
      return { kind: "restricted", message: restrictionMessage() };
    }
    return { kind: "absolute", start, end, calendarPeriod };
  };

  // Typed calendar words select the rail's token, or its dates where the picker has no calendar presets.
  const planCalendar = (token: string): InputPlan => {
    const range = resolveCalendarPeriod(token, zone.value);
    if (!range) return refusedPlan(t("common.timeRangeInputError"));
    if (!props.calendarPresets || props.disableRelative) {
      return planAbsolute(range.startTime, range.endTime, token);
    }
    if (calendarExceedsRestriction(token)) {
      return { kind: "restricted", message: restrictionMessage() };
    }
    return { kind: "calendar", token };
  };

  const planRelative = (period: string): InputPlan => {
    if (parseCalendarToken(period)) return planCalendar(period);
    const rolling = parseRollingPeriod(period);
    if (!rolling) return refusedPlan(t("common.timeRangeInputError"));
    if (props.disableRelative) return refusedPlan(t("common.timeRangeDatesOnly"));
    const unit = rolling.unit;
    if (!deps.relativePeriods.some((option) => option.value === unit)) {
      return refusedPlan(t("common.timeRangeNoSeconds"));
    }
    const value = Math.min(rolling.value, MAX_CUSTOM_RELATIVE_VALUE[unit] ?? rolling.value);
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
      return { kind: "restricted", message: restrictionMessage() };
    }
    return { kind: "rolling", unit, value, startTime: span.startTime, endTime: span.endTime };
  };

  const planInput = (reading: ParsedTimeInput, asUtc: boolean): InputPlan => {
    if (reading.type === "relative") return planRelative(reading.period);
    if (reading.type === "timestamp") return planAbsolute(reading.startMicros, reading.endMicros);
    const { start, end } = zonelessToMicros(reading, asUtc);
    return planAbsolute(start, end);
  };

  const parseOptions = () => ({
    now: new Date(),
    locale: intlLocale.value,
    timeZone: zone.value,
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

  // A rolling reading over the page limit stays listed, greyed, followed by the longest it allows.
  const withLongestAllowed = (readings: ParsedTimeInput[]): ParsedTimeInput[] => {
    const hours = props.queryRangeRestrictionInHour;
    if (!(hours > 0)) return readings;
    const over = readings.findIndex(
      (reading) => reading.type === "relative" && planInput(reading, false).kind === "restricted",
    );
    if (over < 0) return readings;
    const allowed: ParsedTimeInput = { type: "relative", period: formatLimitShorthand(hours) };
    if (planInput(allowed, false).kind !== "rolling") return readings;
    return [...readings.slice(0, over + 1), allowed, ...readings.slice(over + 1)];
  };

  // The instant a lone pasted time stands for; a text with several readings (zone abbreviations, DST folds) lists those instead.
  const loneInstant = (text: string, options: ReturnType<typeof parseOptions>): number | null => {
    const reading = inputReading.value;
    if (!reading || suggestTimeInput(text, options).length > 1) return null;
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
    inputReversed.value =
      !inputReading.value &&
      suggested.length === 0 &&
      explainTimeInputFailure(text, options) === "reversed";
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

  const suggestionRow = (reading: ParsedTimeInput, index: number): TimeInputSuggestionRow => {
    const plan = planInput(reading, inputAsUtc.value);
    const text = formatTimeInputText(reading);
    const key = `${index}-${text}`;
    const tag = suggestionTags.value[index] ?? null;
    if (reading.type === "timestamp" && reading.future) {
      const label = formatRangeLabel(
        { startUs: reading.startMicros, endUs: reading.endMicros },
        { ...labelOptions(), surface: "row" },
      );
      return { key, label: reading.fold ? text : label, hint: "", relative: false };
    }
    if (tag && "anchor" in tag && plan.kind === "absolute") {
      const span =
        tag.anchor === "to-now"
          ? formatRangeLabel(
              { startUs: plan.start, endUs: plan.end },
              { ...labelOptions(), surface: "row" },
            )
          : formatClockSpan(plan.start, plan.end);
      return {
        key,
        label: String(anchorWindowLabel(tag.anchor, t)),
        hint: span,
        relative: false,
      };
    }
    if (plan.kind === "rolling" || plan.kind === "restricted") {
      const period = reading.type === "relative" ? reading.period : text.replace(/mo$/, "M");
      return { key, label: String(relativeLabel(period)), hint: text, relative: true };
    }
    if (plan.kind === "calendar") {
      return { key, label: String(relativeLabel(plan.token)), hint: text, relative: true };
    }
    if (plan.kind !== "absolute") return { key, label: text, hint: "", relative: false };
    const opts = { ...labelOptions(), surface: "row" as const };
    const label =
      reading.type === "timestamp" && reading.fold
        ? text
        : formatRangeLabel({ startUs: plan.start, endUs: plan.end }, opts);
    const future = reading.type === "timestamp" && reading.future;
    const source = reading.type === "timestamp" ? reading.sourceZone : undefined;
    return {
      key,
      label,
      hint: future
        ? String(t("dateTime.inTheFuture"))
        : (source ?? formatRangeDuration(plan.start, plan.end)),
      relative: false,
    };
  };

  const suggestionRows = computed(() => inputSuggestions.value.map(suggestionRow));

  // The bar's own reading as a row with no cursor: nothing lights while typing, and Enter applies it.
  const readingRows = computed<TimeRangeListRow[]>(() => {
    const reading = inputReading.value;
    if (!readingOnly.value || suggestionsOpen.value || !reading || !typing.value) return [];
    const row = suggestionRow(reading, 0);
    return [
      {
        id: `reading-${row.key}`,
        kind: "reading" as const,
        label: row.label,
        hint: row.relative ? row.hint : undefined,
        meta: row.relative ? "" : row.hint,
        disabled: false,
        testId: "date-time-list-reading",
        group: -1,
      },
    ];
  });

  const suggestionKind = (index: number): TimeRangeListRow["kind"] => {
    const tag = suggestionTags.value[index];
    if (tag && "anchor" in tag) return tag.anchor === "to-now" ? "to-now" : "anchor";
    return "suggestion";
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
          const restricted = future || planInput(reading, inputAsUtc.value).kind === "restricted";
          const tag = suggestionTags.value[index];
          const anchored = !!tag && "anchor" in tag;
          const meta = future
            ? String(t("dateTime.inTheFuture"))
            : restricted
              ? String(maxLimitText())
              : tag && "longestAllowed" in tag
                ? String(t("dateTime.longestAllowed"))
                : row.relative
                  ? ""
                  : row.hint;
          return {
            id: `suggest-${row.key}`,
            kind: suggestionKind(index),
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
    if (!typing.value || readPending.value || inputReading.value) return [];
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
  const applyReading = (reading: ParsedTimeInput, asUtc: boolean) => {
    const plan = planInput(reading, asUtc);
    if (plan.kind === "restricted") return;
    if (plan.kind === "refused") {
      inputRefusal.value = plan.message;
      inputError.value = true;
      return;
    }
    deps.applyPlan(plan);
    deps.finish();
  };

  const applySuggestion = (index: number) => {
    const reading = inputSuggestions.value[index];
    if (reading) applyReading(reading, inputAsUtc.value);
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

  // Enter reads again against a fresh now; a list the user has not seen yet is shown before anything applies.
  const commitInput = () => {
    if (!inputText.value.trim()) return;
    const pending = readTimer !== null;
    const listWasOpen = suggestionsOpen.value;
    readInputText(listWasOpen && !pending);
    lastReadText = inputText.value.trim();
    const unseenList = pending || (!listWasOpen && !inputReading.value);
    if (inputSuggestions.value.length > 0 && unseenList && !readingOnly.value) {
      suggestionsDismissed.value = false;
      return;
    }
    const reading = shownReading.value;
    if (reading) {
      applyReading(reading, inputAsUtc.value);
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

  const onInputKeydown = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    if (listCursor.value >= 0 && onCursorRowKey(event)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      if (listCursor.value >= 0) deps.pickListRow(listCursor.value);
      else commitInput();
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
