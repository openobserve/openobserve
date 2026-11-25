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

import { ksuidSeconds } from "@/utils/alerts/recentRuns";

/** `?saved=` value after creating an alert: the editor never learns the new alert's id. */
export const ALERT_LIST_SAVED_NEW = "new";

// A newest row older than this is not the alert the save just made (it is not listed yet).
const NEW_ALERT_MAX_AGE_SEC = 600;

/** The row a save lands on: the edited alert's own id, or for a new alert the newest minted id. */
export function savedAlertId(
  rowIds: readonly string[],
  saved: string,
  nowSec: number,
): string | undefined {
  if (saved !== ALERT_LIST_SAVED_NEW) return rowIds.includes(saved) ? saved : undefined;
  // Base62 KSUIDs sort as text in the order they were minted.
  const newest = rowIds
    .filter((id) => ksuidSeconds(id) !== undefined)
    .sort()
    .at(-1);
  const mintedSec = newest ? ksuidSeconds(newest) : undefined;
  return mintedSec !== undefined && nowSec - mintedSec <= NEW_ALERT_MAX_AGE_SEC
    ? newest
    : undefined;
}
