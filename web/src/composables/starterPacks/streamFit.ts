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

import { onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";

/** How many leading streams fit in `available` px, leaving room for the +N label when any are left out. */
export function fitCount(widths: number[], moreWidth: number, available: number): number {
  if (!widths.length) return 0;
  // An unmeasured row (hidden, or not laid out yet) shows one stream, as before measuring.
  if (available <= 0) return 1;
  let used = widths.reduce((sum, width) => sum + width, 0);
  if (used <= available) return widths.length;
  for (let count = widths.length - 1; count > 1; count--) {
    used -= widths[count];
    if (used + moreWidth <= available) return count;
  }
  return 1;
}

/** Live count of streams that fit in `row`, measured from hidden copies in `sizer`. */
export function useStreamFit(
  row: Ref<HTMLElement | null>,
  sizer: Ref<HTMLElement | null>,
  streams: () => string[],
) {
  const shown = ref(1);
  let observer: ResizeObserver | null = null;
  const measure = () => {
    const el = row.value;
    const copies = sizer.value;
    if (!el || !copies) return;
    const items = Array.from(copies.querySelectorAll<HTMLElement>("[data-fit-item]"));
    const more = copies.querySelector<HTMLElement>("[data-fit-more]")?.offsetWidth ?? 0;
    const fixed = copies.querySelector<HTMLElement>("[data-fit-fixed]")?.offsetWidth ?? 0;
    shown.value = fitCount(
      items.map((item) => item.offsetWidth),
      more,
      el.clientWidth - fixed,
    );
  };
  watch(streams, () => requestAnimationFrame(measure), { flush: "post" });
  watch(row, (el, old) => {
    if (old) observer?.unobserve(old);
    if (el) observer?.observe(el);
    measure();
  });
  onMounted(() => {
    if (typeof ResizeObserver !== "undefined") observer = new ResizeObserver(measure);
    if (row.value) observer?.observe(row.value);
    measure();
  });
  onBeforeUnmount(() => observer?.disconnect());
  return shown;
}
