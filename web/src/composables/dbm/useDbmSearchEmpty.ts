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

/**
 * "Your search matched nothing" — the one empty state that is not about the
 * data.
 *
 * A table with rows that a filter hid is a different situation from a table
 * with no rows, and they call for opposite responses: clear the box, versus go
 * switch on collection. A page that shows the collection checklist to someone
 * who simply mistyped a table name is telling them to fix a problem they do not
 * have.
 *
 * All three conditions matter:
 *
 *   • The box has a query in it. Without this guard a page whose fetch happened
 *     to return nothing while the box held only spaces claims a search hid the
 *     rows — table health shipped exactly that bug, and it swallowed its own
 *     not-collecting checklist whenever the load came back empty.
 *   • Something WAS fetched. There is nothing for a search to have hidden
 *     otherwise.
 *   • Nothing survived the filter.
 */

import { computed, type ComputedRef, type Ref } from "vue";

export const useDbmSearchEmpty = (
  search: Ref<string>,
  allRows: Ref<unknown[]> | ComputedRef<unknown[]>,
  rows: Ref<unknown[]> | ComputedRef<unknown[]>,
): ComputedRef<boolean> =>
  computed(() => !!search.value.trim() && allRows.value.length > 0 && rows.value.length === 0);
