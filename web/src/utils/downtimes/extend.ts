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

import { raw, type I18nText } from "@/types/i18n";
import type { DowntimeListItem } from "@/services/downtimes";

/** The server appends this to the name of the one-time row that extends a recurring one. */
const FOLLOW_UP_SUFFIX = " (extended)";

/** Only a window in force now can be extended. */
export const isExtendable = (row: Pick<DowntimeListItem, "status" | "current_window">): boolean =>
  row.status === "active" && !!row.current_window;

export const isRecurring = (row: Pick<DowntimeListItem, "schedule">): boolean =>
  row.schedule.repeat !== "none";

/** The name the server gives a recurring row's follow-up, shown before saving. */
export const followUpName = (name: string): I18nText => raw(`${name}${FOLLOW_UP_SUFFIX}`);

/** Where the extended window starts: the row's start for a one-time row, the window end for a recurring one. */
export function extensionStart(row: DowntimeListItem): number | null {
  if (!row.current_window) return null;
  return isRecurring(row) ? row.current_window.end : row.schedule.starts_at;
}
