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

import { ref } from "vue";

/** The explorers' match total, owned by one query run: null until a short page or the count makes
 * it known, so a late, cancelled or failed count never leaves an old total or the page size. */
export function useExplorerTotal() {
  const total = ref<number | null>(0);
  /** True while the count of the current run may still answer. */
  const counting = ref(false);
  let run = 0;
  let exact: number | null = null;
  let seen = 0;
  let failed = false;

  /** A new query: the total is unknown until its rows or its count say otherwise. */
  function begin(): number {
    run += 1;
    total.value = null;
    counting.value = true;
    exact = null;
    seen = 0;
    failed = false;
    return run;
  }

  /** A page of the run arrived: `from` is its offset, `rows` its length. */
  function pageLoaded(r: number, from: number, rows: number, pageSize: number) {
    if (r !== run) return;
    seen = Math.max(seen, from + rows);
    // A short page is the last one, so the total is exact; nothing at all on page 1 is zero.
    if (rows < pageSize && (rows > 0 || from === 0)) {
      exact = from + rows;
      total.value = exact;
    }
  }

  /** The run's count answered (null when it failed or was cancelled). */
  function counted(r: number, matches: number | null) {
    if (r !== run) return;
    counting.value = false;
    if (failed || matches === null) return;
    total.value = exact ?? Math.max(matches, seen);
  }

  /** The run's search failed: no rows and no total. */
  function fail(r: number) {
    if (r !== run) return;
    failed = true;
    counting.value = false;
    total.value = 0;
  }

  return { total, counting, begin, pageLoaded, counted, fail, currentRun: () => run };
}
