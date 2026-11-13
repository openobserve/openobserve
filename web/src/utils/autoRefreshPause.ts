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

/** An ended fixed range stops refreshing once a run began at or past its end, so the tail is fetched. */
export const fixedRangeRefreshDone = (
  rangeEndUs: number | null | undefined,
  lastRunMs: number | null,
  nowMs: number,
): boolean =>
  fixedRangeEnded(rangeEndUs, nowMs) &&
  (lastRunMs === null || lastRunMs * 1000 >= (rangeEndUs as number));

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

/** One query is owed if a tick fell due unseen; past a fixed range's end, only if the last one ran before that end. */
export const owesCatchUp = (options: {
  intervalSeconds: number;
  lastTickMs: number | null;
  nowMs: number;
  rangeEndUs?: number | null;
}): boolean => {
  if (!(options.intervalSeconds > 0) || options.lastTickMs === null) return false;
  if (fixedRangeEnded(options.rangeEndUs, options.nowMs)) {
    return options.lastTickMs * 1000 < (options.rangeEndUs as number);
  }
  return options.nowMs - options.lastTickMs >= options.intervalSeconds * 1000;
};
