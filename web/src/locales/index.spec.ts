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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getLanguage } from "@/utils/cookies";

vi.mock("@/utils/cookies", () => ({
  getLanguage: vi.fn(),
  setLanguage: vi.fn(),
}));

import { getNumberLocale, APP_LOCALE_TO_BCP47 } from "@/locales/numberFormat";
import { applyDocumentLocale, getLocale, isRtlLocale, localeFileMap } from "@/locales";

describe("locale registry stays in sync", () => {
  // locales/index.ts code-splits via import.meta.glob("./languages/*.json"), so
  // the files on disk decide what gets built. Nothing else enforces that the
  // registries agree, and every way they can drift fails silently:
  //   - file with no localeFileMap entry -> chunk built that nothing can load
  //     (hi.json sat unreachable this way for ~2 years)
  //   - localeFileMap entry with no file -> loadLocaleMessages() no-ops and the
  //     UI quietly renders English
  //   - localeFileMap entry missing from APP_LOCALE_TO_BCP47 -> numbers format
  //     as en-US while the rest of the UI is translated
  const languagesDir = resolve(dirname(fileURLToPath(import.meta.url)), "languages");

  it("has exactly one localeFileMap entry per language file on disk", () => {
    const onDisk = readdirSync(languagesDir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    const mapped = Object.values(localeFileMap)
      .map((f) => `${f}.json`)
      .sort();
    expect(onDisk).toEqual(mapped);
  });

  it("formats numbers for every locale it can load", () => {
    expect(Object.keys(APP_LOCALE_TO_BCP47).sort()).toEqual(Object.keys(localeFileMap).sort());
  });

  it("registers every translated locale with the translation pipeline", () => {
    const config = readFileSync(
      resolve(languagesDir, "../../../../scripts/translations/translator.py"),
      "utf8",
    );
    const languageNames = config.match(/LANGUAGE_NAMES = \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const supported = [...languageNames.matchAll(/^\s*"([^"]+)":\s*"[^"]+",?\s*$/gm)]
      .map((match) => `${match[1]}.json`)
      .sort();
    const translated = readdirSync(languagesDir)
      .filter((file) => file.endsWith(".json") && file !== "en-US.json")
      .sort();

    expect(supported).toEqual(translated);
  });

  // File stems become html lang values, so each must be a canonical BCP-47 tag.
  it("names every language file after a canonical BCP-47 tag", () => {
    for (const tag of Object.values(localeFileMap)) {
      expect(Intl.getCanonicalLocales(tag)).toEqual([tag]);
    }
  });
});

describe("getNumberLocale (locale format unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps app language codes to valid BCP-47 tags", () => {
    const cases: Array<[string, string]> = [
      ["en-us", "en-US"],
      ["ar", "ar-SA-u-nu-latn"],
      ["tr-turk", "tr-TR"],
      ["zh-cn", "zh-CN"],
      ["zh-tw", "zh-TW"],
      ["fr", "fr-FR"],
      ["es", "es-ES"],
      ["de", "de-DE"],
      ["it", "it-IT"],
      ["ja", "ja-JP"],
      ["ko", "ko-KR"],
      ["nl", "nl-NL"],
      ["pt", "pt-PT"],
    ];
    for (const [appCode, bcp47] of cases) {
      (getLanguage as any).mockReturnValue(appCode);
      expect(getNumberLocale()).toBe(bcp47);
    }
  });

  it("falls back to en-US for an unmapped language", () => {
    (getLanguage as any).mockReturnValue("xx-unknown");
    expect(getNumberLocale()).toBe("en-US");
  });

  it("produces Intl-formatted separators per locale", () => {
    (getLanguage as any).mockReturnValue("de");
    const de = new Intl.NumberFormat(getNumberLocale(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(1234567.89);
    expect(de).toBe("1.234.567,89");

    (getLanguage as any).mockReturnValue("en-us");
    const en = new Intl.NumberFormat(getNumberLocale(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(1234567.89);
    expect(en).toBe("1,234,567.89");
  });

  it("keeps Western digits for the Arabic UI", () => {
    (getLanguage as any).mockReturnValue("ar");
    const ar = new Intl.NumberFormat(getNumberLocale(), {
      useGrouping: false,
    }).format(1234567890);

    expect(ar).toBe("1234567890");
  });
});

describe("navigator language detection", () => {
  // Subtag matching prevents a region such as es-AR from being treated as Arabic.
  const withNavigatorLanguage = (tag: string, assert: () => void) => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "language");
    Object.defineProperty(navigator, "language", { value: tag, configurable: true });
    try {
      assert();
    } finally {
      if (descriptor) Object.defineProperty(navigator, "language", descriptor);
    }
  };

  beforeEach(() => {
    (getLanguage as any).mockReturnValue(undefined);
  });

  it.each([
    ["es-AR", "es"],
    ["es-ES", "es"],
    ["en-AR", "en-us"],
    ["pa-Arab-PK", "en-us"],
    ["ks-Arab-IN", "en-us"],
    ["ar-SA", "ar"],
    ["ar-EG", "ar"],
    ["ar", "ar"],
    ["fr-FR", "fr"],
  ])("resolves %s to %s", (tag, expected) => {
    withNavigatorLanguage(tag, () => expect(getLocale()).toBe(expected));
  });

  it("keeps the number locale in step with the UI locale", () => {
    withNavigatorLanguage("es-AR", () => expect(getNumberLocale()).toBe("es-ES"));
  });
});

describe("applyDocumentLocale", () => {
  it("identifies only registered RTL locales", () => {
    expect(isRtlLocale("ar")).toBe(true);
    expect(isRtlLocale("en-us")).toBe(false);
    expect(isRtlLocale("fr")).toBe(false);
  });

  it.each([
    ["ar", "ar-SA", "rtl"],
    ["fr", "fr-FR", "ltr"],
    ["unknown", "en-US", "ltr"],
  ])("sets %s document attributes", (locale, language, direction) => {
    applyDocumentLocale(locale);
    expect(document.documentElement.lang).toBe(language);
    expect(document.documentElement.dir).toBe(direction);
  });
});
