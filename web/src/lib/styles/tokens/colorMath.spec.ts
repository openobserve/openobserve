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

/**
 * Correctness guard on the token resolver.
 *
 * Every contrast check, palette check and theme audit we can write depends on
 * this module returning the same colour a browser would. Nothing else in the
 * repo can tell us it does: the token sheets resolve through `color-mix()` over
 * `var()` over `oklch()`, and a wrong answer anywhere in that chain is silent —
 * it produces a plausible colour, not an error, and every guard built on top of
 * it then passes for the wrong reason.
 *
 * So the unit cases below pin each parser form against values that can be
 * checked by hand, and the integration case runs the real four sheets and
 * asserts near-total coverage. A drop in the resolved count means the resolver
 * lost a form the sheets actually use — the fix is to teach it that form, never
 * to lower the number. A rise means the sheets gained tokens, and the number is
 * simply restated.
 *
 * See lib/styles/tokens/colorMath.ts for the resolver itself.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  composite,
  contrastRatio,
  parseColor,
  relativeLuminance,
  resolveColor,
  resolveTokens,
  type Rgba,
} from "./colorMath";

const here = dirname(fileURLToPath(import.meta.url));

/** The sheets that make up a theme, in cascade order. */
const TOKEN_FILES = ["base.css", "semantic.css", "component.css", "dark.css"];

const WHITE = { r: 255, g: 255, b: 255, a: 1 };
const BLACK = { r: 0, g: 0, b: 0, a: 1 };

/** Rounded to 8-bit so a case reads as the colour a designer would name. */
const hex = (color: Rgba | null): string | null => {
  if (!color) return null;
  const channel = (value: number) => Math.round(value).toString(16).padStart(2, "0");
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
};

const scopeOf = (entries: Record<string, string>): Map<string, string> =>
  new Map(Object.entries(entries));

const SHEETS = TOKEN_FILES.map((file) => readFileSync(join(here, file), "utf8"));
const THEMES = resolveTokens(SHEETS);

const colorTokens = (scope: Map<string, string>): string[] =>
  [...scope.keys()].filter((name) => name.startsWith("--color-"));

describe("parseColor", () => {
  it("reads every hex length, expanding the short forms", () => {
    expect(parseColor("#f00")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor("#1a2b3c")).toEqual({ r: 26, g: 43, b: 60, a: 1 });
    expect(parseColor("#0f08")).toEqual({ r: 0, g: 255, b: 0, a: 136 / 255 });
    expect(parseColor("#1a2b3c80")).toEqual({ r: 26, g: 43, b: 60, a: 128 / 255 });
  });

  it("rejects a hex of a length CSS does not define", () => {
    const offenders = ["#", "#12", "#12345", "#1234567", "#gggggg"].filter(
      (value) => parseColor(value) !== null,
    );
    expect(offenders).toEqual([]);
  });

  // The sheets use both spellings, sometimes in adjacent declarations, so a
  // resolver that knows only the comma form loses tokens without any error.
  it("reads the legacy comma form and the modern slash form alike", () => {
    expect(parseColor("rgb(255, 0, 0)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor("rgba(255, 255, 255, 0.8)")).toEqual({ r: 255, g: 255, b: 255, a: 0.8 });
    expect(parseColor("rgb(0 0 0 / 0.3)")).toEqual({ r: 0, g: 0, b: 0, a: 0.3 });
    expect(parseColor("rgb(0 0 0 / 30%)")).toEqual({ r: 0, g: 0, b: 0, a: 0.3 });
  });

  it("treats a three-argument rgba() as opaque, as browsers do", () => {
    expect(parseColor("rgba(255, 255, 255)")).toEqual(WHITE);
  });

  it("converts oklch() to the sRGB colour the palette was published as", () => {
    expect(hex(parseColor("oklch(94.6% 0.033 307.174)"))).toBe("#f3e8ff");
    expect(hex(parseColor("oklch(55.8% 0.288 302.321)"))).toBe("#9810fa");
    expect(hex(parseColor("oklch(95% 0.052 163.051)"))).toBe("#d0fae5");
    expect(hex(parseColor("oklch(59.6% 0.145 163.225)"))).toBe("#009966");
    expect(hex(parseColor("oklch(93.2% 0.032 255.585)"))).toBe("#dbeafe");
    expect(hex(parseColor("oklch(54.6% 0.245 262.881)"))).toBe("#155dfc");
  });

  // Reducing chroma alone would answer #ec5600 here — a brown. The published
  // palette is orange, so the mapping has to be the clip-within-a-JND one.
  it("gamut-maps an out-of-sRGB oklch() without dragging the hue off", () => {
    expect(hex(parseColor("oklch(64.6% 0.222 41.116)"))).toBe("#f54900");
  });

  it("carries an alpha through oklch()", () => {
    expect(parseColor("oklch(0% 0 0 / 0.5)")).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
  });

  it("knows the bare keywords the sheets mix into", () => {
    expect(parseColor("white")).toEqual(WHITE);
    expect(parseColor("black")).toEqual(BLACK);
    expect(parseColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  // These are legitimate token values, not malformed ones. Returning null is
  // how a caller learns "this token is not a single colour" and skips it.
  it("returns null for values that are not one colour", () => {
    const offenders = [
      "linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)",
      "inherit",
      "currentColor",
      "var(--color-anything)",
      "0 1px 2px #000000",
      "",
    ].filter((value) => parseColor(value) !== null);
    expect(offenders).toEqual([]);
  });
});

describe("color-mix", () => {
  // Weighting has to be premultiplied: mixing into `transparent` must fade the
  // colour out, not drag it halfway to transparent's black.
  it("fades a colour out when mixing into transparent", () => {
    expect(parseColor("color-mix(in srgb, #ff0000 50%, transparent)")).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 0.5,
    });
  });

  it("interpolates two opaque colours by the stated percentage", () => {
    expect(parseColor("color-mix(in srgb, #000000 50%, #ffffff)")).toEqual({
      r: 127.5,
      g: 127.5,
      b: 127.5,
      a: 1,
    });
    expect(hex(parseColor("color-mix(in srgb, #ff0000 25%, #ffffff)"))).toBe("#ffbfbf");
  });

  it("defaults the missing percentage to the remainder", () => {
    expect(parseColor("color-mix(in srgb, #000000, #ffffff)")).toEqual(
      parseColor("color-mix(in srgb, #000000 50%, #ffffff 50%)"),
    );
  });

  // The two-percentage form appears once in the sheets. Percentages under 100
  // renormalise the mix AND scale the result's alpha by their sum.
  it("renormalises a two-percentage mix and scales its alpha by the sum", () => {
    expect(parseColor("color-mix(in srgb, #ff0000 20%, white 10%)")).toEqual({
      r: 255,
      g: 85,
      b: 85,
      a: 0.3,
    });
  });

  it("returns null for an interpolation space it cannot do", () => {
    expect(parseColor("color-mix(in oklab, #000000 50%, #ffffff)")).toBeNull();
  });
});

describe("resolveColor", () => {
  it("follows a var() chain to the colour at the end of it", () => {
    const scope = scopeOf({
      "--a": "var(--b)",
      "--b": "var(--c)",
      "--c": "#123456",
    });
    expect(resolveColor("--a", scope)).toEqual({ r: 18, g: 52, b: 86, a: 1 });
  });

  it("takes a var() fallback when the name is undeclared", () => {
    const scope = scopeOf({ "--a": "var(--missing, #ff0000)" });
    expect(resolveColor("--a", scope)).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it("falls through a chain of fallbacks to the first colour that exists", () => {
    const scope = scopeOf({ "--a": "var(--x, var(--y, white))" });
    expect(resolveColor("--a", scope)).toEqual(WHITE);
  });

  // A cycle in the sheets is a mistake, but it must surface as an unresolved
  // token in whatever guard is running, not as a hung test run.
  it("returns null on a var() cycle instead of recursing forever", () => {
    const scope = scopeOf({ "--a": "var(--b)", "--b": "var(--a)" });
    expect(resolveColor("--a", scope)).toBeNull();
    expect(resolveColor("--b", scope)).toBeNull();
  });

  // A shared "already visited" set would make the second branch below look like
  // a cycle, because both branches legitimately reach --base.
  it("resolves a diamond where two branches share one ancestor", () => {
    const scope = scopeOf({
      "--base": "#ffffff",
      "--left": "var(--base)",
      "--right": "var(--base)",
      "--top": "color-mix(in srgb, var(--left) 50%, var(--right))",
    });
    expect(resolveColor("--top", scope)).toEqual(WHITE);
  });

  it("resolves a var() nested inside a color-mix", () => {
    const scope = scopeOf({
      "--ink": "#ff0000",
      "--tint": "color-mix(in srgb, var(--ink) 50%, transparent)",
    });
    expect(resolveColor("--tint", scope)).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
  });

  it("returns null for a token that was never declared", () => {
    expect(resolveColor("--nothing", scopeOf({}))).toBeNull();
  });
});

describe("compositing and contrast", () => {
  it("composites a translucent colour over an opaque one", () => {
    const result = composite({ r: 255, g: 0, b: 0, a: 0.5 }, WHITE);
    expect(result).toEqual({ r: 255, g: 127.5, b: 127.5, a: 1 });
  });

  it("keeps the backdrop when the foreground is fully transparent", () => {
    expect(composite({ r: 0, g: 0, b: 0, a: 0 }, WHITE)).toEqual(WHITE);
  });

  it("keeps the foreground when it is fully opaque", () => {
    expect(composite(BLACK, WHITE)).toEqual(BLACK);
  });

  it("composites two translucent layers into a partly transparent result", () => {
    const result = composite({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 0.5 });
    expect(result.a).toBeCloseTo(0.75, 10);
    expect(result.r).toBeCloseTo(255 / 3, 10);
  });

  it("puts relative luminance at the ends of the WCAG scale for black and white", () => {
    expect(relativeLuminance(BLACK)).toBe(0);
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 10);
  });

  it("gives black on white the maximum contrast ratio of exactly 21", () => {
    expect(contrastRatio(BLACK, WHITE)).toBe(21);
  });

  it("refuses a translucent colour instead of returning a plausible wrong ratio", () => {
    const clear = { r: 0, g: 0, b: 0, a: 0.5 };
    const solid = { r: 255, g: 255, b: 255, a: 1 };
    expect(() => contrastRatio(clear, solid)).toThrow(/opaque/);
    expect(() => contrastRatio(solid, clear)).toThrow(/opaque/);
  });

  // #767676 is the canonical worked example: the lightest grey that still
  // clears WCAG AA for body text on white.
  it("matches the published ratio for the AA borderline grey on white", () => {
    expect(contrastRatio(parseColor("#767676")!, WHITE)).toBeCloseTo(4.54, 2);
  });

  it("reads the same ratio in either argument order", () => {
    const ink = parseColor("#767676")!;
    expect(contrastRatio(WHITE, ink)).toBeCloseTo(contrastRatio(ink, WHITE), 12);
  });

  it("gives a colour against itself a ratio of 1", () => {
    expect(contrastRatio(BLACK, BLACK)).toBe(1);
  });
});

describe("resolveTokens", () => {
  it("collects declarations from ordinary blocks into the light theme", () => {
    const { light, dark } = resolveTokens([":root { --color-ink: #111111; }"]);
    expect(light.get("--color-ink")).toBe("#111111");
    expect(dark.get("--color-ink")).toBe("#111111");
  });

  it("overlays .dark declarations onto the light theme, leaving light alone", () => {
    const { light, dark } = resolveTokens([
      ":root { --color-ink: #111111; --color-bg: #ffffff; }",
      ".dark { --color-ink: #eeeeee; }",
    ]);
    expect(light.get("--color-ink")).toBe("#111111");
    expect(dark.get("--color-ink")).toBe("#eeeeee");
    expect(dark.get("--color-bg")).toBe("#ffffff");
  });

  it("leaves a [data-*] variant block out of both themes", () => {
    const { light, dark } = resolveTokens(['[data-variant="primary"] { --color-ink: #111111; }']);
    expect(light.has("--color-ink")).toBe(false);
    expect(dark.has("--color-ink")).toBe(false);
  });

  it("leaves a dark-scoped [data-*] variant block out of the dark theme", () => {
    const { dark } = resolveTokens([
      ".dark { --x: red; }",
      '.dark [data-variant="primary"] { --x: blue; }',
    ]);
    expect(dark.get("--x")).toBe("red");
  });

  // Tailwind's registration pass restates every token as `--x: var(--x)`. Read
  // as a declaration that self-reference shadows the real one and resolution
  // collapses — measured at 123 of 1001 tokens when @theme was included.
  it("skips @theme blocks, whose declarations are self-referential", () => {
    const { light } = resolveTokens([
      ":root { --color-ink: #111111; }",
      "@theme inline { --color-ink: var(--color-ink); }",
    ]);
    expect(light.get("--color-ink")).toBe("#111111");
    expect(resolveColor("--color-ink", light)).toEqual({ r: 17, g: 17, b: 17, a: 1 });
  });

  it("strips comments before reading declarations", () => {
    const { light } = resolveTokens([
      ":root { /* --color-ghost: #000000; */ --color-ink: #111111; /* trailing */ }",
    ]);
    expect(light.has("--color-ghost")).toBe(false);
    expect(light.get("--color-ink")).toBe("#111111");
  });

  // Prettier wraps long values across lines. 58 of the sheets' 122 color-mix
  // declarations are wrapped, and every one of them fails to parse without this.
  it("collapses a value that prettier wrapped across lines", () => {
    const { light } = resolveTokens([
      ":root {\n  --color-ink: color-mix(\n    in srgb,\n    #ff0000 50%,\n    transparent\n  );\n}",
    ]);
    expect(resolveColor("--color-ink", light)).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
  });

  it("ignores declarations nested inside a rule within a block", () => {
    const { dark } = resolveTokens([
      ".dark { .thing { --color-ink: #111111; } --color-bg: #000000; }",
    ]);
    expect(dark.has("--color-ink")).toBe(false);
    expect(dark.get("--color-bg")).toBe("#000000");
  });
});

describe("the real token sheets", () => {
  it("finds a token in every sheet, so no case below passes vacuously", () => {
    expect(colorTokens(THEMES.light).length).toBeGreaterThan(900);
    expect(colorTokens(THEMES.dark).length).toBeGreaterThan(900);
    // One token exists only under .dark; everything else is an override.
    expect(colorTokens(THEMES.dark).length).toBeGreaterThan(colorTokens(THEMES.light).length);
  });

  it("resolves an oklch token declared in base.css", () => {
    expect(hex(resolveColor("--color-field-type-float-bg", THEMES.light))).toBe("#f3e8ff");
  });

  it("gives the themes different answers for a token dark.css overrides", () => {
    const light = resolveColor("--color-text-heading", THEMES.light);
    const dark = resolveColor("--color-text-heading", THEMES.dark);
    expect(light).not.toBeNull();
    expect(dark).not.toBeNull();
    expect(relativeLuminance(light!)).toBeLessThan(relativeLuminance(dark!));
  });

  describe.each([
    ["light", 998, 986],
    ["dark", 999, 987],
  ] as const)("%s theme", (theme, total, resolved) => {
    const scope = THEMES[theme];
    const names = colorTokens(scope);

    it(`declares ${total} --color-* tokens`, () => {
      expect(names.length).toBe(total);
    });

    it(`resolves ${resolved} of them to a single sRGB colour`, () => {
      expect(names.filter((name) => resolveColor(name, scope) !== null).length).toBe(resolved);
    });

    // The remainder is the whole point of the number above: if anything other
    // than a gradient stops resolving, the resolver lost a form the sheets use.
    it("leaves nothing unresolved except the gradient tokens", () => {
      const offenders = names
        .filter((name) => resolveColor(name, scope) === null)
        .filter((name) => !(scope.get(name) ?? "").startsWith("linear-gradient"))
        .map((name) => `${name}: ${scope.get(name)}`);
      expect(offenders).toEqual([]);
    });

    it("gives every resolved token a channel inside the sRGB range", () => {
      const offenders = names
        .map((name) => [name, resolveColor(name, scope)] as const)
        .filter(([, color]) => color !== null)
        .filter(
          ([, color]) =>
            [color!.r, color!.g, color!.b].some((c) => c < 0 || c > 255) ||
            color!.a < 0 ||
            color!.a > 1,
        )
        .map(([name]) => name);
      expect(offenders).toEqual([]);
    });
  });
});
