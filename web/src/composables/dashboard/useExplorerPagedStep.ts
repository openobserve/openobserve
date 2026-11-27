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

import { computed } from "vue";

/** Prev/next for an explorer's open item that steps across page edges: past the last row it loads
 * the next page and opens its first item, before the first row the previous page's last. */
export function useExplorerPagedStep<T>(options: {
  items: () => T[];
  index: () => number;
  page: () => number;
  nextPageExists: () => boolean;
  loadPage: (page: number) => Promise<void>;
  open: (item: T) => void;
}) {
  let stepping = false;

  const hasPrev = computed(() => {
    const at = options.index();
    return at > 0 || (at === 0 && options.page() > 0);
  });
  const hasNext = computed(() => {
    const at = options.index();
    return at >= 0 && (at < options.items().length - 1 || options.nextPageExists());
  });

  async function step(by: 1 | -1) {
    const at = options.index();
    if (stepping || at < 0) return;
    const items = options.items();
    if (items[at + by] !== undefined) {
      options.open(items[at + by]);
      return;
    }
    if (by > 0 ? !hasNext.value : !hasPrev.value) return;
    stepping = true;
    try {
      const from = options.page();
      await options.loadPage(from + by);
      const loaded = options.items();
      if (loaded.length) {
        options.open(by > 0 ? loaded[0] : loaded[loaded.length - 1]);
        return;
      }
      // A full page without a known total may be the last; come back to its last item.
      await options.loadPage(from);
      const back = options.items();
      if (back.length) options.open(back[back.length - 1]);
    } finally {
      stepping = false;
    }
  }

  return { hasPrev, hasNext, step };
}
