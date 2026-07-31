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

import type { AssertionKind } from "@/types/synthetics";
import { SELECTOR_ACTIONS, isPageLevelAssertion } from "@/constants/synthetics";

/**
 * "Does this step say which element to act on?" — the one rule, in one place.
 *
 * A version-1 step answers with `selector`; a version-2 step answers with a
 * `locator` bundle and carries no `selector` at all (buildV2Steps writes none,
 * so a saved v2 check comes back without one). Validating on `selector` alone
 * therefore rejected every v2 journey the moment it was reopened for editing —
 * the same class of bug as spec P2.5.6, where results rendering read `selector`
 * and had to learn to resolve locators too.
 *
 * Structural parameter types rather than `BrowserStep`: the save-time zod schema
 * validates a parsed plain object, not the editor model, and both must decide
 * this question identically.
 */
export interface TargetableStep {
  action: string;
  selector?: string | null;
  locator?: {
    candidates?: readonly { kind: string; value: string }[] | null;
    user_override?: { kind: string; value: string } | null;
  } | null;
  assertion?: { kind?: string } | null;
}

/** Whether this action acts on an element and so must name one. */
export function stepNeedsTarget(step: TargetableStep): boolean {
  if (!(SELECTOR_ACTIONS as readonly string[]).includes(step.action)) return false;
  // `url_matches` / `page_title` describe the page, not an element — requiring a
  // locator for them would make a legitimate assertion unsaveable.
  if (step.action === "assert" && isPageLevelAssertion(step.assertion?.kind as AssertionKind)) {
    return false;
  }
  return true;
}

/** Whether this step names an element by either the v1 or the v2 channel. */
export function stepHasTarget(step: TargetableStep): boolean {
  if (step.locator?.candidates?.length) return true;
  if (step.locator?.user_override?.value?.trim()) return true;
  return !!step.selector?.trim();
}

/** The save-blocking condition: this step must name an element and does not. */
export function stepIsMissingTarget(step: TargetableStep): boolean {
  return stepNeedsTarget(step) && !stepHasTarget(step);
}
