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
import { useStore } from "vuex";
import { DateTime } from "luxon";
import { useI18nTyped } from "@/types/i18n";
import type { QueryHistoryEntry } from "@/services/query_history";
import { getIntlLocale } from "@/locales";
import { formatCalendarLabel } from "@/utils/dashboard/calendarPeriods";

/** The time window and run span of a recent search, and the zone its days are cut in. */
export const useRecentEntryText = () => {
  const store = useStore();
  const { t } = useI18nTyped();

  const zone = computed(() => {
    const tz = String(store.state.timezone ?? "");
    return !tz || ["local", "browser"].includes(tz.toLowerCase()) ? undefined : tz;
  });
  const at = (us: number) => DateTime.fromMillis(us / 1000, zone.value ? { zone: zone.value } : {});
  const sameDay = (a: number, b: number) => at(a).hasSame(at(b), "day");
  // A calendar preset is stored as its token ("calendar:day:0"), which reads as its rail label.
  const periodText = (period: string): string =>
    formatCalendarLabel(period, store.state.timezone, t, getIntlLocale()) ??
    t("recentSearches.relativeWindow", { period });

  const windowText = (entry: QueryHistoryEntry): string => {
    const time = entry.context.time;
    if (time?.type === "relative" && time.period) return periodText(time.period);
    if (time) {
      const end = sameDay(time.start_time, time.end_time) ? "HH:mm" : "LLL d HH:mm";
      return `${at(time.start_time).toFormat("LLL d HH:mm")} – ${at(time.end_time).toFormat(end)}`;
    }
    const legacy = entry.context.time_range;
    if (legacy && "period" in legacy) return periodText(legacy.period);
    return "";
  };

  const spanText = (entry: QueryHistoryEntry): string => {
    const last = at(entry.updated_at).toFormat("HH:mm");
    if (entry.run_count <= 1) return last;
    const ran = t("recentSearches.ranCount", { count: entry.run_count });
    if (sameDay(entry.created_at, entry.updated_at)) {
      return `${ran} · ${at(entry.created_at).toFormat("HH:mm")}–${last}`;
    }
    const span = `${at(entry.created_at).toFormat("LLL d HH:mm")} – ${at(entry.updated_at).toFormat("LLL d HH:mm")}`;
    return `${ran} · ${span}`;
  };

  return { zone, windowText, spanText };
};
