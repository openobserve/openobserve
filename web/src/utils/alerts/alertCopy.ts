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

import { getIntlLocale } from "@/locales";
import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";

const NOUN_BY_STREAM: Record<string, I18nKey> = {
  logs: "alerts.verdict.events",
  metrics: "alerts.verdict.samples",
  traces: "alerts.verdict.spans",
};

const FORECAST_WINDOW_WORDS: Record<string, I18nKey> = {
  "6h": "alerts.forecast.window6h",
  "1d": "alerts.forecast.window1d",
  "2d": "alerts.forecast.window2d",
  "7d": "alerts.forecast.window7d",
};

/** What an alert counts: events, samples or spans by stream type; rows for SQL; series for PromQL. */
export function dataNoun(
  streamType: string | undefined,
  mode: string | undefined,
  count: number,
  t: TranslateFn,
): I18nText {
  if (mode === "sql") return t("alerts.verdict.rows", count);
  if (mode === "promql") return t("alerts.verdict.series", count);
  return t(NOUN_BY_STREAM[streamType ?? ""] ?? "alerts.verdict.events", count);
}

/** A number as the reader's locale writes it; anything that is not a number is shown as typed. */
export const formatNumber = (value: unknown): I18nText => {
  const n = typeof value === "number" ? value : Number(value);
  if (value === "" || value === null || value === undefined || !Number.isFinite(n)) {
    return raw(String(value ?? ""));
  }
  return raw(new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits: 2 }).format(n));
};

/** A duration in sentences: "10 minutes", "2 hours". */
export const durationWords = (minutes: number, t: TranslateFn): I18nText =>
  minutes >= 60 && minutes % 60 === 0
    ? t("alerts.sections.review.hours", { count: minutes / 60 }, minutes / 60)
    : t("alerts.sections.review.minutes", { count: minutes }, minutes);

/** The duration after "every": "minute", "10 minutes", "hour", so one never reads "every 1 minute". */
export const everyWords = (minutes: number, t: TranslateFn): I18nText =>
  minutes >= 60 && minutes % 60 === 0
    ? t("alerts.sections.review.everyHours", { count: minutes / 60 }, minutes / 60)
    : t("alerts.sections.review.everyMinutes", { count: minutes }, minutes);

/** A list joined the reader's way: "A, B and C". */
export const joinList = (items: readonly string[]): I18nText =>
  raw(new Intl.ListFormat(getIntlLocale(), { type: "conjunction" }).format(items));

/** A forecast's trend window in words: "2 days". */
export const forecastWindowWords = (window: string | undefined, t: TranslateFn): I18nText => {
  const key = FORECAST_WINDOW_WORDS[window ?? ""];
  return key ? t(key) : raw(window ?? "");
};
