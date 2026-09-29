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

import { getLanguage } from "@/utils/cookies";

// App language codes are not all valid BCP-47, so map them for Intl.NumberFormat.
export const APP_LOCALE_TO_BCP47: Record<string, string> = {
  "en-us": "en-US",
  ar: "ar-SA-u-nu-latn",
  "tr-turk": "tr-TR",
  "zh-cn": "zh-CN",
  "zh-tw": "zh-TW",
  fr: "fr-FR",
  es: "es-ES",
  de: "de-DE",
  it: "it-IT",
  ja: "ja-JP",
  ko: "ko-KR",
  nl: "nl-NL",
  pt: "pt-PT",
  ru: "ru-RU",
  pl: "pl-PL",
  vi: "vi-VN",
};

export const NUMBER_LOCALE_TAGS: readonly string[] = [
  ...new Set([
    ...Object.values(APP_LOCALE_TO_BCP47),
    "en-GB",
    "en-IN",
    "de-AT",
    "de-CH",
    "fr-CA",
    "fr-CH",
    "es-MX",
    "pt-BR",
    "cs-CZ",
    "sk-SK",
    "sv-SE",
    "nb-NO",
    "da-DK",
    "fi-FI",
    "uk-UA",
    "hi-IN",
    "id-ID",
    "th-TH",
    "he-IL",
    "el-GR",
    "hu-HU",
    "ro-RO",
    "bg-BG",
    "hr-HR",
    "ur-PK",
    "fa-IR",
    "fil-PH",
    "ms-MY",
    "sw-TZ",
    "sr-RS",
  ]),
];

// The Locale Format unit pinned to one locale is saved as the unit itself, e.g. "locale:cs-CZ".
const LOCALE_UNIT_PREFIX = "locale:";

// Resolve the active app language without importing the i18n instance, so
// widely-used utils don't pull `createI18n` into their import graph (which
// breaks specs that partially mock vue-i18n).
const resolveAppLanguage = (): string => {
  const cookieLanguage = getLanguage();
  if (cookieLanguage) return cookieLanguage;

  const navLanguage = (navigator.language || "").toLowerCase();
  const match = Object.keys(APP_LOCALE_TO_BCP47).find(
    (code) => navLanguage === code || navLanguage.startsWith(`${code}-`),
  );
  return match ?? "en-us";
};

/**
 * Returns a BCP-47 locale tag for the user's selected UI language, suitable for
 * `Intl.NumberFormat`. Falls back to "en-US" for unmapped languages.
 */
export const getNumberLocale = (): string => APP_LOCALE_TO_BCP47[resolveAppLanguage()] ?? "en-US";

/** Returns the canonical form of `tag`, or null when `Intl.NumberFormat` cannot use it. */
export const toSupportedNumberLocale = (tag?: string | null): string | null => {
  if (typeof tag !== "string" || !tag.trim()) return null;
  try {
    const [canonical] = Intl.getCanonicalLocales(tag.trim());
    if (!canonical) return null;
    return Intl.NumberFormat.supportedLocalesOf([canonical]).length > 0 ? canonical : null;
  } catch {
    return null;
  }
};

/** Resolves a panel's chosen locale; empty or unusable values mean Auto (the viewer's UI language). */
export const resolveNumberLocale = (tag?: string | null): string =>
  toSupportedNumberLocale(tag) ?? getNumberLocale();

/** Unit value for the Locale Format unit pinned to `tag`. */
export const toLocaleUnit = (tag: string): string => `${LOCALE_UNIT_PREFIX}${tag}`;

/** The locale tag of a pinned Locale Format unit, or null for any other unit. */
export const localeFromUnit = (unit?: string | null): string | null =>
  typeof unit === "string" && unit.startsWith(LOCALE_UNIT_PREFIX)
    ? unit.slice(LOCALE_UNIT_PREFIX.length)
    : null;
