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

import { ref, watch } from "vue";
import { createI18n } from "vue-i18n"; // import from runtime only
import { getLanguage } from "../utils/cookies";
import { setBadgeTranslator } from "@/lib/core/Badge/badgeI18n";

// Only the fallback locale (en-us) is bundled into the main chunk. Every other
// language is code-split and loaded on demand via loadLocaleMessages() so we
// don't ship every locale file to every user on first load.
import enLocale from "./languages/en-US.json?without=serviceVersions";

// Maps an i18n locale code to its source file name (without extension).
// Exported so tests can assert it stays in sync with the files on disk — an
// unmapped file ships as a chunk nothing can load, and a mapping with no file
// silently falls back to en-us.
export const localeFileMap: Record<string, string> = {
  "en-us": "en-US",
  ar: "ar-SA",
  "zh-cn": "zh-CN",
  "tr-turk": "tr-TR",
  de: "de-DE",
  es: "es-ES",
  fr: "fr-FR",
  it: "it-IT",
  ja: "ja-JP",
  ko: "ko-KR",
  nl: "nl-NL",
  pt: "pt-PT",
  "zh-tw": "zh-TW",
  ru: "ru-RU",
  pl: "pl-PL",
  vi: "vi-VN",
  th: "th-TH",
};

const RTL_LOCALES = new Set(["ar"]);

export const isRtlLocale = (locale: string): boolean => RTL_LOCALES.has(locale);

export const applyDocumentLocale = (locale: string): void => {
  if (typeof document === "undefined") return;
  document.documentElement.lang = localeFileMap[locale] ?? "en-US";
  document.documentElement.dir = isRtlLocale(locale) ? "rtl" : "ltr";
};

export const getLocale = () => {
  const cookieLanguage = getLanguage();
  if (cookieLanguage) {
    return cookieLanguage;
  }
  const language = navigator.language.toLowerCase();
  const locales = Object.keys(localeFileMap);
  for (const locale of locales) {
    if (language === locale || language.startsWith(`${locale}-`)) {
      return locale;
    }
  }

  // Default language is English
  return "en-us";
};

const i18n = createI18n({
  locale: getLocale(),
  fallbackLocale: "en-us",
  messages: {
    "en-us": {
      ...enLocale,
    },
  },
});

// Wire the badge registry's i18n resolver (OTag labelKey → translated text)
// without coupling the low-level OTag component to this module graph.
setBadgeTranslator((key: string) => i18n.global.t(key as never));

const activeLocale = (): string => {
  const active: unknown = i18n.global.locale;
  return String(
    typeof active === "string" ? active : (active as { value?: unknown } | null)?.value,
  );
};

/** BCP 47 tag of the active UI language, for Intl date formatting outside a component. */
export const getIntlLocale = (): string => localeFileMap[activeLocale()] ?? "en-US";

type LocaleMessageSchema = Parameters<typeof i18n.global.setLocaleMessage>[1];

const localeLoaders = import.meta.glob<{ default: LocaleMessageSchema }>([
  "./languages/*.json",
  "!./languages/en-US.json",
]);

/**
 * Loads and registers the messages for a locale on demand. No-op when the
 * locale is already loaded (e.g. the statically bundled en-us fallback) or
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
  // Merge, not set: a Security load may have merged its namespace into this locale first.
  i18n.global.mergeLocaleMessage(locale, messages.default);
};

/** Merges the en-US blocks the entry chunk leaves out; the app awaits it before the first render. */
export const loadLazyLocaleBlocks = async (): Promise<void> => {
  const serviceVersions = await import("./languages/en-US.json?block=serviceVersions");
  i18n.global.mergeLocaleMessage("en-us", { serviceVersions: serviceVersions.default });
};

// The `siem` namespace ships as its own chunk per locale so the entry does not carry it.
const securityLoaders = import.meta.glob<{ default: LocaleMessageSchema }>(
  "./languages/security/*.json",
);
const securityLoads = new Map<string, Promise<void>>();
let securityRequested = false;

/** Bumped after each Security merge, so a computed that resolves `siem.*` outside render re-runs. */
export const securityMessagesRevision = ref(0);

const loadSecurityLocale = (locale: string): Promise<void> => {
  const cached = securityLoads.get(locale);
  if (cached) return cached;
  const file = localeFileMap[locale];
  const loader = file && securityLoaders[`./languages/security/${file}.json`];
  if (!loader) return Promise.resolve();
  // The base locale goes first: merging into an unloaded locale would make loadLocaleMessages skip it.
  const pending = loadLocaleMessages(locale)
    .then(loader)
    .then((messages) => {
      i18n.global.mergeLocaleMessage(locale, messages.default);
      securityMessagesRevision.value += 1;
    })
    .catch((error: unknown) => {
      securityLoads.delete(locale);
      throw error;
    });
  securityLoads.set(locale, pending);
  return pending;
};

/** Loads the Security (`siem.*`) messages for the locale and the en-us fallback; cached per locale. */
export const loadSecurityMessages = async (locale: string = activeLocale()): Promise<void> => {
  securityRequested = true;
  await Promise.all([loadSecurityLocale("en-us"), loadSecurityLocale(locale)]);
};

watch(activeLocale, (locale) => {
  if (securityRequested) loadSecurityMessages(locale).catch(() => {});
});

export default i18n;
