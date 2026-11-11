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

import store from "@/stores";
import { toast } from "@/lib/feedback/Toast/useToast";
import { gt, raw } from "@/types/i18n";
import { isPageLocked } from "@/composables/useFeatureLock";
import { denialCopyKeys } from "@/utils/featureGate";

// One notice per denied feature set until the page changes, so a page firing many requests does not stack toasts.
const shown = new Set<string>();
let pageChangedAt = 0;

/** Tell the user a request was refused by the license or the org's contract on a page left open. */
export function addLicenseDeniedError(
  features: string[],
  requestStartedAt = Date.now(),
  byContract = false,
): void {
  // A locked page shows its own message in place of the page, so only the background loads of other pages land here.
  if (requestStartedAt < pageChangedAt || isPageLocked()) return;
  const key = `${byContract ? "contract" : "license"}:${[...features].sort().join(",")}`;
  if (shown.has(key)) return;
  shown.add(key);
  const names = features.map((k) => store.state.zoConfig?.feature_names?.[k] ?? k).join(", ");
  const copy = denialCopyKeys(byContract);
  toast({
    variant: "warning",
    title: gt(copy.title),
    message: features.length ? gt(copy.message, { features: raw(names) }) : gt(copy.generic),
  });
}

/** Forget the notices already shown and ignore those of requests the previous page started. */
export function clearLicenseDenials(): void {
  pageChangedAt = Date.now();
  shown.clear();
}
