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

import { describe, expect, it } from "vitest";

import { resolveColor, resolveTokens, type Rgba } from "@/lib/styles/tokens/colorMath";

const here = dirname(fileURLToPath(import.meta.url));
const TOKENS = join(here, "../../styles/tokens");
const THEMES = resolveTokens(
  ["base.css", "semantic.css", "component.css", "dark.css"].map((file) =>
    readFileSync(join(TOKENS, file), "utf8"),
  ),
);
const RAIL_FILES = [
  join(here, "../../../components/MenuLink.vue"),
  join(here, "ONavGroup.vue"),
  join(here, "ONavbar.vue"),
];

/** Pinned (light, dark) with the stock theme so a token refactor cannot change what the nav rail renders. */
const MAIN: Record<string, [string, string]> = {
  "--color-accent": ["#3f7994", "#79a1b4"],
  "--color-black": ["#000000", "#000000"],
  "--color-border-default": ["#d0d5e1", "#43485a"],
  "--color-dropdown-bg": ["#ffffff", "#1c1f28"],
  "--color-dropdown-item-hover-bg": ["#e5edf1", "#19303b"],
  "--color-dropdown-item-text": ["#222534", "#e3e5eb"],
  "--color-error-500": ["#ef4444", "#ef4444"],
  "--color-menu-badge-ring": ["#141620", "#141620"],
  "--color-nav-label-accent": ["#326176", "#79a1b4"],
  "--color-nav-flyout-item-hover-bg": ["#f5f8fa", "#19303b"],
  "--color-nav-flyout-item-selected-bg": ["#e2ebef", "#264959"],
  "--color-select-item-selected-bg": ["#cfdee5", "#264959"],
  // The rail paints these two only in dark, where they match main; light is the polished tint.
  "--color-surface-accent-active": ["#d7e3e9", "#264959"],
  "--color-surface-accent-hover": ["#e5edf1", "#19303b"],
  "--color-surface-base": ["#ffffff", "#14161e"],
  "--color-surface-chrome-deeper": ["#f1f3f7", "#0f1117"],
  "--color-tabs-active-bg": ["#e2ebef", "#19303b"],
  "--color-tabs-active-text": ["#326176", "#ffffff"],
  "--color-tabs-hover-bg": ["#ecf2f5", "#192630"],
  "--color-tabs-inactive-text": ["#222534", "#e3e5eb"],
  "--color-text-body": ["#3b3f4f", "#d0d5e1"],
  "--color-text-inverse": ["#ffffff", "#141620"],
  "--color-text-secondary": ["#4b5163", "#9ea4b4"],
};

const UTILITY =
  /(?:text|bg|border(?:-[se])?|ring|fill|stroke|shadow|outline|from|to|via|decoration|divide)-([a-z][a-z0-9-]+)/g;

function hex(color: Rgba): string {
  const channels = [color.r, color.g, color.b].map((v) =>
    Math.round(v).toString(16).padStart(2, "0"),
  );
  const alpha =
    color.a < 1
      ? Math.round(color.a * 255)
          .toString(16)
          .padStart(2, "0")
      : "";
  return `#${channels.join("")}${alpha}`;
}

function railColourTokens(): string[] {
  const names = new Set<string>();
  for (const file of RAIL_FILES) {
    for (const match of readFileSync(file, "utf8").matchAll(UTILITY)) {
      const name = `--color-${match[1]}`;
      if (resolveColor(name, THEMES.light) && resolveColor(name, THEMES.dark)) names.add(name);
    }
  }
  return [...names].sort();
}

describe("nav rail renders with its pinned colours", () => {
  const tokens = railColourTokens();

  it("resolves every colour it uses through a pinned token", () => {
    expect(tokens.length).toBeGreaterThan(10);
    expect(tokens.filter((name) => !(name in MAIN))).toEqual([]);
  });

  it.each([
    ["light", 0],
    ["dark", 1],
  ] as const)("keeps the pinned colours in %s", (theme, index) => {
    for (const name of tokens) {
      expect(hex(resolveColor(name, THEMES[theme])!), name).toBe(MAIN[name][index]);
    }
  });

  it("keeps the inactive label and icon in heading ink and the active pill fill", () => {
    expect(MAIN["--color-tabs-inactive-text"]).toEqual(["#222534", "#e3e5eb"]);
    expect(tokens).toEqual(
      expect.arrayContaining([
        "--color-tabs-inactive-text",
        "--color-surface-base",
        "--color-surface-accent-active",
      ]),
    );
  });
});
