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

/** How long an opened step keeps its focus ring. */
export const STEP_HIGHLIGHT_MS = 2_000;

/** Fired on the answer so a trail without a store (a shared page) expands the step itself. */
export const OPEN_STEP_EVENT = "o2-assistant-open-step";

const HIGHLIGHT = ["ring-2", "ring-border-strong"];

const timers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/** After the store expanded a step: scroll its header into view, focus it and ring it for two seconds. */
export async function revealStep(from: HTMLElement | null, callId: string): Promise<boolean> {
  const scope = from?.closest("article") ?? from?.ownerDocument;
  scope?.dispatchEvent(new CustomEvent(OPEN_STEP_EVENT, { detail: { callId } }));
  await nextTick();
  // Compared, not put in a selector, so no call id can break or widen the query.
  const header = Array.from(scope?.querySelectorAll<HTMLElement>("[data-step-header]") ?? []).find(
    (candidate) => candidate.dataset.stepHeader === callId,
  );
  if (!header) return false;
  header.scrollIntoView?.({ block: "nearest" });
  header.focus();
  header.classList.add(...HIGHLIGHT);
  const previous = timers.get(header);
  if (previous) clearTimeout(previous);
  timers.set(
    header,
    setTimeout(() => header.classList.remove(...HIGHLIGHT), STEP_HIGHLIGHT_MS),
  );
  return true;
}
