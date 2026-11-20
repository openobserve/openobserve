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

import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";

/** How many leading chips stay in a row `available` wide; when not all fit, room is kept for a trailing "+N more" chip. */
export function chipFoldCount(
  widths: readonly number[],
  available: number,
  gap: number,
  moreWidth: number,
): number {
  const all = widths.reduce((sum, width, index) => sum + width + (index ? gap : 0), 0);
  if (all <= available) return widths.length;
  let used = moreWidth;
  let count = 0;
  for (const width of widths) {
    if (used + gap + width > available) break;
    used += gap + width;
    count++;
  }
  return count;
}

/** Folds the trailing chips of a fixed-width row; each chip carries `data-fold-key`, `more` is the "+N more" chip. */
export function useChipFold(
  row: Ref<HTMLElement | null>,
  more: Ref<HTMLElement | null>,
  chips: Ref<readonly { key: string; label: string }[]>,
) {
  const shown = ref(Number.MAX_SAFE_INTEGER);
  const measure = async () => {
    await nextTick();
    const root = row.value;
    // Without layout (jsdom, a hidden tab) there is no width to fold against, so every chip shows.
    if (!root?.clientWidth) {
      shown.value = Number.MAX_SAFE_INTEGER;
      return;
    }
    const width = (key: string) =>
      root.querySelector<HTMLElement>(`[data-fold-key="${key}"]`)?.getBoundingClientRect().width ??
      0;
    shown.value = chipFoldCount(
      chips.value.map((chip) => width(chip.key)),
      root.clientWidth,
      Number.parseFloat(getComputedStyle(root).columnGap) || 0,
      more.value?.getBoundingClientRect().width ?? 0,
    );
  };
  let observer: ResizeObserver | null = null;
  onMounted(() => {
    void measure();
    if (typeof ResizeObserver === "undefined" || !row.value) return;
    observer = new ResizeObserver(() => void measure());
    observer.observe(row.value);
  });
  onBeforeUnmount(() => observer?.disconnect());
  watch(chips, () => void measure(), { deep: true });
  return { shown, measure };
}
