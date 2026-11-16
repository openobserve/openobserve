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

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it } from "vitest";

import { PREDEFINED_THEMES } from "@/constants/themes";
import { applyThemeColors } from "@/utils/theme";

import { composite, contrastRatio, resolveColor, resolveTokens } from "./colorMath";

const here = dirname(fileURLToPath(import.meta.url));
const TOKEN_FILES = ["base.css", "semantic.css", "component.css", "dark.css"];
const THEMES = resolveTokens(TOKEN_FILES.map((file) => readFileSync(join(here, file), "utf8")));
const UTILITIES = readFileSync(join(here, "../../../styles/utilities.css"), "utf8");

const TEXT_MIN = 4.5;
const MODES = ["light", "dark"] as const;
const PRIMARY_SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];

const ITEM_DISABLED = "--color-time-range-item-disabled";
const BUTTON_FILL = "--color-button-primary-disabled";
const BUTTON_TEXT = "--color-button-primary-disabled-foreground";

/** Contrast of `fg` painted on `bg`, with `bg` itself composited onto the page. */
const ratio = (fg: string, bg: string, scope: Map<string, string>): number => {
  const page = resolveColor("--color-surface-base", scope);
  const fill = resolveColor(bg, scope);
  const text = resolveColor(fg, scope);
  if (!page || !fill || !text) throw new Error(`unresolved: ${fg} on ${bg}`);
  const paint = composite(fill, page);
  return contrastRatio(composite(text, paint), paint);
};

/** The shipped sheets plus the palette a brand theme writes onto the document. */
const brandScope = (themeColor: string, mode: "light" | "dark"): Map<string, string> => {
  applyThemeColors(themeColor, mode, false);
  const scope = new Map(THEMES[mode]);
  const style = document.documentElement.style;
  for (const shade of PRIMARY_SHADES) {
    const value = style.getPropertyValue(`--color-primary-${shade}`).trim();
    if (value) scope.set(`--color-primary-${shade}`, value);
  }
  return scope;
};

describe("time picker disabled item token", () => {
  // The chips sit on surface-base; calendar days and list rows on the overlay panel.
  it.each(MODES)("clears 4.5:1 on the picker's surfaces in %s", (mode) => {
    for (const surface of ["--color-surface-base", "--color-surface-overlay"]) {
      expect(ratio(ITEM_DISABLED, surface, THEMES[mode])).toBeGreaterThanOrEqual(TEXT_MIN);
    }
  });

  it("leaves the shared toggle and datepicker disabled tokens on their build values", () => {
    for (const mode of MODES) {
      expect(THEMES[mode].get("--color-toggle-item-disabled")).not.toContain(ITEM_DISABLED);
      expect(THEMES[mode].get("--color-datepicker-day-disabled-text")).not.toContain(ITEM_DISABLED);
    }
  });

  it("re-points both shared tokens and drops the dim only inside time-picker-scope", () => {
    const block = /@utility time-picker-scope \{([\s\S]*?)\n\}/.exec(UTILITIES)?.[1] ?? "";
    expect(block).toContain(`--color-toggle-item-disabled: var(${ITEM_DISABLED})`);
    expect(block).toContain(`--color-datepicker-day-disabled-text: var(${ITEM_DISABLED})`);
    expect(block).toMatch(/\[data-disabled\][^{]*\{\s*opacity: 1;/);
  });
});

describe("disabled primary button foreground", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
    document.documentElement.classList.remove("dark");
  });

  it.each(MODES)("clears 4.5:1 on the disabled fill with the shipped palette in %s", (mode) => {
    expect(ratio(BUTTON_TEXT, BUTTON_FILL, THEMES[mode])).toBeGreaterThanOrEqual(TEXT_MIN);
  });

  const cases = PREDEFINED_THEMES.flatMap((theme) =>
    MODES.map((mode) => ({ name: theme.name, mode, themeColor: theme[mode].themeColor })),
  );

  it.each(cases)("clears 4.5:1 under $name in $mode", ({ themeColor, mode }) => {
    expect(ratio(BUTTON_TEXT, BUTTON_FILL, brandScope(themeColor, mode))).toBeGreaterThanOrEqual(
      TEXT_MIN,
    );
  });
});
