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

const ELLIPSIS = "…";

export function useMiddleCut(
  head: () => string,
  headEl: Ref<HTMLElement | null>,
  watched: () => Array<Element | null | undefined>,
) {
  const shown = ref(head());
  const cut = ref(false);

  // CSS ellipsis leaves up to a glyph of blank before the tail, so the cut is measured instead.
  const fit = () => {
    const full = head();
    const el = headEl.value;
    const node = el?.firstChild;
    let best = full;
    if (el && node instanceof Text) {
      node.nodeValue = full;
      const room = el.clientWidth;
      if (el.scrollWidth > room) {
        let lo = 1;
        let hi = full.length - 1;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          node.nodeValue = full.slice(0, mid) + ELLIPSIS;
          if (el.scrollWidth <= room) lo = mid;
          else hi = mid - 1;
        }
        best = full.slice(0, lo) + ELLIPSIS;
      }
      node.nodeValue = best;
    }
    shown.value = best;
    cut.value = best !== full;
  };

  let observer: ResizeObserver | null = null;
  let live = false;
  onMounted(() => {
    live = true;
    fit();
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => fit());
      for (const el of watched()) if (el) observer.observe(el);
    }
    // A web font that lands after the first fit changes every glyph's width.
    document.fonts?.ready.then(() => live && fit());
  });
  onBeforeUnmount(() => {
    live = false;
    observer?.disconnect();
    observer = null;
  });
  watch(head, () => nextTick(fit));

  return { shown, cut };
}
