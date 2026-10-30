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

import { describe, expect, it } from "vitest";

import {
  CUSTOM_CHOICE,
  DEFAULT_CHOICE,
  bannerColorsFor,
  colorChoiceFor,
  isHexColor,
  presetKeyFor,
} from "./announcementAppearance";

describe("isHexColor", () => {
  it("accepts only six-digit hex with a leading #", () => {
    expect(isHexColor("#1D4ED8")).toBe(true);
    expect(isHexColor("#1d4ed8")).toBe(true);
    for (const bad of ["#FFF", "1D4ED8", "#1D4ED8FF", "#GGGGGG", "blue", "", undefined, 42]) {
      expect(isHexColor(bad), String(bad)).toBe(false);
    }
  });
});

describe("bannerColorsFor", () => {
  it("paints the mode's colour with readable text", () => {
    expect(bannerColorsFor({ light: "#FEF3C7" }, "light")).toEqual({
      background: "#FEF3C7",
      text: "#171717",
    });
    expect(bannerColorsFor({ dark: "#1E3A8A" }, "dark")).toEqual({
      background: "#1E3A8A",
      text: "#FFFFFF",
    });
  });

  it("falls back to the severity's colours when the mode has none", () => {
    expect(bannerColorsFor({ light: "#FEF3C7" }, "dark")).toBeUndefined();
    expect(bannerColorsFor(undefined, "light")).toBeUndefined();
    expect(bannerColorsFor({ light: "red" }, "light")).toBeUndefined();
  });
});

describe("colour choice", () => {
  it("re-opens a stored preset pair on its swatch, ignoring case", () => {
    expect(presetKeyFor("#dbeafe", "#1e3a8a")).toBe("blue");
    expect(colorChoiceFor("#DBEAFE", "#1E3A8A")).toBe("blue");
  });

  it("treats no colours as default and anything else as custom", () => {
    expect(colorChoiceFor("", "")).toBe(DEFAULT_CHOICE);
    expect(colorChoiceFor("#DBEAFE", "")).toBe(CUSTOM_CHOICE);
    expect(colorChoiceFor("#123456", "#654321")).toBe(CUSTOM_CHOICE);
  });
});
