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

/** [min, max] % for the content pane — keeps the Variables panel usable at
 *  either extreme of a drag. */
export const VARIABLES_SPLITTER_LIMITS: [number, number] = [55, 85];

// Module-scoped: the Journey and Configure pages each mount their own
// OSplitter, and a drag on either page must carry to the other.
const variablesSplitter = ref(70);

/** UI-only state of the check wizard shared across its pages. */
export default function useCheckWizardUi() {
  return { variablesSplitter };
}
