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

import type { BrowserCheck } from "@/types/synthetics";

/** Whether a save takes `start` from the Schedule Later fields rather than the clock. */
export function startFromScheduleFields({ schedule }: BrowserCheck): boolean {
  if (!schedule) return false;
  return schedule.startType === "later" && !!schedule.startDate && !!schedule.startTime;
}
