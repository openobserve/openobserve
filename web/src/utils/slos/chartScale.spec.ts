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

import { describe, expect, it } from "vitest";

import {
  budgetAxisScale,
  burnAxisScale,
  decimalsFor,
  mappedAxis,
  niceStep,
  type AxisScale,
} from "./chartScale";

/** The property the whole file exists for: the paired axis must land on the
 *  SAME gridlines as the axis it was derived from. */
function ticksOf(scale: AxisScale): number[] {
  const out: number[] = [];
  // Floor, like echarts: ticks step up from min and stop at the last one that
  // still fits, which is not always the max.
  const steps = Math.floor((scale.max - scale.min) / scale.interval + 1e-9);
  for (let i = 0; i <= steps; i++)
    out.push(Number((scale.min + i * scale.interval).toPrecision(12)));
  return out;
}

describe("niceStep", () => {
  it("rounds up to a 1 / 2 / 2.5 / 5 mantissa", () => {
    expect(niceStep(0.3)).toBe(0.5);
    expect(niceStep(1)).toBe(1);
    expect(niceStep(1.1)).toBe(2);
    expect(niceStep(2.1)).toBe(2.5);
    expect(niceStep(2.6)).toBe(5);
    expect(niceStep(25)).toBe(25);
    expect(niceStep(260)).toBe(500);
  });

  it("never returns zero for degenerate input", () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-4)).toBe(1);
    expect(niceStep(Number.NaN)).toBe(1);
  });
});

describe("burnAxisScale", () => {
  it("keeps the x1 reference on screen for a calm SLO", () => {
    // Peak of x0.2: an auto-scaled axis would top out below x1 and delete the
    // only line the chart is read against.
    const scale = burnAxisScale([0.1, 0.2, 0.05, null]);
    expect(scale.min).toBe(0);
    expect(scale.max).toBeGreaterThanOrEqual(2);
    expect(ticksOf(scale)).toContain(1);
  });

  it("leaves headroom above an incident peak", () => {
    const scale = burnAxisScale([0.5, 37, 12]);
    expect(scale.max).toBeGreaterThan(37);
  });

  it("survives an all-null series", () => {
    const scale = burnAxisScale([null, null]);
    expect(scale.max).toBeGreaterThanOrEqual(2);
    expect(Number.isFinite(scale.interval)).toBe(true);
  });
});

describe("budgetAxisScale", () => {
  it("puts exhaustion on a gridline and never labels a negative zero", () => {
    const scale = budgetAxisScale([100, 80, 42]);
    expect(scale.min).toBe(0);
    expect(Object.is(scale.min, -0)).toBe(false);
    expect(ticksOf(scale)).toContain(0);
    expect(scale.max).toBeGreaterThanOrEqual(100);
  });

  it("keeps 0 on a gridline once the budget is overspent", () => {
    const scale = budgetAxisScale([100, 10, -40, -180]);
    expect(scale.min).toBeLessThanOrEqual(-180);
    expect(ticksOf(scale)).toContain(0);
  });

  it("does not add an empty step when the data ends exactly on a boundary", () => {
    // -50 with a step of 50 must not round out to -100.
    const scale = budgetAxisScale([100, -50]);
    expect(scale.min).toBe(-50);
  });

  it("pins the top at a full budget instead of a multiple of a coarse step", () => {
    // A 1,500% overspend takes a 500-point step. Rounding the top up to 500
    // would spend four fifths of the panel on budget levels that cannot occur.
    const scale = budgetAxisScale([100, -1500]);
    expect(scale.max).toBe(100);
    expect(ticksOf(scale)).toContain(0);
  });
});

describe("mappedAxis", () => {
  it("aligns tick-for-tick with the axis it is derived from", () => {
    const burn = burnAxisScale([0.4, 3.2]);
    const width = 0.1; // 99.9% target
    const sli = mappedAxis(burn, (v) => 100 - v * width);

    const burnTicks = ticksOf(burn);
    const sliTicks = ticksOf(sli);
    expect(sliTicks).toHaveLength(burnTicks.length);
    // Inverted, so the paired axis reads bottom-up against the left's top-down.
    burnTicks.forEach((tick, i) => {
      const paired = sliTicks[sliTicks.length - 1 - i];
      expect(paired).toBeCloseTo(100 - tick * width, 9);
    });
  });

  it("marks a decreasing map as inverse and an increasing one as not", () => {
    const burn = burnAxisScale([1]);
    expect(mappedAxis(burn, (v) => 100 - v * 0.1).inverse).toBe(true);

    const budget = budgetAxisScale([100, 20]);
    expect(mappedAxis(budget, (v) => (v * 5000) / 100).inverse).toBe(false);
  });

  it("keeps the pairing exact when the range is not a whole number of steps", () => {
    // Top pinned at 100 with a 500-point step: 3.2 intervals, not 4.
    const budget = budgetAxisScale([100, -1500]);
    const events = mappedAxis(budget, (v) => (v * 58) / 100);
    const budgetTicks = ticksOf(budget);
    const eventTicks = ticksOf(events);
    expect(eventTicks).toHaveLength(budgetTicks.length);
    budgetTicks.forEach((tick, i) => expect(eventTicks[i]).toBeCloseTo((tick * 58) / 100, 6));
  });

  it("never returns a zero interval, which echarts would walk forever", () => {
    // Nothing measured: the budget is 0 errors wide, so the map is flat.
    const budget = budgetAxisScale([100, 40]);
    const events = mappedAxis(budget, () => 0);
    expect(events.interval).toBeGreaterThan(0);
  });

  it("maps budget percent onto absolute affordable errors", () => {
    const budget = budgetAxisScale([100, 25]);
    const events = mappedAxis(budget, (v) => (v * 800) / 100);
    // 100% of the budget is all 800 of its errors; 0% is none of them.
    expect(events.max).toBeCloseTo((budget.max * 800) / 100, 9);
    expect(events.min).toBeCloseTo((budget.min * 800) / 100, 9);
  });
});

describe("decimalsFor", () => {
  it("follows the step so a tight budget is not rounded flat", () => {
    expect(decimalsFor(25)).toBe(0);
    expect(decimalsFor(2.5)).toBe(1);
    // A 99.9% target stepping by x0.5 moves the SLI axis by 0.05 points.
    expect(decimalsFor(0.5 * 0.1)).toBe(2);
    // A 99.99% target: thousandths, where two decimals would print 100.00%
    // on every gridline.
    expect(decimalsFor(0.5 * 0.01)).toBe(3);
  });

  it("caps rather than running away on a pathological step", () => {
    expect(decimalsFor(1e-12)).toBe(6);
    expect(decimalsFor(0)).toBe(2);
  });
});
