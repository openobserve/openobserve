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

// Resolve the active app language without importing the i18n instance, so
// widely-used utils don't pull `createI18n` into their import graph (which
// breaks specs that partially mock vue-i18n).
const resolveAppLanguage = (): string => {
  const cookieLanguage = getLanguage();
  if (cookieLanguage) return cookieLanguage;

  const navLanguage = (navigator.language || "").toLowerCase();
  const match = Object.keys(APP_LOCALE_TO_BCP47).find(
    (code) => navLanguage.indexOf(code) > -1,
  );
  return match ?? "en-us";
};

/**
 * Returns a BCP-47 locale tag for the user's selected UI language, suitable for
 * `Intl.NumberFormat`. Falls back to "en-US" for unmapped languages.
 */
export const getNumberLocale = (): string =>
  APP_LOCALE_TO_BCP47[resolveAppLanguage()] ?? "en-US";
