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

import { createI18n } from "vue-i18n"; // import from runtime only
import { getLanguage } from "../utils/cookies";
import { setBadgeTranslator } from "@/lib/core/Badge/badgeI18n";

// Only the fallback locale (en-gb) is bundled into the main chunk. Every other
// language is code-split and loaded on demand via loadLocaleMessages() so we
// don't ship all 12 locale files (~3.9MB raw) to every user on first load.
import enLocale from "./languages/en.json";

// Maps an i18n locale code to its source file name (without extension).
// Exported so tests can assert it stays in sync with the files on disk — an
// unmapped file ships as a chunk nothing can load, and a mapping with no file
// silently falls back to en-gb.
export const localeFileMap: Record<string, string> = {
  "en-gb": "en",
  "zh-cn": "zh",
  "tr-turk": "tr",
  de: "de",
  es: "es",
  fr: "fr",
  it: "it",
  ja: "ja",
  ko: "ko",
  nl: "nl",
  pt: "pt",
  "zh-tw": "zh_TW",
};

export const getLocale = () => {
  const cookieLanguage = getLanguage();
  if (cookieLanguage) {
    return cookieLanguage;
  }
  const language = navigator.language.toLowerCase();
  const locales = Object.keys(localeFileMap);
  for (const locale of locales) {
    if (language.indexOf(locale) > -1) {
      return locale;
    }
  }

  // Default language is English
  return "en-gb";
};

const i18n = createI18n({
  locale: getLocale(),
  fallbackLocale: "en-gb",
  messages: {
    "en-gb": {
      ...enLocale,
    },
  },
});

// Wire the badge registry's i18n resolver (OTag labelKey → translated text)
// without coupling the low-level OTag component to this module graph.
setBadgeTranslator((key: string) => i18n.global.t(key as never));

type LocaleMessageSchema = Parameters<typeof i18n.global.setLocaleMessage>[1];

const localeLoaders = import.meta.glob<{ default: LocaleMessageSchema }>(
  "./languages/*.json",
);

/**
 * Loads and registers the messages for a locale on demand. No-op when the
 * locale is already loaded (e.g. the statically bundled en-gb fallback) or
 * unknown (the fallback locale then handles missing keys).
 */
export const loadLocaleMessages = async (locale: string): Promise<void> => {
  const availableLocales: readonly string[] = i18n.global.availableLocales;
  if (availableLocales.includes(locale)) {
    return;
  }
  const file = localeFileMap[locale];
  const loader = file && localeLoaders[`./languages/${file}.json`];
  if (!loader) {
    return;
  }
  const messages = await loader();
  i18n.global.setLocaleMessage(locale, messages.default);
};

export default i18n;
