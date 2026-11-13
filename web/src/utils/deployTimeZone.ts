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

// Kept apart from serviceVersionsCopy so the app store, which loads with the entry, pulls in only this.
export const deployTimeZone = ref<string | undefined>();

/** Called by the app store whenever the user's timezone setting changes. */
export function setDeployTimeZone(zone: string | undefined) {
  deployTimeZone.value = zone || undefined;
}
