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

import { computed, onBeforeUnmount, onMounted, ref, type ComputedRef, type Ref } from "vue";

import { COMPOSER_NARROW_REM, COMPOSER_TIGHT_REM, COMPOSER_WIDE_REM } from "./composerUi";

export interface ComposerWidth {
  /** The composer's own width in px; 0 until measured. */
  width: Ref<number>;
  narrow: ComputedRef<boolean>;
  tight: ComputedRef<boolean>;
  wide: ComputedRef<boolean>;
}

/** Follows the composer's own width, since a window or a sidebar is narrow on any screen. */
export function useComposerWidth(root: Ref<HTMLElement | null>): ComposerWidth {
  const width = ref(0);
  const rem = ref(16);
  let observer: ResizeObserver | null = null;

  const atMost = (limit: number) => width.value > 0 && width.value <= limit * rem.value;

  onMounted(() => {
    const target = root.value;
    if (!target || typeof ResizeObserver === "undefined") return;
    rem.value = parseFloat(getComputedStyle(document.documentElement).fontSize) || rem.value;
    observer = new ResizeObserver(() => (width.value = target.getBoundingClientRect().width));
    observer.observe(target);
  });
  onBeforeUnmount(() => observer?.disconnect());

  return {
    width,
    narrow: computed(() => atMost(COMPOSER_NARROW_REM)),
    tight: computed(() => atMost(COMPOSER_TIGHT_REM)),
    wide: computed(() => width.value >= COMPOSER_WIDE_REM * rem.value),
  };
}
