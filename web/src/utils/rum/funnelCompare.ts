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

import { formatInTimeZone } from "date-fns-tz";
import type { I18nKey, I18nText } from "@/types/i18n";
import { COMPARE_OFFSET_MS, type CompareOffset } from "@/utils/metrics/explorerUrlState";
import {
  BREAKDOWN_TOP,
  hitCounts,
  isNamedDim,
  type BreakdownRow,
  type BreakdownStart,
  type FunnelResult,
} from "@/utils/rum/productAnalyticsModel";

const DAY_US = 86_400_000_000;
/** Compare doubles the scan, so it is offered only up to this range. */
export const COMPARE_MAX_US = 31 * DAY_US;
export const COMPARE_MODE_LABEL_KEYS: Record<FunnelCompareMode, I18nKey> = {
  prev: "rum.analytics.funnel.comparePrev",
  "1h": "rum.analytics.funnel.compareAgo1h",
  "1d": "rum.analytics.funnel.compareAgo1d",
  "1w": "rum.analytics.funnel.compareAgo1w",
};
export const FUNNEL_COMPARE_MODES: readonly FunnelCompareMode[] = ["prev", "1h", "1d", "1w"];
/** Below this many units at the step above, in either period, a change reads as noise. */
export const LOW_VOLUME_MIN = 30;
const Z95 = 1.96;

/** What the funnel compares with: the previous period, or the range shifted back by a fixed offset. */
export type FunnelCompareMode = "prev" | CompareOffset;

/** Why an offset cannot be used on a range, or "ok". */
export type CompareModeState = "ok" | "overlaps" | "same";

export interface UsWindow {
  startUs: number;
  endUs: number;
}

/** A change in a rate between two periods, in percentage points. */
export interface RateChange {
  pts: number;
  ci95: number;
  lowVolume: boolean;
  curN: number;
  prevN: number;
}

export type ChangeDirection = "up" | "down" | "flat";

/** One step's previous-period numbers; null is a value the previous period cannot give. */
export interface StepCompare {
  prevUnits: number | null;
  prevOfPrevious: number | null;
  prevOfFirst: number | null;
  change: RateChange | null;
}

/** The drop between step i and i + 1 in the previous period, beside this period's. */
export interface DropCompare {
  prevRate: number;
  prevCount: number;
  prevOutOf: number;
  rose: boolean;
  lowVolume: boolean;
}

export interface FunnelCompare {
  empty: boolean;
  steps: StepCompare[];
  drops: (DropCompare | null)[];
  overall: RateChange | null;
  prevOverall: number | null;
}

/** What the funnel page hands its tables while compare is on. */
export interface FunnelCompareView {
  status: "loading" | "failed" | "ok";
  data: FunnelCompare | null;
  label: I18nText;
  range: string;
  prevRange: string;
  rangeExact: string;
  prevRangeExact: string;
}

/** A breakdown value's overall conversion in the previous period. */
export interface PrevSide {
  first: number;
  last: number;
  conversion: number | null;
  change: RateChange | null;
}

export interface ComparedBreakdownRow extends BreakdownRow {
  prev: PrevSide | null;
  prevOnly: boolean;
}

/** What the funnel page hands its breakdown table while compare is on; rows carry their own previous side. */
export interface BreakdownCompareState {
  status: "loading" | "failed" | "ok";
  total: PrevSide | null;
  label: I18nText;
  prevRange: string;
}

/** The window of the same length that ends where `cur` starts, so the two never overlap. */
export function previousWindow(cur: UsWindow): UsWindow {
  return { startUs: cur.startUs - (cur.endUs - cur.startUs), endUs: cur.startUs };
}

export function compareWindow(cur: UsWindow, mode: FunnelCompareMode): UsWindow {
  if (mode === "prev") return previousWindow(cur);
  const off = COMPARE_OFFSET_MS[mode] * 1000;
  return { startUs: cur.startUs - off, endUs: cur.endUs - off };
}

export function compareModeState(cur: UsWindow, mode: FunnelCompareMode): CompareModeState {
  if (mode === "prev") return "ok";
  const off = COMPARE_OFFSET_MS[mode] * 1000;
  const len = cur.endUs - cur.startUs;
  if (off < len) return "overlaps";
  return off === len ? "same" : "ok";
}

export function compareAllowed(cur: UsWindow): boolean {
  return cur.endUs > cur.startUs && cur.endUs - cur.startUs <= COMPARE_MAX_US;
}

/** The mode a range actually compares with: an offset the range cannot use falls back to the previous period. */
export function effectiveCompareMode(
  cur: UsWindow | null,
  mode: FunnelCompareMode | null,
): FunnelCompareMode | null {
  if (!mode || !cur || !compareAllowed(cur)) return null;
  return compareModeState(cur, mode) === "ok" ? mode : "prev";
}

/** `x` of `n` now against `px` of `pn` before; null when either period has nobody at the step above. */
export function rateChange(x: number, n: number, px: number, pn: number): RateChange | null {
  if (n <= 0 || pn <= 0) return null;
  const p = x / n;
  const pp = px / pn;
  const se = Math.sqrt((p * (1 - p)) / n + (pp * (1 - pp)) / pn);
  return {
    pts: (p - pp) * 100,
    ci95: Z95 * se * 100,
    lowVolume: n < LOW_VOLUME_MIN || pn < LOW_VOLUME_MIN,
    curN: n,
    prevN: pn,
  };
}

/** Direction as printed, so a change that rounds to 0.0 never gets an arrow. */
export function changeDirection(c: RateChange): ChangeDirection {
  const r = Math.round(c.pts * 10) / 10;
  if (r > 0) return "up";
  return r < 0 ? "down" : "flat";
}

export const formatPts = (pts: number): string => Math.abs(pts).toFixed(1);

export function compareFunnel(cur: FunnelResult, prev: FunnelResult): FunnelCompare {
  const pu = prev.steps.map((s) => s.units);
  const first = pu[0] ?? 0;
  const empty = first === 0;
  // Once a previous step reaches nobody, every step after it has no rate to give.
  const zeroAt = pu.findIndex((u) => u === 0);
  const steps: StepCompare[] = cur.steps.map((s, i) => {
    if (empty || pu[i] === undefined)
      return { prevUnits: null, prevOfPrevious: null, prevOfFirst: null, change: null };
    const above = i > 0 ? pu[i - 1] : 0;
    const after = zeroAt >= 0 && i > zeroAt;
    return {
      prevUnits: pu[i],
      prevOfPrevious: i > 0 && above > 0 ? pu[i] / above : null,
      prevOfFirst: after ? null : pu[i] / first,
      change: i > 0 ? rateChange(s.units, cur.steps[i - 1].units, pu[i], above) : null,
    };
  });
  const drops = cur.steps.slice(0, -1).map((_, i): DropCompare | null => {
    const change = steps[i + 1]?.change;
    if (empty || !pu[i] || pu[i + 1] === undefined) return null;
    return {
      prevRate: 1 - pu[i + 1] / pu[i],
      prevCount: pu[i] - pu[i + 1],
      prevOutOf: pu[i],
      rose: !!change && changeDirection(change) === "down",
      lowVolume: !!change?.lowVolume,
    };
  });
  const n = cur.steps.length;
  const last = n ? cur.steps[n - 1].units : 0;
  const prevLast = pu[n - 1] ?? 0;
  return {
    empty,
    steps,
    drops,
    overall: n > 1 ? rateChange(last, cur.steps[0].units, prevLast, first) : null,
    prevOverall: empty ? null : prevLast / first,
  };
}

/** Lines the previous run's per-value rows up with this period's folded rows; only overall conversion is compared. */
export function compareBreakdown(
  cur: { rows: BreakdownRow[]; total: number[]; start?: BreakdownStart | null },
  curHits: Record<string, unknown>[],
  prevHits: Record<string, unknown>[],
  steps: number,
): { rows: ComparedBreakdownRow[]; total: PrevSide | null } {
  const k = cur.start && !cur.start.anyStep ? cur.start.step : 1;
  const head = new Set(cur.rows.flatMap((r) => (r.value === null ? [] : [r.value])));
  // An attribute breakdown from a start step keeps its unnamed units in their own row, apart from Other.
  const split = !!cur.start && !cur.start.anyStep;
  // From any step, Other holds only named values and unnamed units sit in Not set.
  const anyStep = !!cur.start?.anyStep;
  // Only a value with units at step k is in this period's Other; the rest show as previous-only rows.
  const folded = split
    ? cur.rows.some((r) => r.other)
      ? curHits.filter((h) => isNamedDim(h) && hitCounts(h, k)[k - 1] > 0)
      : []
    : curHits.filter(isNamedDim);
  const seenNow = new Set(folded.map((h) => String(h.dim)));
  const restRow = cur.rows.find(
    (r) => r.value === null && (split ? r.noValue : anyStep ? r.notSet : true),
  );
  const byValue = new Map<string, Record<string, unknown>[]>();
  const restNamed: Record<string, unknown>[] = [];
  const restUnnamed: Record<string, unknown>[] = [];
  const prevOnly: Record<string, unknown>[] = [];
  for (const h of prevHits) {
    const dim = String(h.dim);
    if (isNamedDim(h) && head.has(dim)) byValue.set(dim, [...(byValue.get(dim) ?? []), h]);
    // A value folded into this period's Other is compared there; an unnamed one goes to this period's null row.
    else if (isNamedDim(h) && seenNow.has(dim)) restNamed.push(h);
    else if (!isNamedDim(h) && restRow) restUnnamed.push(h);
    else prevOnly.push(h);
  }
  const hitsOf = (r: BreakdownRow): Record<string, unknown>[] | null => {
    if (r.leftBefore) return null;
    if (r.value !== null) return byValue.get(r.value) ?? [];
    if (r.noValue || (anyStep && r.notSet)) return restUnnamed;
    return split || anyStep ? restNamed : [...restNamed, ...restUnnamed];
  };
  const rows: ComparedBreakdownRow[] = cur.rows.map((r) => {
    const hits = hitsOf(r);
    return {
      ...r,
      prev: prevSide(
        r.counts.slice(k - 1),
        hits?.length ? sumCounts(hits, steps).slice(k - 1) : null,
      ),
      prevOnly: false,
    };
  });
  const atK = (h: Record<string, unknown>) => hitCounts(h, k)[k - 1];
  const named = prevOnly.filter(isNamedDim).sort((a, b) => atK(b) - atK(a));
  const own = named.slice(0, BREAKDOWN_TOP);
  rows.push(...own.map((h) => prevOnlyRow([h], steps, String(h.dim), k)));
  const overflow = named.slice(BREAKDOWN_TOP);
  if (overflow.length) rows.push(prevOnlyRow(overflow, steps, null, k));
  const unnamed = prevOnly.filter((h) => !isNamedDim(h));
  if (unnamed.length) rows.push(prevOnlyRow(unnamed, steps, null, k));
  return {
    rows,
    total: prevSide(cur.total.slice(k - 1), sumCounts(prevHits, steps).slice(k - 1)),
  };
}

/** A short range label ("8–11 Oct"); a range under a day shows times instead of days. */
export function formatWindow(w: UsWindow, tz: string): string {
  if (w.endUs - w.startUs < DAY_US) {
    const sameDay = fmt(w.startUs, tz, "yyyyMMdd") === fmt(w.endUs, tz, "yyyyMMdd");
    return sameDay
      ? `${fmt(w.startUs, tz, "d MMM, HH:mm")}–${fmt(w.endUs, tz, "HH:mm")}`
      : `${fmt(w.startUs, tz, "d MMM HH:mm")} – ${fmt(w.endUs, tz, "d MMM HH:mm")}`;
  }
  // The end is exclusive, so the last day shown is the one holding the window's final instant.
  const lastUs = w.endUs - 1;
  if (fmt(w.startUs, tz, "yyyy") !== fmt(lastUs, tz, "yyyy"))
    return `${fmt(w.startUs, tz, "d MMM yyyy")} – ${fmt(lastUs, tz, "d MMM yyyy")}`;
  if (fmt(w.startUs, tz, "MM") !== fmt(lastUs, tz, "MM"))
    return `${fmt(w.startUs, tz, "d MMM")} – ${fmt(lastUs, tz, "d MMM")}`;
  if (fmt(w.startUs, tz, "d") === fmt(lastUs, tz, "d")) return fmt(w.startUs, tz, "d MMM");
  return `${fmt(w.startUs, tz, "d")}–${fmt(lastUs, tz, "d MMM")}`;
}

export function formatWindowExact(w: UsWindow, tz: string): string {
  return `${fmt(w.startUs, tz, "d MMM yyyy, HH:mm")} – ${fmt(w.endUs, tz, "d MMM yyyy, HH:mm")}`;
}

const sumCounts = (hits: Record<string, unknown>[], steps: number): number[] =>
  hits.reduce<number[]>(
    (acc, h) => acc.map((v, i) => v + hitCounts(h, steps)[i]),
    Array(steps).fill(0),
  );

const prevSide = (now: number[], before: number[] | null): PrevSide | null => {
  if (!before) return null;
  const k = before.length - 1;
  const first = before[0] ?? 0;
  const last = before[k] ?? 0;
  return {
    first,
    last,
    conversion: first > 0 ? last / first : null,
    change: rateChange(now[k] ?? 0, now[0] ?? 0, last, first),
  };
};

const prevOnlyRow = (
  hits: Record<string, unknown>[],
  steps: number,
  value: string | null,
  k: number,
): ComparedBreakdownRow => {
  const zeros: number[] = Array(steps).fill(0);
  const notSet = value === null && hits.every((h) => !isNamedDim(h));
  return {
    value,
    label: value ?? "",
    counts: zeros,
    conversion: 0,
    atLeast: false,
    other: value === null && !notSet,
    notSet,
    noValue: false,
    leftBefore: false,
    medianMs: null,
    prev: prevSide(zeros.slice(k - 1), sumCounts(hits, steps).slice(k - 1)),
    prevOnly: true,
  };
};

const fmt = (us: number, tz: string, pattern: string): string =>
  formatInTimeZone(new Date(us / 1000), tz, pattern);
