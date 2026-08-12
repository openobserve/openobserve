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

/**
 * useDbmScope — the time window every Database Monitoring screen shares.
 *
 * The window is whatever the app's shared `DateTime` picker produced: a
 * relative period (`15m`, `24h`) or an absolute pair. Both collapse to the same
 * pair of microsecond bounds, which is the only thing a DBM endpoint takes.
 *
 * The Δ column compares this window against the IMMEDIATELY PRECEDING one of
 * the SAME LENGTH, so `previous` is always derived from `current`'s duration —
 * that holds for an absolute range just as it does for a relative one.
 */

import { computed, ref } from "vue";

const MINUTE_US = 60_000_000;

export interface DbmWindow {
  /** Inclusive start, microseconds. */
  startTime: number;
  /** Exclusive end, microseconds. */
  endTime: number;
}

/** What the URL and the `DateTime` picker agree on. */
export interface DbmRange {
  type: "relative" | "absolute";
  /** e.g. `15m`, `6h`, `1d`. Null on an absolute range. */
  relativeTimePeriod: string | null;
  /** Microseconds. Only meaningful when `type === "absolute"`. */
  startTime: number;
  endTime: number;
}

/**
 * What the shared `DateTime` picker emits on `on:date-change`. Times are
 * microseconds; `relativeTimePeriod` is null on an absolute selection.
 */
export interface DbmDateChange {
  startTime?: number;
  endTime?: number;
  relativeTimePeriod?: string | null;
  valueType?: string;
}

/** The window used when a caller supplies nothing usable. */
export const DBM_DEFAULT_PERIOD = "1h";

/**
 * What the current window is compared AGAINST (W5/B12).
 *
 * The comparison used to be welded to the immediately preceding window, which
 * left the most common question — "did this get slower since the deploy?" —
 * unanswerable: widening the picker to 7 days moved the baseline to the 7 days
 * before that, so the reader could never hold the baseline still while they
 * changed what they were looking at.
 *
 *  • `previous` — the same-length window immediately before. The default, and
 *    the behaviour every DBM screen already had.
 *  • `yesterday` — the same clock hours one day earlier, which is what makes a
 *    same-time-of-day comparison possible across a daily traffic cycle.
 */
export type DbmBaseline = "previous" | "yesterday";

/** The default, and what an unrecognised baseline falls back to. */
export const DBM_DEFAULT_BASELINE: DbmBaseline = "previous";

const DAY_US = 24 * 60 * MINUTE_US;

/** Suffix → minutes. Mirrors what `DateTime` emits as `relativeTimePeriod`. */
const PERIOD_UNIT_MINUTES: Record<string, number> = {
  s: 1 / 60,
  m: 1,
  h: 60,
  d: 60 * 24,
  w: 60 * 24 * 7,
  M: 60 * 24 * 30,
};

/**
 * Minutes for a relative period string. Anything unparseable falls back to the
 * default rather than propagating: a `NaN` here would poison every timestamp on
 * the request.
 */
export const periodToMinutes = (period: unknown): number => {
  const text = typeof period === "string" ? period.trim() : "";
  const match = /^(\d+(?:\.\d+)?)([smhdwM])$/.exec(text);
  if (!match) return 60;
  const value = Number(match[1]);
  const unit = PERIOD_UNIT_MINUTES[match[2]];
  if (!Number.isFinite(value) || value <= 0 || !unit) return 60;
  return value * unit;
};

/**
 * Read `?period=` / `?from=`+`?to=` — the app-wide convention (see
 * `plugins/traces/views/useServiceViewTimeRange.ts`). Absolute wins when both
 * are present, but the two are never written together.
 */
export const rangeFromQuery = (query: Record<string, unknown>): DbmRange => {
  const from = Number(query.from);
  const to = Number(query.to);
  if (Number.isFinite(from) && Number.isFinite(to) && from > 0 && to > from) {
    return { type: "absolute", relativeTimePeriod: null, startTime: from, endTime: to };
  }
  const period = typeof query.period === "string" ? query.period.trim() : "";
  return {
    type: "relative",
    relativeTimePeriod: period || DBM_DEFAULT_PERIOD,
    startTime: 0,
    endTime: 0,
  };
};

/**
 * The query params for a range, per the app convention: relative writes ONLY
 * `period`, absolute writes ONLY `from`/`to`. The unused keys are returned as
 * `undefined` so a spread over the existing query clears them.
 */
export const rangeToQuery = (range: DbmRange) =>
  range.type === "absolute"
    ? { period: undefined, from: String(range.startTime), to: String(range.endTime) }
    : { period: range.relativeTimePeriod ?? DBM_DEFAULT_PERIOD, from: undefined, to: undefined };

/**
 * The instant each relative range is pinned to, shared across mounts.
 *
 * Module scope, deliberately, and for the same reason `useDbmCountCache` keeps
 * its map there: the six DBM views are separate ROUTES, so component state dies
 * on every tab switch and only a module-level binding survives the remount.
 *
 * Before this, `anchor` was pinned in the composable's initialiser, so every
 * landing resolved a relative window to a DIFFERENT microsecond bound. Two
 * things followed. Nothing keyed on those bounds could ever cache-hit. And the
 * badge fan-out (keyed on the stable `DbmRange`) and the page's own data read
 * (built from the fresh bounds) described different windows inside a single
 * click — measured live at 22ms apart, seven requests on one `start_time` and
 * an eighth on another.
 *
 * Keyed per range because different ranges are different questions: one shared
 * pin would collapse `15m` and `1h` onto a single instant.
 */
const anchors = new Map<string, number>();

/** The anchor-table key for a range. Absolute ranges never consult it. */
const anchorKey = (range: DbmRange): string => range.relativeTimePeriod ?? DBM_DEFAULT_PERIOD;

/** Drop every pin. For tests, so one cannot seed the next. */
export const clearDbmAnchors = () => anchors.clear();

export function useDbmScope(query: Record<string, unknown> = {}) {
  const range = ref<DbmRange>(rangeFromQuery(query));

  /**
   * Pinned once per range rather than read from the clock per access, so that
   * every request in one refresh cycle — current window, previous window, both
   * pages — describes the SAME instant. Recomputing `Date.now()` per call would
   * let the two windows drift apart by the duration of the fetch and silently
   * corrupt the delta. Unused on an absolute range, which is already pinned.
   *
   * Seeded from the shared table so a remount inherits the window the previous
   * landing used. Re-pinning is something the READER does — a refresh, a range
   * change — not something a tab switch does behind their back.
   */
  const pin = (): number => {
    const key = anchorKey(range.value);
    const held = anchors.get(key);
    if (held !== undefined) return held;
    const now = Date.now() * 1000;
    anchors.set(key, now);
    return now;
  };

  const anchor = ref<number>(pin());

  /**
   * The window's length in minutes. Still exposed because the storm heuristic
   * and the "widen the window" empty-state action reason about duration, not
   * about which kind of range produced it.
   */
  const rangeMinutes = computed(() =>
    range.value.type === "absolute"
      ? (range.value.endTime - range.value.startTime) / MINUTE_US
      : periodToMinutes(range.value.relativeTimePeriod),
  );

  const current = computed<DbmWindow>(() =>
    range.value.type === "absolute"
      ? { startTime: range.value.startTime, endTime: range.value.endTime }
      : { startTime: anchor.value - rangeMinutes.value * MINUTE_US, endTime: anchor.value },
  );

  /** The same-length window immediately before `current`. */
  const previous = computed<DbmWindow>(() => {
    const span = current.value.endTime - current.value.startTime;
    return { startTime: current.value.startTime - span, endTime: current.value.startTime };
  });

  /** Which comparison the reader picked. `previous` is the shipped default. */
  const baseline = ref<DbmBaseline>(DBM_DEFAULT_BASELINE);

  /**
   * The window `current` is actually compared against.
   *
   * `yesterday` OFFSETS the window by exactly one day rather than re-deriving
   * it from the span, so the comparison covers the same clock hours and the two
   * sides stay the same length. An unrecognised value falls back to `previous`
   * rather than producing a NaN bound, which would poison every timestamp on
   * the request.
   */
  const baselineWindow = computed<DbmWindow>(() => {
    if (baseline.value === "yesterday") {
      return {
        startTime: current.value.startTime - DAY_US,
        endTime: current.value.endTime - DAY_US,
      };
    }
    return previous.value;
  });

  const setBaseline = (value: DbmBaseline) => {
    baseline.value = value === "yesterday" ? "yesterday" : DBM_DEFAULT_BASELINE;
  };

  /**
   * Re-pin the anchor. Call once per refresh, before issuing requests.
   *
   * The new instant is published to the SHARED table, not just to this
   * instance: a refresh that stayed local would be reverted by the next tab
   * switch, which would inherit the pre-refresh pin and silently undo the
   * refresh the reader just asked for.
   */
  const refresh = () => {
    const now = Date.now() * 1000;
    anchors.set(anchorKey(range.value), now);
    anchor.value = now;
  };

  /**
   * Adopt what the `DateTime` picker emitted. Its payload carries microsecond
   * bounds plus a `relativeTimePeriod` that is null on an absolute selection —
   * which is exactly how the two cases are told apart.
   */
  const setRange = (value: DbmDateChange) => {
    const period = value?.relativeTimePeriod;
    if (period) {
      range.value = {
        type: "relative",
        relativeTimePeriod: period,
        startTime: 0,
        endTime: 0,
      };
    } else if (
      Number.isFinite(value?.startTime) &&
      Number.isFinite(value?.endTime) &&
      (value.endTime as number) > (value.startTime as number)
    ) {
      range.value = {
        type: "absolute",
        relativeTimePeriod: null,
        startTime: value.startTime as number,
        endTime: value.endTime as number,
      };
    }
    refresh();
  };

  /** Switch to a relative window of a given length — used by "widen the window". */
  const setPeriod = (period: string) => {
    range.value = { type: "relative", relativeTimePeriod: period, startTime: 0, endTime: 0 };
    refresh();
  };

  /** The query params for the current range, ready to spread into a route. */
  const queryParams = computed(() => rangeToQuery(range.value));

  return {
    range,
    rangeMinutes,
    anchor,
    current,
    previous,
    baseline,
    baselineWindow,
    setBaseline,
    refresh,
    setRange,
    setPeriod,
    queryParams,
  };
}
