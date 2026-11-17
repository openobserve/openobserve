// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { onBeforeUnmount, ref, watch, type ComponentPublicInstance, type Ref } from "vue";

// The plain bar's one-line height (`min-h-7.5`); a host's pane is sized for exactly that line.
const ONE_LINE_REM = 1.875;

/** Pixels a builder has grown past one line, for a host that grows its pane with it; null while it is not shown. */
export function useFilterBarGrowth(target: Ref<ComponentPublicInstance | HTMLElement | null>) {
  const growth = ref<number | null>(null);
  let observer: ResizeObserver | null = null;

  const measure = (element: HTMLElement) => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const height = element.getBoundingClientRect().height;
    growth.value = Math.max(0, Math.ceil(height - ONE_LINE_REM * rem));
  };

  watch(
    target,
    (value) => {
      observer?.disconnect();
      observer = null;
      const element =
        value instanceof HTMLElement ? value : (value?.$el as HTMLElement | undefined);
      if (!element || typeof ResizeObserver === "undefined") {
        growth.value = null;
        return;
      }
      observer = new ResizeObserver(() => measure(element));
      observer.observe(element);
      measure(element);
    },
    { immediate: true, flush: "post" },
  );

  onBeforeUnmount(() => observer?.disconnect());

  return growth;
}
