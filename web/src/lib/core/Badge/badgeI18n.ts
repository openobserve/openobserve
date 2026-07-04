// Copyright 2026 OpenObserve Inc.
//
// Tiny indirection so the badge registry can resolve i18n `labelKey`s WITHOUT
// OTag importing the i18n module graph (vue-i18n / @/locales). Importing those
// from a low-level UI primitive breaks any spec that mocks `vue-i18n`, and
// makes OTag unmountable in tests that don't install the i18n plugin.
//
// The app wires the real translator once, at i18n init (see src/locales). When
// no translator is registered (e.g. an isolated component test), we fall back
// to returning the key unchanged — harmless for the rare labelKey badge.

let translator: ((key: string) => string) | null = null;

/** Register the app translator. Called once from src/locales at startup. */
export function setBadgeTranslator(fn: (key: string) => string): void {
  translator = fn;
}

/** Resolve a label i18n key, or return the key if no translator is wired. */
export function translateBadgeLabel(key: string): string {
  try {
    return translator ? translator(key) : key;
  } catch {
    return key;
  }
}
