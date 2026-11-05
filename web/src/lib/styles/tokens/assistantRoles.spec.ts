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
import { ASSISTANT_ROLE_TOKENS, applyThemeColors } from "@/utils/theme";

import { composite, contrastRatio, resolveColor, resolveTokens } from "./colorMath";

const here = dirname(fileURLToPath(import.meta.url));

const TOKEN_FILES = ["base.css", "semantic.css", "component.css", "dark.css"];

const SHEETS = TOKEN_FILES.map((file) => readFileSync(join(here, file), "utf8"));

const THEMES = resolveTokens(SHEETS);

const TEXT_MIN = 4.5;

const NON_TEXT_MIN = 3;

const PRIMARY_SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];

/** Assistant text sits on these; links must read on every one (`90` §2.1). */
const TEXT_SURFACES = ["--color-surface-base", "--color-surface-panel", "--color-surface-subtle"];

/** The focus ring is drawn over these inside the assistant (PO B100). */
const RING_SURFACES = [
  "--color-surface-base",
  "--color-surface-subtle",
  "--color-surface-overlay",
  "--color-surface-accent-hover",
];

type Mode = "light" | "dark";

/** Every predefined theme in both modes, plus a light amber and a light green brand colour (PO B100). */
const CASES = [
  ...PREDEFINED_THEMES.flatMap((theme) =>
    (["light", "dark"] as const).map((mode) => ({
      name: theme.name,
      mode,
      themeColor: theme[mode].themeColor,
    })),
  ),
  ...(["light", "dark"] as const).flatMap((mode) => [
    { name: "custom amber", mode, themeColor: "#f5b942" },
    { name: "custom green", mode, themeColor: "#7ed957" },
  ]),
];

/** Applies the theme for real and reads every inline token the sync wrote back into the sheet scope. */
function scopeFor(themeColor: string, mode: Mode): Map<string, string> {
  applyThemeColors(themeColor, mode, false);
  const scope = new Map(THEMES[mode]);
  const root = document.documentElement;
  const names = [...PRIMARY_SHADES.map((s) => `--color-primary-${s}`), ...ASSISTANT_ROLE_TOKENS];
  for (const name of names) {
    const value = root.style.getPropertyValue(name).trim();
    if (value) scope.set(name, value);
  }
  return scope;
}

function ratio(scope: Map<string, string>, fg: string, bg: string): number {
  const page = resolveColor("--color-surface-base", scope)!;
  const paint = composite(resolveColor(bg, scope)!, page);
  return contrastRatio(composite(resolveColor(fg, scope)!, paint), paint);
}

function failures(scope: Map<string, string>): string[] {
  const out: string[] = [];
  const check = (fg: string, bg: string, min: number) => {
    const value = ratio(scope, fg, bg);
    if (value < min) out.push(`${fg} on ${bg}: ${value.toFixed(2)}:1 (need ${min})`);
  };
  for (const bg of TEXT_SURFACES) {
    check("--color-assistant-link", bg, TEXT_MIN);
    check("--color-assistant-link-hover", bg, TEXT_MIN);
  }
  check("--color-assistant-primary-foreground", "--color-assistant-primary", TEXT_MIN);
  check("--color-assistant-primary-foreground", "--color-assistant-primary-hover", TEXT_MIN);
  for (const bg of RING_SURFACES) check("--color-assistant-focus-ring", bg, NON_TEXT_MIN);
  return out;
}

/** The `[data-assistant-surface]` block, read as text, since the resolver skips `[data-` selectors. */
function surfaceScope(): Map<string, string> {
  const css = SHEETS[2].replace(/\/\*[\s\S]*?\*\//g, "");
  const body = /\[data-assistant-surface\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  return new Map(
    body
      .split(";")
      .map((line) => line.split(":").map((part) => part.trim()))
      .filter((pair) => pair.length === 2 && pair[0].startsWith("--"))
      .map(([name, value]) => [name, value] as [string, string]),
  );
}

describe("assistant colour roles", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
    document.body.removeAttribute("style");
    document.documentElement.classList.remove("dark");
  });

  it("covers every predefined theme in both modes", () => {
    expect(CASES.length).toBe(2 * PREDEFINED_THEMES.length + 4);
  });

  it.each(CASES)("reads at AA under $name in $mode", ({ themeColor, mode }) => {
    const scope = scopeFor(themeColor, mode);
    for (const token of ASSISTANT_ROLE_TOKENS) expect(scope.get(token)).toMatch(/^#/);
    expect(failures(scope)).toEqual([]);
  });

  it.each(["light", "dark"] as const)("reads at AA from the shipped sheets alone in %s", (mode) => {
    expect(failures(THEMES[mode])).toEqual([]);
  });

  it("drops the inline roles when the default theme takes over", () => {
    applyThemeColors("#3f7994", "light", false);
    expect(document.documentElement.style.getPropertyValue("--color-assistant-link")).not.toBe("");
    applyThemeColors("#3f7994", "light", true);
    for (const token of ASSISTANT_ROLE_TOKENS)
      expect(document.documentElement.style.getPropertyValue(token)).toBe("");
  });

  it("points the library's primary, link and ring tokens at the roles inside the surface", () => {
    expect(Object.fromEntries(surfaceScope())).toMatchObject({
      "--color-button-primary": "var(--color-assistant-primary)",
      "--color-button-primary-hover": "var(--color-assistant-primary-hover)",
      "--color-button-primary-foreground": "var(--color-assistant-primary-foreground)",
      "--color-text-link": "var(--color-assistant-link)",
      "--color-focus-ring-accent": "var(--color-assistant-focus-ring)",
      "--color-button-outline-hover-border": "var(--color-assistant-focus-ring)",
      "--color-kbd-text": "var(--color-text-body)",
    });
  });
});
