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

  return { formatElapsed, formatCountdown };
}
