// Copyright 2026 OpenObserve Inc.

import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import i18n, {
  loadLocaleMessages,
  loadSecurityMessages,
  securityMessagesRevision,
} from "@/locales";
import { readLocaleMessages } from "@/test/unit/helpers/localeFiles";

const global = i18n.global as any;
const setLocale = (locale: string) => {
  if (typeof global.locale === "string") global.locale = locale;
  else global.locale.value = locale;
};
const deSecurity = (readLocaleMessages("de-DE") as any).siem;

afterEach(() => setLocale("en-us"));

describe("lazy Security messages", () => {
  it("keeps the siem namespace out of a locale until it is asked for", async () => {
    await loadLocaleMessages("fr");
    expect(global.te("siem.nav.overview", "fr")).toBe(false);
    expect(global.te("common.save", "fr")).toBe(true);
  });

  it("loads the locale's own messages first, so they are not skipped once siem is merged", async () => {
    const before = securityMessagesRevision.value;
    await loadSecurityMessages("de");
    const t = (key: string, params?: Record<string, unknown>) =>
      global.t(key, params ?? {}, { locale: "de" });
    expect(t("siem.nav.overview")).toBe(deSecurity.nav.overview);
    expect(t("filterBar.validation.regexLength", { max: 5 })).toBe(
      "Verwenden Sie für das Muster höchstens 5 Zeichen.",
    );
    expect(securityMessagesRevision.value).toBeGreaterThan(before);
  });

  it("loads the new locale's Security messages when the language changes after a Security load", async () => {
    await loadSecurityMessages("en-us");
    expect(global.te("siem.nav.overview", "it")).toBe(false);
    setLocale("it");
    await nextTick();
    await expect
      .poll(() => global.t("siem.nav.overview", {}, { locale: "it" }))
      .toBe((readLocaleMessages("it-IT") as any).siem.nav.overview);
  });
});
