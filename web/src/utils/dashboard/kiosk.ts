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

import type { LocationQuery, LocationQueryValue } from "vue-router";
import { generateDurationLabel, parseDuration } from "@/utils/date";
import type { I18nKey, I18nText, TranslateFn } from "@/types/i18n";

export type KioskTheme = "light" | "dark";
export type KioskThemeChoice = "current" | KioskTheme;

export interface KioskLinkOptions {
  refreshSeconds: number;
  theme: KioskThemeChoice;
  fit: boolean;
}

type QueryValue = LocationQueryValue | LocationQueryValue[] | undefined;

/** Used when the server has not published `min_auto_refresh_interval`. */
export const DEFAULT_MIN_REFRESH_SECONDS = 5;

/** What the setup popover proposes when the dashboard's own refresh is off. */
export const KIOSK_DEFAULT_REFRESH_SECONDS = 300;

/** Refresh choices offered by the TV mode setup popover, in seconds (0 = off). */
export const KIOSK_REFRESH_CHOICES = [0, 30, 60, 300, 900, 1800, 3600] as const;

const RETRY_BASE_MS = 5000;
const RETRY_CAP_WITHOUT_INTERVAL_MS = 60000;
const HUNG_FLOOR_MS = 30000;
const MIN_FIT_CELL_PX = 4;

const PAST_PERIOD_KEYS: Record<string, I18nKey> = {
  s: "common.pastSecond",
  m: "common.pastMinute",
  h: "common.pastHour",
  d: "common.pastDay",
  w: "common.pastWeek",
  M: "common.pastMonth",
};

const first = (value: QueryValue): LocationQueryValue | undefined =>
  Array.isArray(value) ? value[0] : value;

/** `?kiosk`, `?kiosk=true` and `?kiosk=1` turn kiosk on; anything else leaves it off. */
export const isKioskEnabled = (value: QueryValue): boolean => {
  const v = first(value);
  if (v === undefined) return false;
  if (v === null || v === "") return true;
  return v === "true" || v === "1";
};

export const parseKioskTheme = (value: QueryValue): KioskTheme | null => {
  const v = first(value);
  return v === "dark" || v === "light" ? v : null;
};

export const isFitEnabled = (value: QueryValue): boolean => {
  const v = first(value);
  return v === "true" || v === "1";
};

/** Kiosk refresh in seconds: garbage or zero is off, anything below the server minimum is raised to it. */
export const resolveKioskRefresh = (value: QueryValue, minSeconds?: number | null): number => {
  const v = first(value);
  if (!v) return 0;
  const seconds = parseDuration(String(v));
  if (!seconds) return 0;
  const floor = minSeconds && minSeconds > 0 ? minSeconds : DEFAULT_MIN_REFRESH_SECONDS;
  return Math.max(seconds, floor);
};

/** The kiosk-only params the dashboard's URL rewrite must carry over while kiosk is on. */
export const pickKioskParams = (query: LocationQuery): Record<string, string> => {
  if (!isKioskEnabled(query.kiosk)) return {};
  const out: Record<string, string> = { kiosk: "true" };
  const theme = parseKioskTheme(query.theme);
  if (theme) out.theme = theme;
  if (isFitEnabled(query.fit)) out.fit = "true";
  const timezone = first(query.timezone);
  if (timezone) out.timezone = timezone;
  return out;
};

export const stripKioskParams = (query: LocationQuery): LocationQuery => {
  const next = { ...query };
  delete next.kiosk;
  delete next.theme;
  delete next.fit;
  delete next.timezone;
  return next;
};

/** Query for a kiosk link: keeps the relative `period`, tab and variables exactly as they are. */
export const buildKioskQuery = (query: LocationQuery, options: KioskLinkOptions): LocationQuery => {
  const next = stripKioskParams(query);
  delete next.print;
  if (options.refreshSeconds > 0) next.refresh = generateDurationLabel(options.refreshSeconds);
  else delete next.refresh;
  next.kiosk = "true";
  const forcedTheme = parseKioskTheme(options.theme);
  if (forcedTheme) next.theme = forcedTheme;
  if (options.fit) next.fit = "true";
  const timezone = first(query.timezone);
  if (timezone) next.timezone = timezone;
  return next;
};

/** `name=value` pairs for every `var-*` param, for the read-only summary. */
export const summarizeVariables = (query: LocationQuery): string[] =>
  Object.keys(query)
    .filter((key) => key.startsWith("var-"))
    .map((key) => {
      const value = query[key];
      const text = Array.isArray(value) ? value.filter((v) => v !== null).join(", ") : value;
      return `${key.slice(4)}=${text ?? ""}`;
    });

/** Retry delay after `attempt` consecutive failed cycles; never longer than the refresh interval. */
export const retryDelayMs = (attempt: number, intervalSeconds: number): number => {
  const cap = intervalSeconds > 0 ? intervalSeconds * 1000 : RETRY_CAP_WITHOUT_INTERVAL_MS;
  const delay = RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(delay, cap);
};

/** A cycle still loading after this long is treated as hung, so a slow query is not cancelled every tick. */
export const hungAfterMs = (intervalSeconds: number): number =>
  Math.max(intervalSeconds * 2000, HUNG_FLOOR_MS);

export const staleAfterMs = (intervalSeconds: number): number => intervalSeconds * 2000;

/** Cell height that fits `rows` grid rows into `availablePx`, or null when there is nothing to fit. */
export const computeFitCellHeight = (availablePx: number, rows: number): number | null => {
  if (!(rows > 0) || !(availablePx > 0)) return null;
  return Math.max(MIN_FIT_CELL_PX, Math.floor(availablePx / rows));
};

/** Same wording as the toolbar refresh picker ("5 min", "Off"). */
export const formatRefreshLabel = (seconds: number, t: TranslateFn): I18nText => {
  if (!seconds) return t("common.off");
  if (seconds < 60) return t("common.secShort", { count: seconds });
  if (seconds < 3600) return t("common.minShort", { count: Math.round(seconds / 60) });
  if (seconds < 86400) return t("common.hrShort", { count: Math.round(seconds / 3600) });
  return t("common.dayShort", { count: Math.round(seconds / 86400) });
};

/** "Past 15 Minutes" for a relative period such as `15m`, or null when it is not one. */
export const formatRelativePeriod = (period: string | null | undefined, t: TranslateFn) => {
  const match = /^(\d+)([smhdwM])$/.exec(period ?? "");
  if (!match) return null;
  const count = Number(match[1]);
  return t(PAST_PERIOD_KEYS[match[2]], { count }, count);
};
