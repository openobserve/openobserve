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
 * Axis arithmetic for the SLO trend charts.
 *
 * Both panels draw ONE series against TWO y-axes, because both quantities have
 * a second unit people actually speak in: a burn multiple is an SLI, and a
 * percentage of budget is a number of errors. The usual objection to a second
 * axis — that where two series cross is an artifact of two independently
 * chosen scalings — does not apply when there is one series and the second
 * axis is the same axis relabelled through a fixed affine map. It is °C on the
 * left and °F on the right.
 *
 * What that DOES require is that the two axes share gridlines exactly. Left to
 * itself ECharts picks a "nice" range per axis, the right-hand numbers land
 * between the left-hand gridlines, and the chart reads as broken. So the left
 * axis is pinned here (min/max/interval, no auto-scaling) and the right one is
 * derived from it by {@link mappedAxis} rather than computed independently.
 */

export interface AxisScale {
  min: number;
  max: number;
  interval: number;
}

export interface MappedAxisScale extends AxisScale {
  /** True when the map is decreasing, so the axis has to render top-down. */
  inverse: boolean;
}

/** How many gridline gaps a pinned axis aims for. */
const SPLITS = 4;

/** Float noise turns `0.05` into `0.05000000000000001`, and an interval that
 *  does not divide the range to a whole number of steps makes ECharts emit a
 *  stray tick past the end. Twelve digits is far beyond any real precision
 *  here and short enough to snap that noise away. */
const round = (v: number): number => Number(v.toPrecision(12));

/** Guard against `Math.ceil(2.0000000001) === 3` putting a whole empty step on
 *  an axis whose data ended exactly on the boundary. */
const ceilTol = (v: number): number => Math.ceil(v - 1e-9);

/**
 * Smallest 1 / 2 / 2.5 / 5 × 10ᵏ value that is at least `raw`.
 *
 * These five mantissas are the steps people read without doing arithmetic —
 * an axis stepping by 3 or 7 is legible only if you stop and work it out.
 */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const base = Math.pow(10, Math.floor(Math.log10(raw)));
  const mantissa = raw / base;
  const nice =
    mantissa <= 1 + 1e-9 ? 1 : mantissa <= 2 ? 2 : mantissa <= 2.5 ? 2.5 : mantissa <= 5 ? 5 : 10;
  return round(nice * base);
}

/**
 * Left axis for the burn-rate panel: zero-based, with ×1 always on screen.
 *
 * The floor is the point. Burn rate is read against ×1 — above it the budget
 * is overspending, below it banking — and on a calm SLO whose peak is ×0.2 an
 * auto-scaled axis puts ×1 off the top of the frame, deleting the one
 * reference the chart exists to be read against.
 */
export function burnAxisScale(values: Array<number | null>): AxisScale {
  let peak = 0;
  for (const v of values) {
    if (v !== null && Number.isFinite(v) && v > peak) peak = v;
  }
  // Headroom so a peak is not welded to the top of the frame.
  const span = Math.max(peak * 1.15, 2);
  const interval = niceStep(span / SPLITS);
  return { min: 0, max: round(interval * SPLITS), interval };
}

/**
 * Left axis for the burndown panel: gridlines on multiples of a nice step, 0
 * always among them, and the top pinned at a full budget.
 *
 * Anchoring the ticks on 0 is deliberate — 0 is exhaustion, the line the whole
 * chart is read against, and it should be a gridline rather than something
 * floating between two.
 *
 * The top is 100 EXACTLY rather than the next multiple of the step, because
 * `remaining` is bounded above by 100 (cumulative bad only grows) and rounding
 * a large step up past it wastes the plot. A window that went 1,500% overspent
 * takes a 500-point step, and a top rounded to 500 would squash the entire
 * healthy stretch of the line into the top fifth of the panel. So 100 is the
 * frame, and the topmost gridline is simply the last multiple below it.
 *
 * The floor is uncapped on purpose: remaining is signed and a bad window can
 * reach several hundred percent overspent. Clipping it would hide exactly the
 * incident the reader came for.
 */
export function budgetAxisScale(values: Array<number | null>): AxisScale {
  let lo = 0;
  for (const v of values) {
    if (v !== null && Number.isFinite(v) && v < lo) lo = v;
  }
  const interval = niceStep((100 - lo) / SPLITS);
  return {
    // `lo < 0` rather than arithmetic on 0: `-Math.ceil(0) * interval` is -0,
    // which formats as "-0" on the axis.
    min: lo < 0 ? round(-ceilTol(-lo / interval) * interval) : 0,
    max: 100,
    interval,
  };
}

/**
 * The paired right-hand axis: the same gridlines, relabelled through `map`.
 *
 * Derived from the left axis rather than from the data, which is what
 * guarantees tick-for-tick alignment. A decreasing map (burn rate → SLI: more
 * burn is less SLI) comes back `inverse`, so the axis renders its numbers
 * top-down and the bottom of the frame still means "good".
 */
export function mappedAxis(scale: AxisScale, map: (value: number) => number): MappedAxisScale {
  const atMin = map(scale.min);
  const atMax = map(scale.max);
  const span = scale.max - scale.min;
  // From the SLOPE, not from the tick count. The burndown's top is pinned at
  // 100 rather than at a multiple of its step, so the range is not always a
  // whole number of intervals — dividing the mapped range by a rounded count
  // would drift the paired ticks off the gridlines they exist to sit on.
  const slope = span === 0 ? 0 : (atMax - atMin) / span;
  const interval = Math.abs(slope) * scale.interval;
  return {
    min: round(Math.min(atMin, atMax)),
    max: round(Math.max(atMin, atMax)),
    // A flat map (nothing measured, so nothing to count) collapses the whole
    // axis to a point. Echarts walks from min to max BY the interval, and an
    // interval of zero is a loop that never terminates — take the caller's
    // hidden axis with a harmless step instead of hanging the tab.
    interval: interval > 0 && Number.isFinite(interval) ? round(interval) : 1,
    inverse: atMax < atMin,
  };
}

/**
 * Decimals needed to write `step` without rounding it away.
 *
 * A four-nines target leaves a 0.01-wide budget, so the SLI axis steps by
 * thousandths: at the two decimals a percentage usually gets, every gridline
 * on that axis reads "100.00%" and the chart looks flat through an outage.
 * The precision therefore follows the step rather than the unit.
 */
export function decimalsFor(step: number, cap = 6): number {
  if (!(step > 0) || !Number.isFinite(step)) return 2;
  for (let d = 0; d < cap; d++) {
    const scaled = step * Math.pow(10, d);
    const nearest = Math.round(scaled);
    // `nearest >= 1` is what stops a very small step from claiming it needs no
    // decimals: it is within any absolute tolerance of ZERO, which is not the
    // same as being a whole number. And the tolerance scales with the value,
    // because float error on a product does too.
    if (nearest >= 1 && Math.abs(scaled - nearest) < Math.max(1, scaled) * 1e-9) return d;
  }
  return cap;
}
