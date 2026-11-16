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

import { linkOverLimit } from "@/composables/useTimeRangeLimits";
import { getConsumableRelativeTime } from "@/utils/date";

/** A linked range the page refused to run because the stream limits it; the page shows the guard strip instead. */
export interface RangeLimitRefusal {
  asked: { startUs: number; endUs: number };
  /** The linked period (`7d`), or null for a fixed range. */
  period: string | null;
  /** The limit as chips write it (`1d`). */
  allowed: string;
  /** The period the strip's "Show" applies (`24h`). */
  allowedPeriod: string;
  stream: string;
}

interface LinkedDatetime {
  type?: string;
  startTime?: number | string;
  endTime?: number | string;
  relativeTimePeriod?: string | null;
}

export const linkRangeRefusal = (
  datetime: LinkedDatetime,
  limitHours: number,
  stream: string,
): RangeLimitRefusal | null => {
  const period = datetime.type === "absolute" ? null : (datetime.relativeTimePeriod ?? null);
  const resolved = period ? getConsumableRelativeTime(period) : null;
  const startUs = Number(resolved ? resolved.startTime : datetime.startTime);
  const endUs = Number(resolved ? resolved.endTime : datetime.endTime);
  if (!Number.isFinite(startUs) || !Number.isFinite(endUs)) return null;
  const over = linkOverLimit({ startUs, endUs }, limitHours);
  if (!over) return null;
  return { asked: over.asked, period, allowed: over.allowed, allowedPeriod: over.period, stream };
};
