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

import { nextTick } from "vue";

/**
 * Bring the first invalid field into view after a rejected submit.
 *
 * On a long form the failing field is often scrolled off-screen, so the user
 * gets "Please fill required fields" with nothing visibly wrong — they cannot
 * tell WHICH field, or even that the page has more of it above. Scrolling the
 * offender into view and focusing it turns a dead-end toast into an actionable
 * one.
 *
 * Selection order:
 *
 * 1. `[aria-invalid="true"]` — every `OInput`-based control sets this, so it covers all standard
 *    fields and is framework-agnostic (no per-form field registry to keep in sync).
 * 2. `[data-error="true"]` — a non-focusable wrapper for controls that are not real form elements,
 *    e.g. the Monaco body editor (o2-enterprise#2394), which has no focusable node of its own to
 *    mark.
 *
 * Awaits `nextTick` first: validation state is applied during the same tick as
 * the submit, so querying before the DOM updates would find nothing.
 *
 * @param root Limit the search to this subtree. Defaults to the whole document.
 * @returns whether a field was found and scrolled to.
 */
export async function scrollToFirstError(root?: ParentNode): Promise<boolean> {
  await nextTick();

  const scope = root ?? document;
  const target =
    scope.querySelector<HTMLElement>('[aria-invalid="true"]') ??
    scope.querySelector<HTMLElement>('[data-error="true"]');

  if (!target) return false;

  target.scrollIntoView({ behavior: "smooth", block: "center" });
  // Focus so the user can start typing the fix immediately. Guarded: the
  // fallback target is a wrapper div, which is not focusable.
  target.focus?.({ preventScroll: true });

  return true;
}
