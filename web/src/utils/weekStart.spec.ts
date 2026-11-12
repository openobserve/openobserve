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

import { afterEach, describe, expect, it, vi } from "vitest";
import { dateOrderLocale, weekStartsOn } from "./weekStart";

const browserLanguages = (languages: string[]) => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(languages);
  vi.spyOn(navigator, "language", "get").mockReturnValue(languages[0]);
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("weekStartsOn [#29]", () => {
  it.each([
    ["en-US", 0],
    ["en-GB", 1],
    ["de-DE", 1],
    ["ar-EG", 6],
  ])("starts %s weeks on day %i", (locale, day) => {
    expect(weekStartsOn(locale)).toBe(day);
  });

  it("defaults to the browser's first language", () => {
    browserLanguages(["en-GB", "en-US"]);
    expect(weekStartsOn()).toBe(1);
    browserLanguages(["en-US"]);
    expect(weekStartsOn()).toBe(0);
  });

  it("falls back to Monday for a tag Intl cannot read", () => {
    expect(weekStartsOn("not a locale!")).toBe(1);
  });
});

describe("dateOrderLocale [#12]", () => {
  it("follows the browser's region when it shares the UI language", () => {
    browserLanguages(["en-GB", "en-US"]);
    expect(dateOrderLocale("en-US")).toBe("en-GB");
  });

  it("keeps the UI locale when the browser speaks another language", () => {
    browserLanguages(["fr-FR"]);
    expect(dateOrderLocale("en-US")).toBe("en-US");
  });

  it("uses the browser when no UI locale is given", () => {
    browserLanguages(["en-IN"]);
    expect(dateOrderLocale()).toBe("en-IN");
  });
});
