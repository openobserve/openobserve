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
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

export interface TimezoneOption {
  label: I18nText;
  value: string;
}

export interface UseTimezoneOptionsConfig {
  /** Lead with a "Browser Time (<zone>)" entry, whose value callers resolve before saving. */
  browserEntry?: boolean;
}

const supportedZones = (): string[] =>
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

/** The IANA zones for a timezone select: optional browser entry, then UTC, then the rest. */
export function useTimezoneOptions(config: UseTimezoneOptionsConfig = {}) {
  const { t } = useI18nTyped();
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Not translated: stored reports hold this exact shape and resolveBrowserTimezone parses it.
  const browserTimeValue = `Browser Time (${browserTz})`;

  const zones = [
    ...(config.browserEntry ? [browserTimeValue] : []),
    ...new Set(["UTC", ...supportedZones()]),
  ];

  const timezoneOptions = computed<TimezoneOption[]>(() =>
    zones.map((tz) =>
      tz === browserTimeValue
        ? { label: t("common.browserTimeWithZone", { zone: browserTz }), value: tz }
        : { label: raw(tz), value: tz },
    ),
  );

  return { browserTz, browserTimeValue, zones, timezoneOptions };
}
