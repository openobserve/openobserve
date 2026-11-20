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

import { useI18nTyped, type I18nText } from "@/types/i18n";
import { elapsedParts } from "./overviewFormat";

const HOUR_S = 3600;
const DAY_S = 86_400;

export function useOverviewTime() {
  const { t } = useI18nTyped();

  // shows the two largest non-zero units so "3h 5m" and "2d 4h" stay short
  const formatElapsed = (ms: number): I18nText => {
    const { days, hours, minutes } = elapsedParts(ms);
    if (days > 0) return t("overview.time.daysHours", { days, hours });
    if (hours > 0) return t("overview.time.hoursMinutes", { hours, minutes });
    return t("overview.time.minutes", { minutes });
  };

  const formatCountdown = (resetsAtMicros: number, nowMs: number): I18nText =>
    formatElapsed(Math.floor(resetsAtMicros / 1000) - nowMs);

  // "24 hours", not "1 day": a range under two days is read in hours, as the picker names it
  const formatRangeWords = (seconds: number): I18nText => {
    const unit = seconds >= 2 * DAY_S ? "days" : seconds >= HOUR_S ? "hours" : "minutes";
    const size = { days: DAY_S, hours: HOUR_S, minutes: 60 }[unit];
    const count = Math.round((seconds / size) * 10) / 10;
    return t(`regionStatus.rangeLengthSpoken.${unit}`, { count: count.toLocaleString() }, count);
  };

  return { formatElapsed, formatCountdown, formatRangeWords };
}
