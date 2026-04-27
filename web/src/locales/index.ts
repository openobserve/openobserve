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

// Lazy loaders for every locale. Only the active locale (and English fallback)
// are downloaded on boot; the rest load on-demand when the user switches
// languages. Previously all 11 locales (~2 MB raw / ~280 KB brotli) shipped
// in the main bundle on every cold visit.
const localeLoaders: Record<string, () => Promise<{ default: any }>> = {
  "en-gb": () => import("./languages/en.json"),
  "zh-cn": () => import("./languages/zh.json"),
  "tr-turk": () => import("./languages/tr.json"),
  de: () => import("./languages/de.json"),
  es: () => import("./languages/es.json"),
  fr: () => import("./languages/fr.json"),
  it: () => import("./languages/it.json"),
  ja: () => import("./languages/ja.json"),
  ko: () => import("./languages/ko.json"),
  nl: () => import("./languages/nl.json"),
  pt: () => import("./languages/pt.json"),
};

export const getLocale = () => {
  const cookieLanguage = getLanguage();
  if (cookieLanguage) {
    return cookieLanguage;
  }
  const language = navigator.language.toLowerCase();
  const locales = Object.keys(localeLoaders);
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
  messages: {},
});

const loadedLocales = new Set<string>();

/**
 * Load and register a locale's messages with i18n. No-op if already loaded.
 * Call this before switching `i18n.global.locale.value` to a non-loaded language.
 */
export async function loadLocaleMessages(locale: string): Promise<void> {
  if (loadedLocales.has(locale)) {
    return;
  }
  const loader = localeLoaders[locale] || localeLoaders["en-gb"];
  const mod = await loader();
  i18n.global?.setLocaleMessage?.(locale as any, mod.default ?? mod);
  loadedLocales.add(locale);
}

/**
 * Promise that resolves once the initial locales (active + English fallback)
 * are loaded. main.ts must `await` this before mounting the app, otherwise
 * the first paint shows raw translation keys instead of translated text.
 */
export const initialLocaleLoad: Promise<void> = (async () => {
  const initial = getLocale();
  await Promise.all([
    loadLocaleMessages("en-gb"),
    initial !== "en-gb" ? loadLocaleMessages(initial) : Promise.resolve(),
  ]);
})();

export default i18n;
