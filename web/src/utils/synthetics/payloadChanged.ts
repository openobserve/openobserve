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

import { cloneDeep, isEqual } from "lodash-es";
import type { BrowserCheck } from "@/types/synthetics";
import { buildCreateBrowserTestPayload } from "./buildPayload";
import { startFromScheduleFields } from "./scheduleStart";

/** Whether saving `current` would send something other than `saved`. */
export function browserCheckChanged(current: BrowserCheck, saved: BrowserCheck): boolean {
  const next = buildCreateBrowserTestPayload(cloneDeep(current));
  const before = buildCreateBrowserTestPayload(cloneDeep(saved));
  // Schedule Now reads `start`/`tz_offset` off the clock; Schedule Later derives them from the author's fields.
  if (startFromScheduleFields(current) || startFromScheduleFields(saved))
    return !isEqual(next, before);
  const { start: _start, tz_offset: _tz, ...rest } = next;
  const { start: _savedStart, tz_offset: _savedTz, ...savedRest } = before;
  return !isEqual(rest, savedRest);
}
