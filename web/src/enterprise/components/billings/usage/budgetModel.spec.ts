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
  budgetFor,
  budgetStatus,
  configOf,
  draftOf,
  sameBudget,
  superBudgetConfigs,
  TOTAL_BUDGET_ID,
  budgetReachedDay,
  budgetTone,
  warnAmountFor,
  warnPercentFor,
  withBudget,
} from "./budgetModel";

const entry = (org_id: string, total = 100) => ({
  org_id,
  total_budget_amount: total,
  warn_at_amount: total * 0.8,
  paused: false,
});

describe("budgetModel", () => {
  it("replaces only this org's entry and keeps the billing group's other budgets", () => {
    const saved = withBudget([entry("child"), entry("me")], entry("me", 500));
    expect(saved).toHaveLength(2);
    expect(budgetFor(saved, "child")?.total_budget_amount).toBe(100);
    expect(budgetFor(saved, "me")?.total_budget_amount).toBe(500);
    expect(withBudget(null, entry("me"))).toEqual([entry("me")]);
  });

  it("links the warn amount and percent both ways", () => {
    expect(warnAmountFor(80, 45)).toBe(36);
    expect(warnPercentFor(36, 45)).toBe(80);
    expect(warnAmountFor(150, 45)).toBe(45);
    expect(warnPercentFor(10, 0)).toBe(80);
  });

  it("tones spend by the warn line and the budget", () => {
    expect(budgetTone(10, 100, 80)).toBe("ok");
    expect(budgetTone(80, 100, 80)).toBe("warn");
    expect(budgetTone(100, 100, 80)).toBe("over");
    expect(budgetTone(10, 0, 0)).toBe("ok");
  });

  it("finds the day the budget runs out at the current pace", () => {
    expect(budgetReachedDay(30, 18, 45, 30)).toBe(27);
    expect(budgetReachedDay(10, 18, 45, 30)).toBeNull();
    expect(budgetReachedDay(0, 18, 45, 30)).toBeNull();
  });

  describe("super org", () => {
    const draft = (budget: number, warnPercent = 80, alertsOn = true) => ({
      budget,
      warnPercent,
      alertsOn,
    });

    it("saves the overall budget under total, then one entry per org with a budget", () => {
      const configs = superBudgetConfigs(draft(600, 75, false), {
        sup: draft(200),
        m1: draft(100, 50),
        m2: draft(0),
      });
      expect(configs).toEqual([
        { org_id: TOTAL_BUDGET_ID, total_budget_amount: 600, warn_at_amount: 450, paused: true },
        { org_id: "sup", total_budget_amount: 200, warn_at_amount: 160, paused: false },
        { org_id: "m1", total_budget_amount: 100, warn_at_amount: 50, paused: false },
      ]);
      // No overall budget: only the org entries are sent.
      expect(superBudgetConfigs(draft(0), { m1: draft(100) }).map((c) => c.org_id)).toEqual(["m1"]);
    });

    it("round-trips a saved entry through the draft, so an untouched row is not a change", () => {
      const saved = { org_id: "m1", total_budget_amount: 90, warn_at_amount: 67.5, paused: true };
      const d = draftOf(saved);
      expect(d).toEqual({ budget: 90, warnPercent: 75, alertsOn: false });
      expect(configOf("m1", d)).toEqual(saved);
      expect(sameBudget(d, draftOf(saved))).toBe(true);
      expect(sameBudget(d, { ...d, alertsOn: true })).toBe(false);
      expect(draftOf(null)).toEqual({ budget: 0, warnPercent: 80, alertsOn: true });
    });

    it("says there is no budget rather than calling an org on track", () => {
      expect(budgetStatus(50, 0, 0)).toBe("none");
      expect(budgetStatus(50, 100, 80)).toBe("ok");
      expect(budgetStatus(85, 100, 80)).toBe("warn");
      expect(budgetStatus(120, 100, 80)).toBe("over");
    });
  });
});
