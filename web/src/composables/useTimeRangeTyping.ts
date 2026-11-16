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
  resolveCalendarPeriodBounds,
  type CalendarUnit,
} from "@/utils/dashboard/calendarPeriods";
import { exceedsRangeRestriction, formatZoneAbbreviation } from "@/utils/timeRangeRail";
import {
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
  formatAnchorSpan,
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
  readTimeText,
  resolveZonedCivil,
  suggestTimeInput,
  type AbsoluteRangeResult,
  type ParsedTimeInput,
  type TimeTextAnswer,
} from "@/utils/dateTimeRangeParse";
import { timeRangeName } from "@/utils/timeRangeFormat";
import {
  MAX_FUTURE_US,
  type TimeRangeContext,
  type TimeRangeHostPreset,
  type TimeRangeKind,
} from "@/utils/timeRangeModel";
import { weekStartsOn } from "@/utils/weekStart";
import { formatTimeInputText } from "@/utils/timeInputText";
import { isInputFocused, isMacOS } from "@/utils/keyboardShortcuts";
import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { TimeRangeZone } from "@/composables/useTimeRangeZone";
import type { TimeRangeLimits } from "@/composables/useTimeRangeLimits";
import { MICROS_PER_HOUR, addCivilDays } from "@/composables/useTimeRangeZone";

// Typed text is read this long after the last keystroke, so the preview does not flicker per key.
const INPUT_READ_DELAY_MS = 100;
const MAX_SUGGESTIONS = 5;
// A clock time alone (`11:38`), which reads as an instant whichever half of the day it means.
const LONE_CLOCK_RE = /^\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
// The closest rolling range to a calendar word on a host that stores rolling ranges only.
const CLOSEST_ROLLING: Record<CalendarUnit, string> = {
  day: "24h",
  week: "7d",
  month: "30d",
  quarter: "90d",
  year: "365d",
};
const CALENDAR_TWIN_UNITS: readonly CalendarUnit[] = ["month", "quarter", "year"];
// Typed text reads English words and numeric forms in every locale, so other locales get numeric examples.
const OPS_EXAMPLES = ["2h", "yesterday 9-17", "Nov 4 – 6", "21:13:49 ± 30s", "Q3 2025"];
const DASHBOARD_EXAMPLES = ["last quarter", "Q3 2025", "2025", "Nov 4 – 6", "90d"];
const FIXED_EXAMPLES = ["Nov 4 – 6", "2026-11-04 09:00"];
const NUMERIC_EXAMPLES = ["2h", "90d", "2026-11-04 – 2026-11-06", "2026-11-04 09:00", "Q3 2025"];
const FAILED_EXAMPLE_COUNT = 3;

// What Enter would do with a reading, worked out once so the preview and Enter never disagree.
// `name`: a typed period name (`Q4 2026`); `unavailable`: a kind this host cannot store.
export type InputPlan =
  | {
      kind: "rolling";
      unit: string;
      value: number;
      startTime: number;
      endTime: number;
    }
  | { kind: "calendar"; token: string; name?: string }
  | {
      kind: "absolute";
      start: number;
      end: number;
      calendarPeriod: string | null;
      name?: string;
    }
  | { kind: "refused"; message: I18nText }
  | {
      kind: "restricted";
      message: I18nText;
      // The row's greyed meta: `Max 1d`, `Outside 3-day retention`, or `Not available in Reports`.
      reason: string;
      retention?: boolean;
      unavailable?: boolean;
      range?: { start: number; end: number };
    };

interface TimeInputSuggestionRow {
  key: string;
  label: string;
  hint: string;
  relative: boolean;
  named?: boolean;
}

// What a typed-text row stands for beyond its reading: a window around a pasted instant,
// the longest range a limit allows, or the closest range this host can store.
export type SuggestionTag =
  { anchor: AnchorRow["id"] } | { longestAllowed: true } | { closest: true } | null;

export interface TimeRangeTypingProps {
  // Kinds the host can store; readings of other kinds are greyed `Not available in {host}`.
  kinds: TimeRangeKind[];
  // A start may be after now (on-call); a yearless date then reads as the coming one.
  future: boolean;
  wholeDays: boolean;
  preset: TimeRangeHostPreset;
  hostName: string;
  queryRangeRestrictionInHour: number;
  maxDate?: string;
  fiscalYearStartMonth: number | null;
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
  } = clock;
  const {
    startBoundError,
    selectionCeilingMicros,
    floorMicros,
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
  // Text answered without a range (compare, FY before the org sets it), and text with two readings.
  const textAnswer = ref<TimeTextAnswer | null>(null);
  const ambiguous = ref(false);
  const fiscalUnset = computed(() => textAnswer.value === "fiscalUnset");
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
    textAnswer.value = null;
    ambiguous.value = false;
    lastReadText = "";
  };

  const rangeContext = (): TimeRangeContext => ({
    nowUs: Date.now() * 1000,
    zone: zone.value,
    weekStart: weekStartsOn(),
    locale: intlLocale.value,
    fiscalYearStartMonth: props.fiscalYearStartMonth,
  });

  const hostCan = (kind: TimeRangeKind) => props.kinds.includes(kind);

  const notAvailableText = (): I18nText =>
    props.hostName
      ? t("dateTime.notAvailableIn", { host: props.hostName })
      : t("dateTime.notAvailableHere");

  const unavailablePlan = (start: number, end: number): InputPlan => {
    const message = notAvailableText();
    return {
      kind: "restricted",
      message,
      reason: String(message),
      unavailable: true,
      range: { start, end },
    };
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

  // An unbounded ceiling is kept only where the host allows a future start; elsewhere now caps the start.
  const ceilingMicros = (): number => {
    const ceiling = selectionCeilingMicros();
    return Number.isFinite(ceiling) || props.future ? ceiling : Date.now() * 1000;
  };

  // A range still running keeps its real end (O1); limits look at what a query would read.
  const planAbsolute = (
    start: number,
    rawEnd: number,
    calendarPeriod: string | null = null,
    name?: string,
  ): InputPlan => {
    if (!Number.isFinite(start) || !Number.isFinite(rawEnd)) {
      return refusedPlan(t("common.timeRangeInputError"));
    }
    if (!hostCan("fixed")) return unavailablePlan(start, rawEnd);
    const ceiling = ceilingMicros();
    const nowUs = Date.now() * 1000;
    // A start out of bounds is named first, so `since` a future date says so rather than blaming the end.
    const refusal =
      startBoundError(start) ??
      (start >= ceiling ? t("common.timeRangeStartInFuture") : null) ??
      (rawEnd <= start ? t("common.timeRangeEndBeforeStart") : null) ??
      (rawEnd > nowUs + MAX_FUTURE_US ? t("common.timeRangeInputError") : null);
    if (refusal !== null) return refusedPlan(refusal);
    // A host with its own last day (`maxDate`) ends ranges there.
    const end = props.maxDate ? Math.min(rawEnd, ceiling) : rawEnd;
    const readEnd = props.future ? end : Math.min(end, Math.max(nowUs, start + 1));
    const outside = outsideRetentionPlan(start, readEnd);
    if (outside) return outside;
    if (exceedsRangeRestriction(start, readEnd, props.queryRangeRestrictionInHour)) {
      return overLimitPlan(start, end);
    }
    return { kind: "absolute", start, end, calendarPeriod, ...(name ? { name } : {}) };
  };

  // Without calendar tokens a calendar word is its whole fixed period; a rolling-only host greys it.
  const planCalendar = (token: string, name?: string): InputPlan => {
    if (!hostCan("calendar")) {
      const whole = resolveCalendarPeriodBounds(token, zone.value, Date.now(), weekStartsOn());
      if (!whole) return refusedPlan(t("common.timeRangeInputError"));
      return hostCan("fixed")
        ? planAbsolute(whole.startTime, whole.endTime, token, name)
        : unavailablePlan(whole.startTime, whole.endTime);
    }
    const range = resolveCalendarPeriod(token, zone.value);
    if (!range) return refusedPlan(t("common.timeRangeInputError"));
    const outside = outsideRetentionPlan(range.startTime, range.endTime);
    if (outside) return outside;
    if (calendarExceedsRestriction(token)) return overLimitPlan(range.startTime, range.endTime);
    return name ? { kind: "calendar", token, name } : { kind: "calendar", token };
  };

  const planRelative = (period: string): InputPlan => {
    if (parseCalendarToken(period)) return planCalendar(period);
    const rolling = parseRollingPeriod(period);
    if (!rolling) return refusedPlan(t("common.timeRangeInputError"));
    const { unit, value } = rolling;
    // The panel's minute clock, so an open preview keeps re-reading against now.
    const span = rollingRange(value, unit, tooltipNow.value);
    if (!hostCan("rolling")) return unavailablePlan(span.startTime, span.endTime);
    if (!deps.relativePeriods.some((option) => option.value === unit)) {
      return refusedPlan(t("common.timeRangeNoSeconds"));
    }
    const max = deps.relativePeriodsMaxValue.value[unit];
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
    return { kind: "rolling", unit, value, startTime, endTime };
  };

  const planInput = (reading: ParsedTimeInput, asUtc: boolean): InputPlan => {
    if (reading.type === "relative") return planRelative(reading.period);
    if (reading.type === "timestamp") return planAbsolute(reading.startMicros, reading.endMicros);
    const { start, end } = zonelessToMicros(reading, asUtc);
    return planAbsolute(start, end, null, reading.name);
  };

  // A yearless date past the ceiling reads as last year's, which the floor refuses; the text meant the coming one.
  const planTyped = (reading: ParsedTimeInput, asUtc: boolean): InputPlan => {
    const plan = planInput(reading, asUtc);
    if (plan.kind !== "refused" || reading.type !== "absolute") return plan;
    if (zonelessToMicros(reading, asUtc).start >= floorMicros()) return plan;
    const ahead = parseTimeInput(inputText.value.trim(), {
      ...parseOptions(),
      ceilingMs: Number.POSITIVE_INFINITY,
    });
    if (ahead?.type !== "absolute") return plan;
    const future = zonelessToMicros(ahead, asUtc).start >= ceilingMicros();
    return future ? refusedPlan(t("common.timeRangeStartInFuture")) : plan;
  };

  // No locale: typed day/month order follows the browser's languages, as the week start does.
  const parseOptions = () => ({
    now: new Date(),
    timeZone: zone.value,
    ceilingMs: ceilingMicros() / 1000,
    fiscalStartMonth: props.fiscalYearStartMonth,
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

  // A zone abbreviation's preferred reading and today's hours are never dropped; a future one is listed greyed.
  const isFutureReading = (reading: ParsedTimeInput) =>
    reading.type !== "relative" && reading.future === true;

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

  // The range nearest a reading this host cannot store: a fixed reading's length as rolling, a rolling or calendar one's window as fixed.
  const closestReading = (reading: ParsedTimeInput): ParsedTimeInput | null => {
    const plan = planInput(reading, false);
    if (plan.kind !== "restricted" || !plan.unavailable || !plan.range) return null;
    const { start, end } = plan.range;
    const calendar = reading.type === "relative" ? parseCalendarToken(reading.period) : null;
    const nowUs = Date.now() * 1000;
    const candidate: ParsedTimeInput = hostCan("rolling")
      ? {
          type: "relative",
          period: calendar
            ? CLOSEST_ROLLING[calendar.unit]
            : formatLimitShorthand(
                Math.max(1, Math.ceil((Math.min(end, nowUs) - start) / MICROS_PER_HOUR)),
              ),
        }
      : { type: "timestamp", startMicros: start, endMicros: Math.min(end, nowUs) };
    const closest = planInput(candidate, false).kind;
    return closest === "rolling" || closest === "absolute" ? candidate : null;
  };

  // A greyed reading is followed by what can apply instead: the closest storable range, or the longest the limit allows.
  const withExtraRows = (
    readings: ParsedTimeInput[],
  ): { reading: ParsedTimeInput; tag: SuggestionTag }[] => {
    const rows: { reading: ParsedTimeInput; tag: SuggestionTag }[] = [];
    for (const reading of readings) {
      rows.push({ reading, tag: null });
      const closest = closestReading(reading);
      if (closest) rows.push({ reading: closest, tag: { closest: true } });
    }
    const hours = props.queryRangeRestrictionInHour;
    const over = hours > 0 ? rows.findIndex((row) => isOverLimit(row.reading)) : -1;
    const allowed = over >= 0 ? longestAllowed(rows[over].reading, hours) : null;
    if (allowed) rows.splice(over + 1, 0, { reading: allowed, tag: { longestAllowed: true } });
    return rows;
  };

  // A typed period that is also this or the previous calendar period lists that live row beside it.
  const withCalendarTwin = (readings: ParsedTimeInput[]): ParsedTimeInput[] => {
    const first = readings[0];
    if (!hostCan("calendar") || first?.type !== "absolute" || !first.name) return readings;
    const { start, end } = zonelessToMicros(first, false);
    const twin = CALENDAR_TWIN_UNITS.flatMap((unit) =>
      [0, -1].map((offset) => `calendar:${unit}:${offset}`),
    ).find((token) => {
      const bounds = resolveCalendarPeriodBounds(token, zone.value, Date.now(), weekStartsOn());
      return bounds?.startTime === start && bounds.endTime === end;
    });
    if (!twin) return readings;
    return [first, { type: "relative", period: twin }, ...readings.slice(1)];
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

  // `From here to now` runs to the end of today, so a refresh keeps filling it until midnight (O1).
  const anchorReadings = (anchorUs: number): ParsedTimeInput[] => {
    const nowUs = Date.now() * 1000;
    const endOfToday = clock.civilDayStart(addCivilDays(convertUnixTime(nowUs).date, 1));
    return anchorRows(anchorUs, nowUs).map((row) => ({
      type: "timestamp" as const,
      startMicros: row.startUs,
      endMicros: row.id === "to-now" ? endOfToday : row.endUs,
      centreMicros: anchorUs,
    }));
  };

  const showAnchors = (anchorUs: number, keepActive: boolean) => {
    const rows = anchorRows(anchorUs, Date.now() * 1000);
    inputSuggestions.value = anchorReadings(anchorUs);
    suggestionTags.value = rows.map((row) => ({ anchor: row.id }));
    const preferred = rows.findIndex((row) => row.id === preferredAnchor());
    activeSuggestion.value = keepActive
      ? Math.min(activeSuggestion.value, rows.length - 1)
      : Math.max(preferred, 0);
  };

  // Text with two readings, or a comparison, lists its rows with no cursor until one is chosen.
  const showReadings = (readings: ParsedTimeInput[], waits: boolean, keepActive: boolean) => {
    const rows = withExtraRows(readings);
    const offered = rows.map((row) => row.reading);
    inputSuggestions.value = offered;
    suggestionTags.value = rows.map((row) => row.tag);
    const first = offered.findIndex((reading) => !suggestionBlocked(reading));
    const last = Math.max(offered.length - 1, 0);
    if (keepActive) activeSuggestion.value = Math.min(activeSuggestion.value, last);
    else activeSuggestion.value = waits ? -1 : Math.max(first, 0);
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
    textAnswer.value = null;
    ambiguous.value = false;
    if (!text) {
      inputReading.value = null;
      inputSuggestions.value = [];
      return;
    }
    const options = parseOptions();
    const read = readTimeText(text, options);
    textAnswer.value = read.answer ?? null;
    ambiguous.value = read.ambiguous;
    inputReversed.value = read.answer === "reversed";
    inputFuture.value = read.answer === "future";
    inputReading.value = read.answer ? null : parseTimeInput(text, options);
    const anchorUs = read.ambiguous ? null : loneInstant(text, options);
    if (anchorUs !== null) {
      showAnchors(anchorUs, keepActive);
      return;
    }
    const waits = read.ambiguous || read.answer === "compare";
    // A reading the picker would refuse is not offered, as picking it could do nothing.
    const listed = withCalendarTwin(read.readings)
      .filter((reading) => isFutureReading(reading) || planInput(reading, false).kind !== "refused")
      .slice(0, MAX_SUGGESTIONS);
    const unavailable = listed.some((reading) => closestReading(reading) !== null);
    if (listed.length > 1 || waits || unavailable) {
      showReadings(listed, waits, keepActive);
      return;
    }
    readingOnly.value = needsReadingRow(inputReading.value);
    const offered = readingOnly.value && inputReading.value ? [inputReading.value] : [];
    showReadings(offered, false, keepActive);
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

  // Text with two readings, or a comparison, has no cursor row until one is chosen.
  const waitsForPick = computed(
    () =>
      (ambiguous.value || textAnswer.value === "compare") &&
      inputSuggestions.value.length > 0 &&
      activeSuggestion.value < 0 &&
      listCursor.value < 0,
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
    return planTyped(reading, inputAsUtc.value);
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
    if (isFutureReading(reading) && reading.type !== "relative") {
      const { start, end } =
        reading.type === "timestamp"
          ? { start: reading.startMicros, end: reading.endMicros }
          : zonelessToMicros(reading, inputAsUtc.value);
      return { key, label: rowRangeLabel(start, end, reading), hint: "", relative: false };
    }
    if (tag && "anchor" in tag && plan.kind === "absolute") {
      const sameDay = convertUnixTime(plan.start).date === convertUnixTime(plan.end).date;
      const span = formatAnchorSpan({ id: tag.anchor, startUs: plan.start, endUs: plan.end }, t, {
        timezone: zone.value,
        locale: intlLocale.value,
        withDay: tag.anchor !== "to-now" && !sameDay,
      });
      return {
        key,
        label: String(anchorWindowLabel(tag.anchor, t)),
        hint: span,
        relative: false,
      };
    }
    if (plan.kind === "rolling" || (plan.kind === "restricted" && reading.type === "relative")) {
      const period =
        plan.kind === "rolling"
          ? `${plan.value}${plan.unit}`
          : reading.type === "relative"
            ? reading.period
            : text;
      return { key, label: String(relativeLabel(period)), hint: text, relative: true };
    }
    if (plan.kind === "calendar") {
      const label = plan.name ?? String(relativeLabel(plan.token));
      return { key, label, hint: text, relative: true };
    }
    const range = plan.kind === "absolute" ? plan : plan.kind === "restricted" ? plan.range : null;
    if (!range) return { key, label: text, hint: "", relative: false };
    // The formatter names a fixed range that is exactly a period, so typed and stepped ranges read alike.
    const typedName = reading.type === "absolute" ? reading.name : undefined;
    const name =
      timeRangeName({ kind: "fixed", startUs: range.start, endUs: range.end }, rangeContext()) ??
      typedName;
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
                : tag && "closest" in tag
                  ? String(t("dateTime.closestMatch"))
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

  // Text that reads as fixed dates has its own rows, so rows matched by name would only compete with them.
  const listRows = computed(() => {
    if (!typing.value) return defaultRows.value;
    if (inputPlan.value?.kind === "absolute") return [];
    return filterTimeRangeList(defaultRows.value, inputText.value, readPeriod.value);
  });

  // What an example reads as on this host; "" when the host could not apply it.
  const exampleMeta = (text: string): string => {
    const reading = parseTimeInput(text, parseOptions());
    const plan = reading ? planInput(reading, false) : null;
    if (plan?.kind === "rolling") return String(relativeLabel(`${plan.value}${plan.unit}`));
    if (plan?.kind === "calendar") return String(relativeLabel(plan.token));
    if (plan?.kind !== "absolute") return "";
    const range = { kind: "fixed" as const, startUs: plan.start, endUs: plan.end };
    return (
      timeRangeName(range, rangeContext()) ??
      formatRangeLabel(
        { startUs: plan.start, endUs: plan.end },
        { ...labelOptions(), surface: "row" },
      )
    );
  };

  const exampleSet = computed<string[]>(() => {
    if (!hostCan("rolling") && !hostCan("calendar")) return FIXED_EXAMPLES;
    if (!intlLocale.value.toLowerCase().startsWith("en")) return NUMERIC_EXAMPLES;
    return props.preset === "dashboard" || props.preset === "form"
      ? DASHBOARD_EXAMPLES
      : OPS_EXAMPLES;
  });

  // An Enter that read nothing, as opposed to one refused with its own reason.
  const failedEnter = computed(
    () => inputError.value && inputRefusal.value === null && inputText.value.trim() !== "",
  );

  // Typed text that reads as nothing teaches the grammar: five examples before Enter, three after it.
  const exampleRows = computed<TimeRangeListRow[]>(() => {
    if (!failedEnter.value) {
      if (!typing.value || readPending.value || inputReading.value || inputFuture.value) return [];
      if (textAnswer.value !== null || suggestionListRows.value.length > 0) return [];
      if (listRows.value.length > 0 || readingRows.value.length > 0) return [];
    }
    const examples = exampleSet.value
      .map((text) => ({ text, meta: exampleMeta(text) }))
      .filter((example) => example.meta !== "");
    const shown = failedEnter.value ? examples.slice(0, FAILED_EXAMPLE_COUNT) : examples;
    return shown.map((example, index) => ({
      id: `example-${index}`,
      kind: "example" as const,
      label: example.text,
      meta: example.meta,
      disabled: false,
      testId: `date-time-list-example-${index}`,
      group: 0,
    }));
  });

  // The last day of a running named period, as `Dec 31` (with its year when not this one).
  const lastDayText = (endUs: number): string => {
    const last = new Date((endUs - 1) / 1000);
    const sameYear =
      convertUnixTime(endUs - 1).date.slice(0, 4) === String(new Date().getFullYear());
    return new Intl.DateTimeFormat(intlLocale.value, {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
      timeZone: zone.value,
    }).format(last);
  };

  // `Q4 2026 is in progress. It ends Dec 31.` above the rows of a typed period that runs past now.
  const inProgressHeading = (): string | undefined => {
    const index = Math.max(activeSuggestion.value, 0);
    const reading = inputSuggestions.value[index];
    const plan = reading ? planInput(reading, inputAsUtc.value) : null;
    if (plan?.kind !== "absolute" || plan.end <= Date.now() * 1000) return undefined;
    const range = { kind: "fixed" as const, startUs: plan.start, endUs: plan.end };
    const period = timeRangeName(range, rangeContext());
    if (!period) return undefined;
    return String(t("dateTime.periodInProgress", { period, date: lastDayText(plan.end) }));
  };

  const listHeading = computed<string | undefined>(() => {
    if (exampleRows.value.length > 0) {
      return String(t(failedEnter.value ? "common.timeRangeInputError" : "dateTime.noMatchYet"));
    }
    if (!suggestionsOpen.value) return undefined;
    if (textAnswer.value === "compare") return String(t("dateTime.compareNotAvailable"));
    if (ambiguous.value) {
      return String(t("dateTime.twoReadings", { text: inputText.value.trim() }));
    }
    const typed = inputReading.value;
    const anchored = suggestionTags.value.some((tag) => !!tag && "anchor" in tag);
    if (anchored && typed?.type === "timestamp" && typed.epochUnit) {
      return String(t("dateTime.readAsEpochPick", { unit: typed.epochUnit }));
    }
    return inProgressHeading();
  });

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
    const plan = planTyped(reading, asUtc);
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
    if (textAnswer.value === "fiscalUnset") {
      inputRefusal.value = t("dateTime.fiscalYearUnset");
      inputError.value = true;
      return;
    }
    // Text with a reading of its own applies it at once, so a fast Enter never waits on the read delay.
    const unseenList = !listWasOpen && !inputReading.value;
    if (inputSuggestions.value.length > 0 && unseenList && !readingOnly.value) {
      suggestionsDismissed.value = false;
      return;
    }
    // Two readings, or a comparison, wait for a row to be chosen.
    if (waitsForPick.value) {
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
    textAnswer,
    ambiguous,
    waitsForPick,
    fiscalUnset,
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
