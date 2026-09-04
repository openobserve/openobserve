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

import { describe, it, expect } from "vitest";
import {
  computeRunBudget,
  formatBudgetDuration,
  DEFAULT_JOURNEY_BUDGET_MS,
  JOB_LEASE_MS,
} from "./runBudget";

describe("computeRunBudget", () => {
  it("should count attempts, gaps and the combo multiplier", () => {
    // retries=0 is one attempt and no gaps.
    expect(computeRunBudget({ combos: 1, retries: 0, waitBeforeRetrySecs: 30 }).worstCaseMs).toBe(
      DEFAULT_JOURNEY_BUDGET_MS,
    );
    // retries=2 is three attempts and two gaps.
    expect(
      computeRunBudget({
        combos: 1,
        retries: 2,
        waitBeforeRetrySecs: 30,
        journeyBudgetMs: 10_000,
      }).worstCaseMs,
    ).toBe(30_000 + 60_000);
    // The combos multiply the WHOLE sequence: the probe runs them sequentially
    // inside one leased job, so the lease covers all of them.
    expect(
      computeRunBudget({
        combos: 2,
        retries: 2,
        waitBeforeRetrySecs: 30,
        journeyBudgetMs: 10_000,
      }).worstCaseMs,
    ).toBe(2 * (30_000 + 60_000));
  });

  /**
   * The reported save failure: two browser/device combos at the form's own
   * default `retries: 1` is 2 x (2 x 5m + 5s) = 20m10s, past the 15m lease — so
   * "Chromium desktop + Chromium mobile" could not be saved, and the server said
   * so in prose naming a field the form does not have.
   */
  it("should flag two combos at the form's default retries as over the lease", () => {
    const budget = computeRunBudget({ combos: 2, retries: 1, waitBeforeRetrySecs: 5 });
    expect(budget.worstCaseMs).toBe(1_210_000);
    expect(budget.exceedsLease).toBe(true);
  });

  it("should accept one combo at the form's default retries", () => {
    const budget = computeRunBudget({ combos: 1, retries: 1, waitBeforeRetrySecs: 5 });
    expect(budget.worstCaseMs).toBe(605_000);
    expect(budget.exceedsLease).toBe(false);
  });

  it("should let dropping retries bring two combos back inside the lease", () => {
    expect(computeRunBudget({ combos: 2, retries: 0, waitBeforeRetrySecs: 5 }).exceedsLease).toBe(
      false,
    );
  });

  it("should treat zero combos as one rather than producing a zero budget", () => {
    expect(computeRunBudget({ combos: 0, retries: 0, waitBeforeRetrySecs: 0 }).combos).toBe(1);
  });

  it("should agree with the server on where the boundary sits", () => {
    // Exactly at the lease is accepted; one millisecond past it is not.
    expect(
      computeRunBudget({
        combos: 1,
        retries: 0,
        waitBeforeRetrySecs: 0,
        journeyBudgetMs: JOB_LEASE_MS,
      }).exceedsLease,
    ).toBe(false);
    expect(
      computeRunBudget({
        combos: 1,
        retries: 0,
        waitBeforeRetrySecs: 0,
        journeyBudgetMs: JOB_LEASE_MS + 1,
      }).exceedsLease,
    ).toBe(true);
  });
});

describe("formatBudgetDuration", () => {
  it("should render durations the way the server message does", () => {
    expect(formatBudgetDuration(45_000)).toBe("45s");
    expect(formatBudgetDuration(300_000)).toBe("5m");
    expect(formatBudgetDuration(1_210_000)).toBe("20m10s");
    expect(formatBudgetDuration(900_000)).toBe("15m");
  });
});
