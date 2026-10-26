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
import { gt, type I18nKey } from "@/types/i18n";
import { getIntlLocale } from "@/locales";
import { formatCalendarLabel, resolveCalendarPeriod } from "@/utils/dashboard/calendarPeriods";

/**
 * `gt()` rather than a threaded `t`: this is a module-scope pure helper that
 * components import directly (LogsNoEventsState) as well as being called from
 * the composable below, so there is no single setup scope to thread through.
 */
export function periodToLabel(period: string): string {
  if (!period || period === "absolute") return "";
  const calendarLabel = formatCalendarLabel(period, null, gt, getIntlLocale());
  if (calendarLabel) return calendarLabel;
  const value = parseInt(period, 10);
  const unit = period.slice(-1);
  // One pipe-plural message key per unit — each message carries the whole sentence
  // so word order stays translatable instead of being glued together here, and the
  // singular/plural split is the message's business (Slavic needs three forms).
  const units: Record<string, I18nKey> = {
    s: "common.pastSecond",
    m: "common.pastMinute",
    h: "common.pastHour",
    d: "common.pastDay",
    w: "common.pastWeek",
    M: "common.pastMonth",
  };
  return gt(units[unit] ?? "common.pastUnit", { count: value });
}

/** A rolling period that contains `period`, or "" for a calendar period older than every suggestion. */
export function nextWiderPeriod(period: string): string {
  const value = parseInt(period, 10);
  const unit = period.slice(-1);
  const toMins: Record<string, number> = {
    s: 1 / 60,
    m: 1,
    h: 60,
    d: 1440,
    w: 10080,
    M: 43200,
  };
  const calendar = resolveCalendarPeriod(period);
  if (calendar) {
    // Suggestions are windows ending now, so the smallest one reaching back to the period's start covers it.
    const sinceStart = (Date.now() * 1000 - calendar.startTime) / 60_000_000;
    if (sinceStart <= 1440) return "1d";
    if (sinceStart <= 10080) return "7d";
    return sinceStart <= 43200 ? "30d" : "";
  }
  const mins = value * (toMins[unit] ?? 1);
  if (mins <= 60) return "1d";
  if (mins <= 1440) return "7d";
  return "30d";
}

/**
 * Composable for "widen time range" empty-state UI logic.
 *
 * Generic: no domain-specific imports. Callers supply getters for dateType and
 * relativeTimePeriod, plus optional fallback label strings for absolute ranges.
 */
export default function useWidenRange(
  dateType: () => string,
  relativeTimePeriod: () => string,
  options: {
    absoluteRangeLabel?: string;
    absoluteExpandDesc?: string;
  } = {},
) {
  const { absoluteRangeLabel = "", absoluteExpandDesc = "" } = options;

  const relPeriod = computed(() => relativeTimePeriod() || "");
  const isRelative = computed(() => dateType() === "relative" && !!relPeriod.value);
  const suggestedPeriod = computed(() =>
    isRelative.value ? nextWiderPeriod(relPeriod.value) : "7d",
  );
  const currentPeriodLabel = computed(() =>
    isRelative.value ? periodToLabel(relPeriod.value) : absoluteRangeLabel,
  );
  const suggestedPeriodLabel = computed(() => periodToLabel(suggestedPeriod.value));
  const expandRangeSublabel = computed(() => {
    if (!isRelative.value) return absoluteExpandDesc;
    if (!suggestedPeriod.value) return "";
    return `${currentPeriodLabel.value} → ${suggestedPeriodLabel.value}`;
  });

  return {
    relPeriod,
    isRelative,
    suggestedPeriod,
    currentPeriodLabel,
    suggestedPeriodLabel,
    expandRangeSublabel,
  };
}
