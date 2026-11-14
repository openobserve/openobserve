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

import { computed, type ComputedRef } from "vue";
import { useStore } from "vuex";
import { getIntlLocale } from "@/locales";
import { safeTimezone } from "@/utils/dashboard/calendarPeriods";
import { readOrgTimeRangeSettings } from "@/utils/orgTimeRangeSettings";
import type { TimeRangeContext } from "@/utils/timeRangeModel";
import { weekStartsOn } from "@/utils/weekStart";

export type TimeRangeContextBase = Omit<TimeRangeContext, "nowUs">;

/** The app zone, locale, week start and org fiscal year; `now()` adds the clock at call time. */
export default function useTimeRangeContext(): {
  base: ComputedRef<TimeRangeContextBase>;
  now: () => TimeRangeContext;
  rangeGuardDays: ComputedRef<number | null>;
} {
  const store = useStore();
  const settings = computed(() =>
    readOrgTimeRangeSettings(store.state.organizationData?.organizationSettings),
  );
  const base = computed<TimeRangeContextBase>(() => ({
    zone: safeTimezone(store.state.timezone),
    weekStart: weekStartsOn(),
    locale: getIntlLocale(),
    fiscalYearStartMonth: settings.value.fiscalYearStartMonth,
  }));
  const now = (): TimeRangeContext => ({ ...base.value, nowUs: Date.now() * 1000 });
  const rangeGuardDays = computed(() => settings.value.rangeGuardDays);
  return { base, now, rangeGuardDays };
}
