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
import type { IntentId, IntentSlots } from "@/utils/alerts/alertIntents";

export interface IntentState {
  /** The stream the picks were made on; another stream starts them over. */
  stream: string;
  /** The starter the picks belong to, so the save line can say what the alert watches. */
  intent: IntentId | null;
  slots: IntentSlots;
  /** The values a starter suggested; the user's first pick replaces them instead of joining them. */
  seeded: string[];
  /** A value the data cannot tell from the suggested one, offered as a one-click swap while it stands. */
  alternative: string | undefined;
  /** The alert type when the first chip was pressed, so a chip that sets the type keeps its row. */
  typeAtPick: string | undefined;
  /** The user chose to build the alert without a starter. */
  scratch: boolean;
}

const states = new WeakMap<object, IntentState>();

const fresh = (): IntentState =>
  reactive({
    stream: "",
    intent: null,
    slots: {},
    seeded: [],
    alternative: undefined,
    typeAtPick: undefined,
    scratch: false,
  }) as IntentState;

/** Step 1's picks, held per form so they outlive the step folding away and coming back. */
export function useIntentState(owner: object | null | undefined): IntentState {
  if (!owner) return fresh();
  let state = states.get(owner);
  if (!state) {
    state = fresh();
    states.set(owner, state);
  }
  return state;
}
