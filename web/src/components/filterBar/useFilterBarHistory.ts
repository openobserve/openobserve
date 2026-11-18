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

import { watch, type Ref } from "vue";
import type { FilterGroup } from "@/utils/query/filterBar";

const LIMIT = 100;

// Ids are minted again whenever a page re-reads its saved filter, so they do not make a change.
const shapeOf = (tree: FilterGroup): string =>
  JSON.stringify(tree, (key, value) => (key === "id" ? undefined : value));

/** Undo and redo over every change to the filter, whether the bar or the page made it. */
export function useFilterBarHistory(tree: Ref<FilterGroup>, apply: (next: FilterGroup) => void) {
  const past: FilterGroup[] = [];
  const future: FilterGroup[] = [];
  // The page may hand a restored filter back as a new object, so it is recognised by shape.
  let restoring: string | null = null;

  watch(tree, (next, previous) => {
    const shape = shapeOf(next);
    if (shape === restoring) {
      restoring = null;
      return;
    }
    if (!previous || shape === shapeOf(previous)) return;
    past.push(previous);
    if (past.length > LIMIT) past.shift();
    future.length = 0;
  });

  function step(from: FilterGroup[], to: FilterGroup[]): boolean {
    const target = from.pop();
    if (!target) return false;
    to.push(tree.value);
    restoring = shapeOf(target);
    apply(target);
    return true;
  }

  return {
    undo: () => step(past, future),
    redo: () => step(future, past),
  };
}
