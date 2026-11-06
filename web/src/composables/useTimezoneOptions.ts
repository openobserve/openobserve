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

import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { browserTimezone, canonicalTimezone, timezoneSearchText } from "@/utils/timezoneAliases";
import { timezoneSearchMatcher } from "@/utils/timezoneSearch";

export type TimezoneOption = {
  label: I18nText;
  value: string;
  /** The zone's legacy names, so a search for `Calcutta` still finds `Asia/Kolkata`. */
  searchText?: string;
  /** Also finds the zone by abbreviation (`IST`) or UTC offset (`UTC+5:30`, `GMT-8`). */
  matchSearch?: (term: string) => boolean;
};

export interface UseTimezoneOptionsConfig {
  /** Lead with a "Browser Time (<zone>)" entry, whose value callers resolve before saving. */
  browserEntry?: boolean;
  /** The stored zone, kept as an option under its own value so a save never rewrites it. */
  current?: MaybeRefOrGetter<string | null | undefined>;
}

const supportedZones = (): string[] =>
  typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone").map(canonicalTimezone)
    : [];

/** `zones` with `current` in it: in its canonical name's place when listed, else after UTC. */
export const withCurrentZone = (zones: string[], current: string | null | undefined): string[] => {
  if (!current || zones.includes(current)) return zones;
  const slot = zones.indexOf(canonicalTimezone(current));
  if (slot >= 0) return zones.map((zone, i) => (i === slot ? current : zone));
  const afterUtc = zones.indexOf("UTC") + 1;
  return [...zones.slice(0, afterUtc), current, ...zones.slice(afterUtc)];
};

/** The IANA zones for a timezone select: optional browser entry, then UTC, then the rest. */
export function useTimezoneOptions(config: UseTimezoneOptionsConfig = {}) {
  const { t } = useI18nTyped();
  const browserTz = browserTimezone();
  // Not translated, and on the raw zone: stored reports hold this exact shape and resolveBrowserTimezone parses it.
  const browserTimeValue = `Browser Time (${Intl.DateTimeFormat().resolvedOptions().timeZone})`;

  const listed = [
    ...(config.browserEntry ? [browserTimeValue] : []),
    ...new Set(["UTC", ...supportedZones()]),
  ];
  const zones = computed(() => withCurrentZone(listed, toValue(config.current)));

  // A legacy stored name shows under its canonical name, so one zone never reads two ways.
  const timezoneOptions = computed<TimezoneOption[]>(() =>
    zones.value.map((tz) => {
      if (tz === browserTimeValue) {
        const label = t("common.browserTimeWithZone", { zone: browserTz });
        return { label, value: tz, matchSearch: timezoneSearchMatcher(browserTz, label) };
      }
      const zone = canonicalTimezone(tz);
      return {
        label: raw(zone),
        value: tz,
        searchText: timezoneSearchText(zone),
        matchSearch: timezoneSearchMatcher(tz, zone),
      };
    }),
  );

  return { browserTz, browserTimeValue, zones, timezoneOptions };
}
