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

import useTimeRangeHost, {
  type TimeRangeGuard,
  type TimeRangeHost,
  type TimeRangeHostOptions,
} from "@/composables/useTimeRangeHost";
import useTimeRangeContext from "@/composables/useTimeRangeContext";
import { rangeFromLegacy, rangeToLegacy, type TimeRange } from "@/utils/timeRangeModel";

/** The `on:date-change` payload a page's date handler already reads. */
export interface PageDateChange {
  startTime?: number;
  endTime?: number;
  relativeTimePeriod?: string | null;
  valueType?: string;
  userChangedValue?: boolean;
  [key: string]: unknown;
}

export interface PageTimeRangeOptions extends Omit<TimeRangeHostOptions, "run"> {
  /** The page's own date handler: it stores the range and loads, as it did for `on:date-change`. */
  onRange: (value: PageDateChange) => void;
  /** A page whose handler only stores the range: every apply stores it, and this runs by the preset's rule. */
  run?: () => void;
}

export interface PageTimeRange extends TimeRangeHost {
  /** Bind to `@on:date-change`: forwards picker setters and the mount replay only. */
  onDateChange: (value: PageDateChange) => void;
}

const LAST_15_MINUTES: TimeRange = { kind: "rolling", span: "15m" };

/** A page's stored legacy range as a model range, or the page default. */
export const pageRange = (
  value:
    | {
        type?: string;
        valueType?: string;
        startTime?: number | null;
        endTime?: number | null;
        relativeTimePeriod?: string | null;
      }
    | null
    | undefined,
  fallback: TimeRange = LAST_15_MINUTES,
): TimeRange =>
  (value
    ? rangeFromLegacy({
        ...value,
        startTime: value.startTime ?? undefined,
        endTime: value.endTime ?? undefined,
      })
    : null) ?? fallback;

// Older emitters send bare instants with no value type; those are a fixed range.
const changeRange = (value: PageDateChange): TimeRange | null => {
  const read = rangeFromLegacy(value);
  if (read) return read;
  const startUs = Number(value.startTime);
  const endUs = Number(value.endTime);
  return Number.isFinite(startUs) && Number.isFinite(endUs) && startUs < endUs
    ? { kind: "fixed", startUs, endUs }
    : null;
};

/** `useTimeRangeHost` for a page whose loading lives in an existing date handler (ui-spec §4). */
export default function usePageTimeRange(o: PageTimeRangeOptions): PageTimeRange {
  const context = useTimeRangeContext();
  const toPage = (): PageDateChange => ({ ...host.legacy.value, userChangedValue: true });
  const host: TimeRangeHost = useTimeRangeHost({
    ...o,
    run: () => (o.run ? o.run() : o.onRange(toPage())),
  });
  // Set by Back: the picker's echo of the old range must not reload what is already on screen.
  let restoring = false;
  // A user change is `apply` then its `on:date-change` echo; an echo with no apply is a legacy emitter.
  let applied = false;

  const onApply: TimeRangeHost["onApply"] = (next, meta) => {
    applied = true;
    if (o.run) o.onRange({ ...rangeToLegacy(next, context.now()), userChangedValue: true });
    host.onApply(next, meta);
  };

  const onDateChange = (value: PageDateChange) => {
    if (!value) return;
    if (value.userChangedValue) {
      const echo = applied;
      applied = false;
      const picked = echo ? null : changeRange(value);
      if (picked) onApply(picked, { source: "panel", run: value.rerun === true });
      applied = false;
      return;
    }
    const moved = changeRange(value);
    if (restoring) {
      restoring = false;
      return;
    }
    if (moved) host.range.value = moved;
    o.onRange(value);
  };

  const dismissGuard = () => {
    restoring = host.guard.value !== null;
    host.dismissGuard();
  };

  return { ...host, onApply, onDateChange, dismissGuard };
}

/** A dashboard gate's held legacy pair as the strip's guard; null while nothing is held. */
export const heldGuard = (
  held: { from: unknown; to: unknown } | null,
  days: number | null,
  panels: number,
): TimeRangeGuard | null => {
  if (!held || days === null) return null;
  const from = pageRange(held.from as Parameters<typeof pageRange>[0], LAST_15_MINUTES);
  const to = pageRange(held.to as Parameters<typeof pageRange>[0], LAST_15_MINUTES);
  return { from, to, days, panels };
};
