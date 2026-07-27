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
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getLanguage } from "@/utils/cookies";

vi.mock("@/utils/cookies", () => ({
  getLanguage: vi.fn(),
  setLanguage: vi.fn(),
}));

import { getNumberLocale, APP_LOCALE_TO_BCP47 } from "@/locales/numberFormat";
import { localeFileMap } from "@/locales";

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
});

describe("getNumberLocale (locale format unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps app language codes to valid BCP-47 tags", () => {
    const cases: Array<[string, string]> = [
      ["en-us", "en-US"],
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
});
