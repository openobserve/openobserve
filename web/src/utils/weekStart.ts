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

/** 0 = Sunday, as `Date.getDay()` and the calendar grid count. */
export type WeekDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const MONDAY: WeekDay = 1;

interface WeekInfoLocale {
  getWeekInfo?: () => { firstDay: number };
  weekInfo?: { firstDay: number };
}

/** The browser's first language: the source of week start and of typed day/month order. */
export const browserLanguage = (): string | undefined => {
  if (typeof navigator === "undefined") return undefined;
  return navigator.languages?.[0] ?? navigator.language;
};

/** First day of the week for a locale (default: the browser's first language); Monday when Intl has no week info. */
export const weekStartsOn = (locale: string | undefined = browserLanguage()): WeekDay => {
  if (!locale) return MONDAY;
  try {
    const tag = new Intl.Locale(locale) as Intl.Locale & WeekInfoLocale;
    // Intl numbers days 1 (Monday) to 7 (Sunday); older engines expose a getter instead of the method.
    const firstDay = tag.getWeekInfo?.().firstDay ?? tag.weekInfo?.firstDay;
    return typeof firstDay === "number" && firstDay >= 1 && firstDay <= 7
      ? ((firstDay % 7) as WeekDay)
      : MONDAY;
  } catch {
    return MONDAY;
  }
};
