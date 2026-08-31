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
 * WCAG AA contrast guard on the design tokens, in both themes.
 *
 * Contrast is a property of a PAIR, never of a colour: a foreground and the
 * background it is actually painted on. Every foreground token is therefore
 * judged against `--color-surface-base` — the page — and `contrast-manifest.ts`
 * carries the exceptions, the pairs whose real backdrop is something else.
 *
 * A failure here means a real user cannot read something, or cannot see the
 * boundary of a control. The fix is to change the colour, in the token sheet,
 * until it clears the threshold. It is NOT to widen the threshold, and it is
 * NOT to add an exemption — an exemption is a claim that WCAG does not apply
 * to that pair, and `justifies every exemption` makes you name the clause.
 *
 * The two ratchets on the manifest only go down. `pending` records the colours
 * this repo already ships and has not fixed yet; adding one is taking on debt,
 * and the count is pinned so it can only be paid off.
 *
 * WHAT THIS DOES NOT COVER, so the green tick is not read as more than it is:
 * only tokens whose name carries a foreground segment (FOREGROUND_SEGMENTS) are
 * candidates. That is ~456 of the ~999 tokens; the other ~543 are neither asserted
 * nor recorded as debt — they are unexamined. Of the candidates, those whose root
 * is `pending` or `exempt` are skipped, so the suite asserts a threshold on roughly
 * a third of the token set. MIN_MATCHED pins that coverage so it cannot silently
 * shrink; widening it is how coverage grows.
 *
 * See lib/styles/tokens/colorMath.ts for the resolver these cases run on.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { composite, contrastRatio, resolveColor, resolveTokens, type Rgba } from "./colorMath";
import { CONTRAST_PAIRS, type Category, type ContrastPair } from "./contrast-manifest";

const here = dirname(fileURLToPath(import.meta.url));

/** The sheets that make up a theme, in cascade order. */
const TOKEN_FILES = ["base.css", "semantic.css", "component.css", "dark.css"];

/** The page. Every pair resolves onto this unless the manifest says otherwise. */
const SURFACE_BASE = "--color-surface-base";

const TEXT_MIN = 4.5;
const LARGE_TEXT_MIN = 3;
const NON_TEXT_MIN = 3;

/** Ratchets. Both only ever go down; see the module docstring. */
const MAX_PENDING = 98;
const MAX_EXEMPT = 37;

/** Inverted ratchet on the completeness gate: a rename must fail, not shrink it. */
const MIN_MATCHED = 456;

/** An exemption must name the clause that makes WCAG not apply to the pair. */
const EXEMPTION_CLAUSE = /1\.4\.3|1\.4\.11|disabled|decorative|inactive/;

/**
 * Name segments that mark a token as something drawn ON a background.
 *
 * Segments, not suffixes: a suffix list was measured to match 289 of the 1001
 * tokens and to miss every focus-ring primitive, because the informative part
 * of a token name is rarely last (`--color-input-border-hover`).
 */
const FOREGROUND_SEGMENTS = [
  "text",
  "label",
  "caption",
  "title",
  "placeholder",
  "hint",
  "fg",
  "foreground",
  "link",
  "code",
  "value",
  "border",
  "divider",
  "separator",
  "rule",
  "icon",
  "glyph",
  "chevron",
  "dot",
  "indicator",
  "ring",
  "focus-ring",
  "outline",
  "stroke",
  "syntax",
  "json",
  "promql",
  // `--color-severity-*-color` carries chart/label text but ends in `-color`, which no
  // other segment reaches. Matching on `-color` itself is impossible: every token in the
  // system is prefixed `--color-`.
  "severity",
];

/** Of the matched tokens, the ones that are paint rather than a foreground. */
const BACKGROUND_SEGMENTS = [
  "bg",
  "background",
  "fill",
  "plate",
  "shadow",
  "glow",
  "track",
  "surface",
  "overlay",
  "scrim",
  "gradient",
  "canvas",
  "backdrop",
];

/** Foregrounds that are shapes rather than glyphs: judged at 3:1, not 4.5:1. */
const NON_TEXT_SEGMENTS = [
  "border",
  "divider",
  "separator",
  "rule",
  "ring",
  "outline",
  "stroke",
  "dot",
  "indicator",
  "icon",
  "glyph",
  "chevron",
];

/** Where the advisory report re-measures a failing foreground. */
const REAL_SURFACES = [
  "--color-surface-base",
  "--color-surface-panel",
  "--color-surface-subtle",
  "--color-surface-chrome",
  "--color-surface-chrome-deeper",
  "--color-surface-overlay",
  "--color-surface-chip",
];

const MINIMUMS: Record<Exclude<Category, "exempt" | "pending">, number> = {
  text: TEXT_MIN,
  "large-text": LARGE_TEXT_MIN,
  "non-text": NON_TEXT_MIN,
};

const SHEETS = TOKEN_FILES.map((file) => readFileSync(join(here, file), "utf8"));
const THEMES = resolveTokens(SHEETS);

const segmentsOf = (name: string): string[] => name.replace(/^--color-/, "").split("-");

/** True when `name` contains `phrase` as a run of whole segments. */
const hasSegment = (name: string, phrase: string): boolean => {
  const segments = segmentsOf(name);
  const words = phrase.split("-");
  return segments.some((_, at) => words.every((word, offset) => segments[at + offset] === word));
};

const hasAny = (name: string, phrases: string[]): boolean =>
  phrases.some((phrase) => hasSegment(name, phrase));

const allTokens = (scope: Map<string, string>): string[] =>
  [...scope.keys()].filter((name) => name.startsWith("--color-"));

/** Union of both themes: one token is declared only under `.dark`. */
const TOKENS = [...new Set([...allTokens(THEMES.light), ...allTokens(THEMES.dark)])].sort();

const MATCHED = TOKENS.filter((name) => hasAny(name, FOREGROUND_SEGMENTS));
const SKIPPED = MATCHED.filter((name) => hasAny(name, BACKGROUND_SEGMENTS));
const CANDIDATES = MATCHED.filter((name) => !hasAny(name, BACKGROUND_SEGMENTS));
const CANDIDATE_SET = new Set(CANDIDATES);

/** `--color-dialog-border: var(--color-border-default)` and nothing else. */
const aliasTarget = (name: string, scope: Map<string, string>): string | null => {
  const match = /^var\(\s*(--[a-zA-Z0-9-]+)\s*\)$/.exec((scope.get(name) ?? "").trim());
  return match && CANDIDATE_SET.has(match[1]) ? match[1] : null;
};

/**
 * Follow a chain of bare aliases to the token that actually names the colour.
 *
 * Fifty component tokens point at `--color-border-default`; judging each one
 * separately restates a single design decision fifty times and buries the one
 * token a fix would have to touch.
 */
const rootOf = (name: string, scope: Map<string, string>): string => {
  const seen = new Set<string>([name]);
  let current = name;
  for (;;) {
    const next = aliasTarget(current, scope);
    if (!next || seen.has(next)) return current;
    seen.add(next);
    current = next;
  }
};

const rootsIn = (scope: Map<string, string>): string[] =>
  CANDIDATES.filter((name) => rootOf(name, scope) === name);

/** A theme-scoped entry wins, so one theme can be pending while the other holds. */
const entryFor = (fg: string, theme: "light" | "dark"): ContrastPair | undefined =>
  CONTRAST_PAIRS.find((pair) => pair.fg === fg && (pair.themes ?? []).includes(theme)) ??
  CONTRAST_PAIRS.find((pair) => pair.fg === fg && pair.themes === undefined);

/** Composite the backdrop chain down onto the page, then the pair's own bg. */
const paintOf = (pair: ContrastPair, scope: Map<string, string>): Rgba | null => {
  const stack = [pair.bg ?? SURFACE_BASE, ...(pair.under ?? []), SURFACE_BASE];
  let painted: Rgba | null = null;
  for (const name of [...stack].reverse()) {
    const layer = resolveColor(name, scope);
    if (!layer) return null;
    painted = painted === null ? layer : composite(layer, painted);
  }
  return painted;
};

const ratioOf = (pair: ContrastPair, scope: Map<string, string>): number | null => {
  const fg = resolveColor(pair.fg, scope);
  const bg = paintOf(pair, scope);
  if (!fg || !bg) return null;
  return contrastRatio(composite(fg, bg), bg);
};

/** The pair actually judged for a token: the manifest's, or the default rule. */
const pairFor = (fg: string, theme: "light" | "dark"): ContrastPair =>
  entryFor(fg, theme) ?? {
    fg,
    category: hasAny(fg, NON_TEXT_SEGMENTS) ? "non-text" : "text",
    why: "default rule: a foreground on the page surface",
  };

const describePair = (pair: ContrastPair, ratio: number, need: number): string =>
  `${pair.fg} on ${pair.bg ?? SURFACE_BASE}: ${ratio.toFixed(2)}:1 (need ${need})`;

const advisory = (): string[] => {
  const lines: string[] = [];
  for (const theme of ["light", "dark"] as const) {
    const scope = THEMES[theme];
    for (const pair of CONTRAST_PAIRS) {
      if (pair.category !== "pending") continue;
      if (!(pair.themes ?? ["light", "dark"]).includes(theme)) continue;
      const fg = resolveColor(pair.fg, scope);
      if (!fg) continue;
      const measured = REAL_SURFACES.map((surface) => {
        const bg = resolveColor(surface, scope);
        if (!bg) return `${surface}=?`;
        return `${surface.replace("--color-surface-", "")}=${contrastRatio(composite(fg, bg), bg).toFixed(2)}`;
      });
      lines.push(`${theme} ${pair.fg}: ${measured.join(" ")}`);
    }
  }
  return lines;
};

describe("design token contrast", () => {
  // Guards every case below: on an empty or collapsed token set they would all
  // pass over nothing, and the suite would report a green accessibility audit.
  it("resolves every --color-* token in both themes", () => {
    for (const theme of ["light", "dark"] as const) {
      const scope = THEMES[theme];
      const names = allTokens(scope);
      expect(names.length).toBeGreaterThan(900);
      const unresolved = names
        .filter((name) => resolveColor(name, scope) === null)
        .filter((name) => !(scope.get(name) ?? "").startsWith("linear-gradient"));
      expect(unresolved).toEqual([]);
    }
  });

  it("classifies every candidate token", () => {
    // Inverted ratchet: a rename that stops matching the vocabulary silently
    // shrinks the audit, so the gate fails loudly instead of passing quietly.
    expect(MATCHED.length).toBeGreaterThanOrEqual(MIN_MATCHED);
    expect(SKIPPED.length + CANDIDATES.length).toBe(MATCHED.length);

    const unknown = CONTRAST_PAIRS.map((pair) => pair.fg).filter((fg) => !CANDIDATE_SET.has(fg));
    expect(unknown).toEqual([]);

    const missingBackdrop = CONTRAST_PAIRS.flatMap((pair) =>
      [pair.bg, ...(pair.under ?? [])].filter(
        (name): name is string => name !== undefined && !THEMES.dark.has(name),
      ),
    );
    expect(missingBackdrop).toEqual([]);

    const untranslucent = CONTRAST_PAIRS.filter((pair) => pair.bg !== undefined)
      .filter((pair) => (pair.under ?? []).length === 0)
      .filter((pair) => (resolveColor(pair.bg as string, THEMES.dark)?.a ?? 1) < 1)
      .map((pair) => pair.fg);
    expect(untranslucent).toEqual([]);

    const unjustified = CONTRAST_PAIRS.filter((pair) => pair.category === "pending")
      .filter((pair) => pair.issue === undefined)
      .map((pair) => pair.fg);
    expect(unjustified).toEqual([]);
  });

  describe.each(["light", "dark"] as const)("%s theme", (theme) => {
    const scope = THEMES[theme];
    const pairs = rootsIn(scope).map((fg) => pairFor(fg, theme));

    it("clears 4.5:1 on every text pair", () => {
      const offenders = pairs
        .filter((pair) => pair.category === "text")
        .map((pair) => [pair, ratioOf(pair, scope)] as const)
        .filter(([, ratio]) => ratio === null || ratio < TEXT_MIN)
        .map(([pair, ratio]) => describePair(pair, ratio ?? 0, TEXT_MIN));
      expect(offenders).toEqual([]);
    });

    it("clears 3:1 on every non-text pair", () => {
      const offenders = pairs
        .filter((pair) => pair.category === "non-text" || pair.category === "large-text")
        .map(
          (pair) =>
            [
              pair,
              ratioOf(pair, scope),
              MINIMUMS[pair.category as "non-text" | "large-text"],
            ] as const,
        )
        .filter(([, ratio, need]) => ratio === null || ratio < need)
        .map(([pair, ratio, need]) => describePair(pair, ratio ?? 0, need));
      expect(offenders).toEqual([]);
    });
  });

  it("justifies every exemption", () => {
    const offenders = CONTRAST_PAIRS.filter((pair) => pair.category === "exempt")
      .filter((pair) => !EXEMPTION_CLAUSE.test(pair.why))
      .map((pair) => `${pair.fg}: ${pair.why}`);
    expect(offenders).toEqual([]);
  });

  it("holds no more than the recorded number of pending pairs", () => {
    const report = ["contrast advisory — pending pairs on the real surfaces:", ...advisory()];
    console.info(report.join("\n"));
    // vitest.config.ts returns false from onConsoleLog, so the line above is
    // swallowed on every run; CONTRAST_ADVISORY=1 is the way to actually read it.
    if (process.env.CONTRAST_ADVISORY) process.stdout.write(`${report.join("\n")}\n`);
    expect(CONTRAST_PAIRS.filter((pair) => pair.category === "pending").length).toBeLessThanOrEqual(
      MAX_PENDING,
    );
  });

  it("holds no more than the recorded number of exempt pairs", () => {
    expect(CONTRAST_PAIRS.filter((pair) => pair.category === "exempt").length).toBeLessThanOrEqual(
      MAX_EXEMPT,
    );
  });
});
