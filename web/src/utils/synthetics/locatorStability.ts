// Copyright 2026 OpenObserve Inc.

import type { LocatorCandidate, LocatorKind } from "@/types/synthetics";

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
 * Most survivable first.
 *
 * A test attribute exists to be selected on, so it changes only deliberately. A
 * role plus accessible name follows the element's meaning rather than its
 * markup. Text survives restyling but not copy edits or translation. CSS and
 * XPath describe structure, which is exactly what a redesign rewrites.
 */
export const LOCATOR_KIND_RANK: Record<LocatorKind, number> = {
  test_attribute: 0,
  role: 1,
  text: 2,
  css: 3,
  xpath: 4,
};

/**
 * Sort a stored bundle the way the recorder would sort it today.
 *
 * Positionality is the PRIMARY key, because Playwright's own scoring says so:
 * `kNthScore` is 10000 against kind scores of 500-530, i.e. upstream treats
 * "needed an index" as an order of magnitude worse than any distinction between
 * kinds. A candidate without an index matched exactly one element when it was
 * recorded; one with an index did not. Better evidence of a worse kind still
 * beats worse evidence of a better one.
 *
 * Stable within a group: ties keep the order the generator produced, so a
 * deterministic recording renders deterministically.
 */
export function rankCandidates(candidates: LocatorCandidate[]): LocatorCandidate[] {
  return candidates
    .map((candidate, index) => ({
      candidate,
      positional: isPositionalSelector(candidate.value),
      index,
    }))
    .sort(
      (a, b) =>
        Number(a.positional) - Number(b.positional) ||
        LOCATOR_KIND_RANK[a.candidate.kind] - LOCATOR_KIND_RANK[b.candidate.kind] ||
        a.index - b.index,
    )
    .map((c) => c.candidate);
}

/**
 * Could the recorder identify this element at all?
 *
 * When every candidate is positional, re-ranking them changes nothing — the
 * step is identified by counting siblings whichever one is chosen. That is the
 * case the author has to resolve by pinning, and the only case that warrants
 * telling them so.
 */
export function isFullyPositional(candidates: LocatorCandidate[]): boolean {
  return candidates.length > 0 && candidates.every((c) => isPositionalSelector(c.value));
}
