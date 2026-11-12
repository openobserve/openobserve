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

export type AutoRefreshState = "off" | "running" | "paused-hidden" | "paused-ended";

/** Whether a fixed range has already ended; a rolling range (null end) never does. */
export const fixedRangeEnded = (rangeEndUs: number | null | undefined, nowMs: number): boolean =>
  typeof rangeEndUs === "number" && Number.isFinite(rangeEndUs) && rangeEndUs <= nowMs * 1000;

/** The end (µs) of a picker payload's range when it is fixed, else null. */
export const fixedRangeEnd = (datetime: {
  type?: string;
  valueType?: string;
  endTime?: number;
  relativeTimePeriod?: string | null;
}): number | null => {
  const type = datetime.type ?? datetime.valueType;
  if (type !== "absolute" || datetime.relativeTimePeriod) return null;
  const end = Number(datetime.endTime);
  return Number.isFinite(end) && end > 0 ? end : null;
};

/** An ended fixed range outranks a hidden tab, as coming back would not resume it. */
export const autoRefreshState = (options: {
  intervalSeconds: number;
  hidden: boolean;
  rangeEnded: boolean;
}): AutoRefreshState => {
  if (!(options.intervalSeconds > 0)) return "off";
  if (options.rangeEnded) return "paused-ended";
  if (options.hidden) return "paused-hidden";
  return "running";
};

/** One catch-up is owed on return only if a tick fell due while the tab was hidden. */
export const owesCatchUp = (options: {
  intervalSeconds: number;
  lastTickMs: number | null;
  nowMs: number;
  rangeEnded: boolean;
}): boolean =>
  options.intervalSeconds > 0 &&
  !options.rangeEnded &&
  options.lastTickMs !== null &&
  options.nowMs - options.lastTickMs >= options.intervalSeconds * 1000;
