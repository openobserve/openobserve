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

import { readonly, ref } from "vue";

/** Alerts a starter just created, waiting for the alert list to show and mark them. */
export interface JustAddedAlerts {
  folderId: string;
  names: string[];
}

const pending = ref<JustAddedAlerts | null>(null);

export const justAddedAlerts = readonly(pending);

export const markJustAdded = (added: JustAddedAlerts): void => {
  if (added.names.length) pending.value = { folderId: added.folderId, names: [...added.names] };
};

/** Hands the waiting alerts to one reader, so a later visit to the list marks nothing. */
export const takeJustAdded = (): JustAddedAlerts | null => {
  const added = pending.value;
  pending.value = null;
  return added;
};
