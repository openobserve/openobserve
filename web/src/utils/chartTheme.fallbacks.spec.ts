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
 * Drift guard on chartTheme's FALLBACKS map.
 *
 * FALLBACKS hand-duplicates the LIGHT value of every token chart code asks for,
 * because jsdom and SSR have no live CSSOM and `chartColor()` would otherwise
 * hand ECharts an empty colour string. A hand-maintained mirror of a stylesheet
 * decays two ways, and neither is visible in the browser: a new `chartColor()`
 * call site whose token was never mirrored renders as nothing under test, and a
 * value changed in the token CSS leaves the mirror quietly showing last year's
 * colour.
 *
 * This file reads both sides as text — the call sites under `src/`, and the
 * light-theme token declarations in `lib/styles/tokens/` — because that is the
 * only place the two are comparable; at runtime the CSS side does not exist.
 *
 * A failure here means FALLBACKS is wrong, not that the test is too strict: add
 * the missing token, or correct the stale value to the one the CSS resolves to.
 * The single sanctioned omission is `--color-chart-crosshair-bg`, which has no
 * light declaration on purpose (see base.css).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..");
const TOKENS = resolve(SRC, "lib/styles/tokens");

/** Light-theme token sources. dark.css is excluded: FALLBACKS mirrors light only. */
const LIGHT_TOKEN_FILES = ["base.css", "semantic.css", "component.css"];

const SOURCE_EXTENSIONS = new Set([".ts", ".vue", ".js"]);

/** Directories with no chart code, skipped so the walk stays cheap. */
const SKIP_DIRS = new Set(["node_modules", "dist", "__snapshots__", "assets"]);

/**
 * Documented omission: the crosshair chip is dark-only, and the empty string
 * `chartColor()` returns in light is exactly what makes ECharts pick its own
 * default. Giving it a fallback would change the light-theme rendering.
 */
const UNMIRRORED_BY_DESIGN = new Set(["--color-chart-crosshair-bg"]);

/**
 * Floor on the number of distinct tokens the call-site scan must find.
 *
 * The scan is a regex over source text, so a refactor that renames the helper or
 * wraps the literals would make every case below pass over an empty set. The
 * real count is well above this; the floor only has to be high enough that a
 * broken regex cannot sneak past it.
 */
const MIN_CALL_SITE_TOKENS = 40;

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...walk(path));
    } else if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
      out.push(path);
    }
  }
  return out;
};

/** Tokens requested as a literal, e.g. `chartColor("--color-text-body")`. */
const collectCallSiteTokens = (): Set<string> => {
  const found = new Set<string>();
  for (const file of walk(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const [, token] of text.matchAll(/chartColor\(\s*["'](--[a-zA-Z0-9-]+)["']/g)) {
      found.add(token);
    }
  }
  return found;
};

/**
 * Split CSS into (selector, body) pairs, dropping any block whose selector names
 * a dark scope — those carry the dark override of a token declared in light.
 */
const lightBlocks = (css: string): string[] => {
  const bodies: string[] = [];
  let cursor = 0;
  while (cursor < css.length) {
    const open = css.indexOf("{", cursor);
    if (open === -1) break;
    const selector = css.slice(cursor, open);
    let depth = 0;
    let close = open;
    for (; close < css.length; close++) {
      if (css[close] === "{") depth++;
      else if (css[close] === "}" && --depth === 0) break;
    }
    if (!/dark/i.test(selector)) bodies.push(css.slice(open + 1, close));
    cursor = close + 1;
  }
  return bodies;
};

/**
 * Every light-theme custom-property declaration, last one winning as in the
 * cascade. `--x: var(--x)` is skipped: those are Tailwind `@theme inline`
 * re-registrations, which would otherwise resolve to themselves forever.
 */
const readDeclarations = (): Map<string, string> => {
  const declarations = new Map<string, string>();
  for (const file of LIGHT_TOKEN_FILES) {
    const css = readFileSync(resolve(TOKENS, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const body of lightBlocks(css)) {
      for (const [, name, value] of body.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;{}]+);/g)) {
        const trimmed = value.trim();
        if (trimmed !== `var(${name})`) declarations.set(name, trimmed);
      }
    }
  }
  return declarations;
};

const DECLARATIONS = readDeclarations();

/** Follow a `var()` chain to the literal colour, or null when nothing declares it. */
const resolveToken = (name: string, seen = new Set<string>()): string | null => {
  if (seen.has(name)) return null;
  seen.add(name);
  const value = DECLARATIONS.get(name);
  if (value === undefined) return null;
  const reference = /^var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,([^)]*))?\)$/.exec(value);
  if (!reference) return value;
  return resolveToken(reference[1], seen) ?? (reference[2]?.trim() || null);
};

/** Hex case and `rgba()` spacing are not differences a chart can see. */
const normalise = (color: string): string => color.trim().toLowerCase().replace(/\s+/g, " ");

/** FALLBACKS is module-private, so it is read as text rather than imported. */
const readFallbacks = (): Map<string, string> => {
  const source = readFileSync(resolve(HERE, "chartTheme.ts"), "utf8");
  const block = /const FALLBACKS: Record<string, string> = \{([\s\S]*?)\n\};/.exec(source);
  if (!block) return new Map();
  const entries = new Map<string, string>();
  for (const [, token, value] of block[1].matchAll(/"(--[a-zA-Z0-9-]+)":\s*"([^"]*)"/g)) {
    entries.set(token, value);
  }
  return entries;
};

const CALL_SITE_TOKENS = collectCallSiteTokens();
const FALLBACKS = readFallbacks();

describe("chartTheme FALLBACKS", () => {
  // Guards the two regexes above: if either stopped matching, every case below
  // would pass vacuously over an empty set.
  it("finds chartColor call sites and a fallback map to check them against", () => {
    expect(CALL_SITE_TOKENS.size).toBeGreaterThanOrEqual(MIN_CALL_SITE_TOKENS);
    expect(FALLBACKS.size).toBeGreaterThanOrEqual(MIN_CALL_SITE_TOKENS);
    expect(DECLARATIONS.size).toBeGreaterThan(0);
  });

  // Without an entry, chartColor() returns "" under jsdom and SSR, and the chart
  // draws with no colour at all rather than with the wrong one.
  it("mirrors every token any chartColor call site asks for", () => {
    const offenders = [...CALL_SITE_TOKENS]
      .filter((token) => !UNMIRRORED_BY_DESIGN.has(token) && !FALLBACKS.has(token))
      .sort();
    expect(offenders).toEqual([]);
  });

  it("leaves the deliberately unmirrored tokens out of the map", () => {
    const offenders = [...UNMIRRORED_BY_DESIGN].filter((token) => FALLBACKS.has(token));
    expect(offenders).toEqual([]);
  });

  // A stale value is the worse failure of the two: it renders confidently wrong.
  it("holds the light value the token CSS resolves to, for every entry", () => {
    const offenders = [...FALLBACKS.entries()]
      .map(([token, fallback]) => {
        const declared = resolveToken(token);
        if (declared === null) return `${token}: no light declaration in token CSS`;
        if (normalise(declared) !== normalise(fallback)) {
          return `${token}: FALLBACKS ${fallback} vs CSS ${declared}`;
        }
        return null;
      })
      .filter((offender): offender is string => offender !== null);
    expect(offenders).toEqual([]);
  });
});
