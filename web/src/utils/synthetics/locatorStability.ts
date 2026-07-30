// Copyright 2026 OpenObserve Inc.

import type { LocatorCandidate } from "@/types/synthetics";

/**
 * The web mirror of the recorder's locator-stability rules.
 *
 * Deliberately a mirror rather than a shared package: `crx` is a browser
 * extension that cannot take a dependency on this repo, and `probe` is a Lambda
 * that cannot either. The three copies are kept in step by tests that assert the
 * same cases, which is the same arrangement `globToRegExp` already uses for URL
 * pattern matching.
 *
 * Source of truth for the rules: `crx/src/server/recorder/locatorBundle.ts`.
 */

/**
 * Engine tokens that select by position rather than by identity.
 *
 * Playwright appends one only when nothing identified the element uniquely, so
 * their presence records "the recorder could not tell these elements apart" —
 * and their absence proves the selector resolved to exactly one element at
 * record time.
 */
const POSITIONAL_TOKEN = /(?:^|>>)\s*nth=|:nth-match\(|:nth-child\(/;

/** Does this locator depend on how many siblings happen to be on the page? */
export function isPositionalSelector(selector: string): boolean {
  return POSITIONAL_TOKEN.test(selector);
}

/**
 * Ids and classes a component library mints per render.
 *
 * Ported from `crx`. Upstream emits `#id` ahead of tag-name CSS and filters only
 * GUID-like values through `isGuidLike`, so a per-render id is neither caught
 * nor stable: `#reka-popover-trigger-v-21` appeared in a real recording and
 * changes on the next mount.
 *
 * Each pattern is anchored on the library's own prefix and requires the volatile
 * part, so an author-written `#main-content` or `.css-grid-wrapper` is
 * untouched. It used to demote a candidate inside the recorder's sort, which
 * nobody could see; it drives a per-row warning here instead, because the author
 * is the only one who can act on it.
 */
const FRAMEWORK_ID_PATTERNS: RegExp[] = [
  // Reka UI / Radix: #reka-popover-trigger-v-21, #radix-:r3:
  /[#[]?"?(?:reka|radix)-[\w-]*v?-?\d+/i,
  // React useId: :r0:, :r1a:. A CSS selector escapes both colons, so the closing
  // one arrives as `\:` — matching only the bare form missed every real case.
  /:r[0-9a-z]+\\?:/,
  // Angular view encapsulation: _ngcontent-abc-c12, _nghost-…
  /_ng(?:content|host)-/,
  // Emotion / styled-components hashed class: .css-1q2w3e4 (hash, not a word)
  /\.css-(?=[a-z0-9]*\d)[a-z0-9]{5,}\b/i,
  // Vue scoped styles: [data-v-7ba5bd90]
  /\[data-v-[0-9a-f]{6,}\]/i,
  // Vue useId(): #v-0, #v-1-2. Upstream's isGuidLike happens to catch these
  // while the counter stays under three digits and stops at #v-100, so a
  // long-lived page's ids slipped through exactly when they mattered most.
  /#v-\d+(?:-\d+)*$/,
];

/** Does this locator depend on an id the framework regenerates each render? */
export function isFrameworkGeneratedId(selector: string): boolean {
  return FRAMEWORK_ID_PATTERNS.some((re) => re.test(selector));
}

/**
 * Could the recorder identify this element at all?
 *
 * When every candidate is positional, reordering them changes nothing — the
 * step is identified by counting siblings whichever one is chosen. That is the
 * case the author resolves by combining two of them, or by writing their own.
 */
export function isFullyPositional(candidates: LocatorCandidate[]): boolean {
  return candidates.length > 0 && candidates.every((c) => isPositionalSelector(c.value));
}
