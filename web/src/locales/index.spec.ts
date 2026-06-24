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
import { getLanguage } from "@/utils/cookies";

vi.mock("@/utils/cookies", () => ({
  getLanguage: vi.fn(),
  setLanguage: vi.fn(),
}));

import { getNumberLocale } from "@/locales/numberFormat";

describe("getNumberLocale (locale format unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps app language codes to valid BCP-47 tags", () => {
    const cases: Array<[string, string]> = [
      ["en-gb", "en-GB"],
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

  it("falls back to en-GB for an unmapped language", () => {
    (getLanguage as any).mockReturnValue("xx-unknown");
    expect(getNumberLocale()).toBe("en-GB");
  });

  it("produces Intl-formatted separators per locale", () => {
    (getLanguage as any).mockReturnValue("de");
    const de = new Intl.NumberFormat(getNumberLocale(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(1234567.89);
    expect(de).toBe("1.234.567,89");

    (getLanguage as any).mockReturnValue("en-gb");
    const en = new Intl.NumberFormat(getNumberLocale(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(1234567.89);
    expect(en).toBe("1,234,567.89");
  });
});
