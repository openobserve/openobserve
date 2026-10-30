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

import type { LocationQueryValue } from "vue-router";
import { parseDuration } from "@/utils/date";
import type { I18nText, TranslateFn } from "@/types/i18n";
import { DEFAULT_MIN_REFRESH_SECONDS } from "@/utils/dashboard/kiosk";

type QueryValue = LocationQueryValue | LocationQueryValue[] | undefined;

/** Auto-refresh choices in seconds, shared by the toolbar control and the dashboard settings. */
export const AUTO_REFRESH_INTERVALS = [
  5, 10, 15, 30, 60, 300, 900, 1800, 3600, 7200, 86400,
] as const;

/** Short label for an interval ("30 sec", "5 min"); 0 is Off. */
export const autoRefreshLabel = (seconds: number, t: TranslateFn): I18nText => {
  if (!seconds) return t("common.off");
  if (seconds % 86400 === 0) return t("common.dayShort", { count: seconds / 86400 });
  if (seconds % 3600 === 0) return t("common.hrShort", { count: seconds / 3600 });
  if (seconds % 60 === 0) return t("common.minShort", { count: seconds / 60 });
  return t("common.secShort", { count: seconds });
};

/** The server's `min_auto_refresh_interval`, or the built-in floor when it is not published. */
export const minAutoRefreshSeconds = (configured: unknown): number => {
  const n = Number(configured);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MIN_REFRESH_SECONDS;
};

/** A saved interval as it applies: 0/absent stays Off, anything below the minimum is raised to it. */
export const effectiveDefaultRefresh = (saved: unknown, minSeconds: number): number => {
  const n = Number(saved);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(Math.floor(n), minSeconds);
};

/** Interval to apply when a dashboard opens: URL `refresh=` (even `Off`), then the saved default, then Off. */
export const resolveOpenRefreshInterval = (options: {
  urlRefresh: QueryValue;
  savedDefault: unknown;
  minSeconds: number;
}): number => {
  const { urlRefresh, savedDefault, minSeconds } = options;
  if (urlRefresh !== undefined) {
    const value = Array.isArray(urlRefresh) ? urlRefresh[0] : urlRefresh;
    const seconds = value ? parseDuration(String(value)) : 0;
    // A hand-typed URL below the minimum is turned off, as the toolbar has always done.
    return seconds >= minSeconds ? seconds : 0;
  }
  return effectiveDefaultRefresh(savedDefault, minSeconds);
};
