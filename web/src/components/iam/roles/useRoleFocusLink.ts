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

import { nextTick, watch, type Ref } from "vue";
import type { RouteLocationNormalizedLoaded } from "vue-router";

import { MODULE_COPY } from "./roleModules";

/** How long to wait for the pane to render the focused row before giving up quietly. */
const MAX_FRAMES = 60;

const SCOPE_PUT_BOX =
  '[data-test="edit-role-module-pane"] [data-test^="edit-role-module-pane-scope-"][data-test$="-AllowPut"] [role="checkbox"]';

// A module with entities renders its own row, which wins over the scope row; target is a MODULE_COPY key, so safe in a selector.
const putBoxOf = (target: string) =>
  document.querySelector<HTMLElement>(
    `[data-test="edit-role-module-pane"] [data-test="edit-role-permissions-table-body-row-${target}-col-AllowPut-checkbox"] [role="checkbox"]`,
  ) ?? document.querySelector<HTMLElement>(SCOPE_PUT_BOX);

/** The module a `?focus=` deep link opens, or null for a key this page does not offer. */
export function focusTargetOf(route: Pick<RouteLocationNormalizedLoaded, "query">): string | null {
  const focus = route.query.focus;
  if (route.query.module !== "assistant" || typeof focus !== "string") return null;
  return Object.prototype.hasOwnProperty.call(MODULE_COPY, focus) ? focus : null;
}

/** Opens the linked module once the role has loaded and moves focus to its PUT checkbox. */
export function useRoleFocusLink(options: {
  target: string | null;
  ready: Ref<boolean>;
  moduleKeys: Ref<string[]>;
  open: (key: string) => void;
  frame?: (cb: () => void) => void;
}) {
  const { target } = options;
  if (!target) return;
  const frame = options.frame ?? ((cb: () => void) => requestAnimationFrame(() => cb()));
  let done = false;
  watch(
    [options.ready, options.moduleKeys],
    async ([ready, keys]) => {
      if (done || !ready || !keys.includes(target)) return;
      done = true;
      options.open(target);
      await nextTick();
      let frames = 0;
      const tryFocus = () => {
        const box = putBoxOf(target);
        if (box) return box.focus();
        if (++frames < MAX_FRAMES) frame(tryFocus);
      };
      tryFocus();
    },
    { immediate: true },
  );
}
