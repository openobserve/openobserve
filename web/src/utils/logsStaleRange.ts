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

import type { TimeSelection } from "@/composables/useLogs/useAutoRun";

/** The picker's range in the form a run's signature records it. */
export const liveTimeSelection = (datetime: {
  type?: string;
  relativeTimePeriod?: string | null;
  startTime?: number | string;
  endTime?: number | string;
}): TimeSelection =>
  datetime.type === "relative"
    ? { type: "relative", period: String(datetime.relativeTimePeriod ?? "") }
    : { type: "absolute", startUs: Number(datetime.startTime), endUs: Number(datetime.endTime) };

const sameSelection = (a: TimeSelection, b: TimeSelection): boolean => {
  if (a.type === "relative" || b.type === "relative") {
    return (
      a.type === b.type && (a as { period: string }).period === (b as { period: string }).period
    );
  }
  return a.startUs === b.startUs && a.endUs === b.endUs;
};

/** The range the shown results were queried with, when the picker has since moved off it; else null. */
export const staleQueriedRange = (
  queried: TimeSelection | null | undefined,
  live: TimeSelection,
): TimeSelection | null => (queried && !sameSelection(queried, live) ? queried : null);
