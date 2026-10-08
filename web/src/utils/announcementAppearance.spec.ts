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
  COLOR_PRESETS,
  DARK_TEXT,
  LIGHT_TEXT,
  backgroundFor,
  bannerColorVars,
  contrastRatio,
  isHexColor,
  presetFor,
  textColorFor,
} from "./announcementAppearance";

describe("isHexColor", () => {
  it("accepts only #RRGGBB", () => {
    expect(isHexColor("#1D4ED8")).toBe(true);
    expect(isHexColor("#1d4ed8")).toBe(true);
    expect(isHexColor("#FFF")).toBe(false);
    expect(isHexColor("1D4ED8")).toBe(false);
    expect(isHexColor("blue")).toBe(false);
    expect(isHexColor(undefined)).toBe(false);
  });
});

describe("textColorFor", () => {
  it("puts white on dark backgrounds and near-black on light ones", () => {
    expect(textColorFor("#000000")).toBe(LIGHT_TEXT);
    expect(textColorFor("#1E3A8A")).toBe(LIGHT_TEXT);
    expect(textColorFor("#FFFFFF")).toBe(DARK_TEXT);
    expect(textColorFor("#FEF3C7")).toBe(DARK_TEXT);
  });

  it("picks whichever of the two contrasts more", () => {
    for (const background of ["#2563EB", "#3B82F6", "#E2E8F0", "#808080"]) {
      const chosen = textColorFor(background);
      const other = chosen === LIGHT_TEXT ? DARK_TEXT : LIGHT_TEXT;
      expect(contrastRatio(background, chosen)).toBeGreaterThanOrEqual(
        contrastRatio(background, other),
      );
    }
  });

  it("matches the WCAG ratio for black on white", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
  });
});

describe("presetFor", () => {
  it("recognises a stored pair as its preset, ignoring case", () => {
    expect(presetFor("#dbeafe", "#1E3A8A")?.key).toBe("blue");
  });

  it("finds nothing for a pair that only half matches", () => {
    expect(presetFor("#DBEAFE", "#000000")).toBeUndefined();
  });

  it("has every preset as a valid hex pair", () => {
    for (const preset of COLOR_PRESETS) {
      expect(isHexColor(preset.light) && isHexColor(preset.dark)).toBe(true);
    }
  });
});

describe("backgroundFor", () => {
  it("returns the colour for the mode, or nothing to fall back to the variant", () => {
    expect(backgroundFor({ light: "#DBEAFE" }, "light")).toBe("#DBEAFE");
    expect(backgroundFor({ light: "#DBEAFE" }, "dark")).toBeUndefined();
    expect(backgroundFor({ dark: "red" }, "dark")).toBeUndefined();
    expect(backgroundFor(undefined, "light")).toBeUndefined();
  });
});

describe("bannerColorVars", () => {
  it("carries the mode's background and its contrasting text as custom properties", () => {
    expect(bannerColorVars({ light: "#FEF3C7", dark: "#1E3A8A" }, "light")).toEqual({
      "--announcement-bg": "#FEF3C7",
      "--announcement-fg": "#171717",
    });
    expect(bannerColorVars({ light: "#FEF3C7", dark: "#1E3A8A" }, "dark")).toEqual({
      "--announcement-bg": "#1E3A8A",
      "--announcement-fg": "#FFFFFF",
    });
  });

  it("returns nothing so the severity styling applies", () => {
    expect(bannerColorVars({ light: "#FEF3C7" }, "dark")).toBeUndefined();
    expect(bannerColorVars(null, "light")).toBeUndefined();
  });
});
