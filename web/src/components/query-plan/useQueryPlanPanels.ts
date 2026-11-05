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

import { reactive } from "vue";

// one instance for the Plan and Analyze views, so a hidden panel stays hidden when switching modes
const panels = reactive({ summary: true, detail: true });

/** Which side panels of the query plan dialog are open. */
export function useQueryPlanPanels() {
  /** Picking an operator is a request to read about it, so a hidden detail panel comes back. */
  function revealDetail() {
    panels.detail = true;
  }
  return { panels, revealDetail };
}
