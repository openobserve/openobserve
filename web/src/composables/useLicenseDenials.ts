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
import { isPageLocked } from "@/composables/useFeatureLock";

// null while there is nothing to show; [] is a denial that named no feature.
const licenseDenials = ref<string[] | null>(null);
let pageChangedAt = 0;

/** Record a license denial (403 + 40001) for the layout's top bar, kept apart from the RBAC access notice. */
export function addLicenseDeniedError(features: string[], requestStartedAt = Date.now()): void {
  // A locked page disables every action, so its denials only come from its own background loads.
  if (requestStartedAt < pageChangedAt || isPageLocked()) return;
  licenseDenials.value = [...new Set([...(licenseDenials.value ?? []), ...features])];
}

export function useLicenseDenials() {
  return {
    features: readonly(licenseDenials),
    dismiss: () => {
      licenseDenials.value = null;
    },
  };
}

/** Clears the top bar's license denials on navigation and ignores those of requests the old page started. */
export function clearLicenseDenials(): void {
  pageChangedAt = Date.now();
  licenseDenials.value = null;
}
