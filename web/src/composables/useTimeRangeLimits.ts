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

import { computed } from "vue";
import { convertToUtcTimestamp, timestampToTimezoneDate } from "@/utils/zincutils";
import { resolveCalendarPeriod } from "@/utils/dashboard/calendarPeriods";
import { exceedsRangeRestriction, formatCivilDay } from "@/utils/timeRangeRail";
import {
  formatLimitShorthand,
  rangeLimitReason,
  retentionFloorMicros,
} from "@/utils/timeRangeList";
import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { addCivilDays, MICROS_PER_HOUR, type TimeRangeZone } from "@/composables/useTimeRangeZone";

// Largest custom relative range per unit (~10 years), so a typo can't produce an absurd or overflowing range.
export const MAX_CUSTOM_RELATIVE_VALUE: Record<string, number> = {
  s: 315_360_000,
  m: 5_256_000,
  h: 87_600,
  d: 3_650,
  w: 520,
  M: 120,
};

// How far past this browser's now a page's range may reach, for data or a sharer's clock running ahead; further is cut.
const CLOCK_SKEW_MICROS = 24 * 60 * 60 * 1_000_000;
// Dec 30, 9999 UTC, so the year stays 9999 or less in every zone.
export const LATEST_INSTANT_US = Date.UTC(9999, 11, 30) * 1000;

export interface TimeRangeLimitProps {
  disableRelative: boolean;
  minDate: string;
  maxDate: string;
  queryRangeRestrictionInHour: number;
  queryRangeRestrictionMsg: string;
  retentionDays: number | null;
  futureAllowed?: boolean;
}

/** The bounds a picked range must stay within: the calendar's first and last day, retention and the page's range limit. */
export default function useTimeRangeLimits(props: TimeRangeLimitProps, clock: TimeRangeZone) {
  const { t } = useI18nTyped();
  const { zone, tooltipNow, intlLocale, absoluteToMicros, convertUnixTime } = clock;

  const calendarMinDate = computed(() => {
    if (props.disableRelative && props.minDate) return props.minDate;
    return "1999/01/01";
  });

  const calendarMaxDate = computed(() => {
    if (props.maxDate) return props.maxDate;
    return timestampToTimezoneDate(new Date().getTime(), zone.value, "yyyy/MM/dd");
  });

  // The exclusive end of maxDate (its next midnight), or now.
  const forwardCeilingMicros = () =>
    props.maxDate
      ? absoluteToMicros(addCivilDays(props.maxDate, 1), "00:00:00")
      : Date.now() * 1000;

  // Absolute-only pickers that allow the future, floored by minDate with no maxDate, book ahead; only their calendar and shift stop at now.
  const selectionCeilingMicros = () =>
    props.futureAllowed && props.disableRelative && props.minDate && !props.maxDate
      ? Number.POSITIVE_INFINITY
      : forwardCeilingMicros();

  const trustedCeilingMicros = () => {
    if (props.maxDate) return forwardCeilingMicros();
    const ceiling = selectionCeilingMicros();
    return Number.isFinite(ceiling) ? ceiling : LATEST_INSTANT_US;
  };

  const floorMicros = () => convertToUtcTimestamp(`${calendarMinDate.value} 00:00:00`, zone.value);

  // The calendar's own bounds for a start, named so a refusal says which one it hit.
  const startBoundError = (startMicros: number): I18nText | null => {
    if (!Number.isFinite(startMicros)) return null;
    const civilDay = (date: string) =>
      formatCivilDay(date, zone.value, tooltipNow.value, intlLocale.value);
    if (startMicros < floorMicros()) {
      return t("common.timeRangeBeforeMin", { date: civilDay(calendarMinDate.value) });
    }
    if (startMicros < selectionCeilingMicros()) return null;
    return props.maxDate
      ? t("common.timeRangeAfterMax", { date: civilDay(props.maxDate) })
      : t("common.timeRangeStartInFuture");
  };

  // A stored Recent range the calendar can show, with an end past the ceiling cut to it; null when it cannot.
  const boundedRange = (startUs: number, endUs: number): { start: number; end: number } | null => {
    if (!Number.isFinite(startUs) || !Number.isFinite(endUs) || endUs <= startUs) return null;
    if (startBoundError(startUs) !== null) return null;
    return { start: startUs, end: Math.min(endUs, selectionCeilingMicros()) };
  };

  // A parent's range is trusted before the calendar's floor and a clock skew past now, within the years every zone can show.
  // Past that it is cut to now like typed text, as only a picker that books ahead may hold the future.
  const trustedRange = (startUs: number, endUs: number): { start: number; end: number } | null => {
    if (!Number.isFinite(startUs) || !Number.isFinite(endUs) || endUs <= startUs) return null;
    const ceiling = Math.min(trustedCeilingMicros(), LATEST_INSTANT_US);
    const slack = props.maxDate || ceiling === LATEST_INSTANT_US ? 0 : CLOCK_SKEW_MICROS;
    if (startUs < 0 || startUs >= ceiling + slack) return null;
    const end = endUs > ceiling + slack ? ceiling : endUs;
    return end > startUs ? { start: startUs, end } : null;
  };

  const restrictionMessage = (): I18nText =>
    props.queryRangeRestrictionMsg
      ? raw(props.queryRangeRestrictionMsg)
      : t("common.timeRangeOverLimit", { count: props.queryRangeRestrictionInHour });

  const showRestrictionToast = () => {
    toast({ variant: "warning", message: restrictionMessage() });
  };

  const maxLimitText = (): I18nText =>
    t("dateTime.maxLimit", {
      limit: formatLimitShorthand(props.queryRangeRestrictionInHour),
    });

  const restrictionLimitMicros = () =>
    props.queryRangeRestrictionInHour > 0
      ? props.queryRangeRestrictionInHour * MICROS_PER_HOUR
      : Number.POSITIVE_INFINITY;

  const calendarExceedsRestriction = (token: string | null) => {
    const range = resolveCalendarPeriod(token, zone.value, tooltipNow.value);
    return (
      !!range &&
      exceedsRangeRestriction(range.startTime, range.endTime, props.queryRangeRestrictionInHour)
    );
  };

  const rangeLimits = computed(() => ({
    retentionFloorUs: retentionFloorMicros(props.retentionDays, tooltipNow.value),
    maxHours: props.queryRangeRestrictionInHour,
  }));

  const limitReason = (startUs: number, endUs: number): string | null =>
    rangeLimitReason(startUs, endUs, rangeLimits.value, {
      retention: String(t("dateTime.outsideRetention", { days: props.retentionDays ?? 0 })),
      restriction: String(maxLimitText()),
    });

  // Days wholly before retention are struck in the calendar; separate from minDate so typed text is not refused.
  const retentionFloorDay = computed<string | null>(() => {
    const floor = retentionFloorMicros(props.retentionDays, tooltipNow.value);
    if (floor === null) return null;
    const day = convertUnixTime(floor).date;
    return day > calendarMinDate.value ? day : null;
  });

  return {
    calendarMinDate,
    calendarMaxDate,
    forwardCeilingMicros,
    selectionCeilingMicros,
    floorMicros,
    startBoundError,
    boundedRange,
    trustedRange,
    restrictionMessage,
    showRestrictionToast,
    maxLimitText,
    restrictionLimitMicros,
    calendarExceedsRestriction,
    limitReason,
    retentionFloorDay,
  };
}

export type TimeRangeLimits = ReturnType<typeof useTimeRangeLimits>;
